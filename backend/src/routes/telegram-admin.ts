import { Router, type IRouter } from "express";
import { Request, Response } from "express";
import { storage } from "../lib/storage";
import { authenticate, requireAdmin } from "../middleware/authenticate";
import { logger } from "../lib/logger";
import { sandboxManager } from "../lib/sandbox-manager";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import os from "os";

const router: IRouter = Router();

const WEBHOOK_SECRET = "sh_tg_webhook_" + (process.env.SESSION_SECRET || "default");

// Target user for uploads (admin can change via /setuser command)
let uploadTargetUserId: string | null = null;

async function sendTelegramMsg(token: string, chatId: string, text: string, extra?: Record<string, any>): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown", ...extra }),
    });
    return res.ok;
  } catch { return false; }
}

async function sendTelegramDocument(token: string, chatId: string, filePath: string, caption?: string): Promise<boolean> {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);

    const parts: Buffer[] = [];
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`));
    if (caption) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`));
    }
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
    parts.push(fileBuffer);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const body = Buffer.concat(parts);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    });
    return res.ok;
  } catch (err) {
    logger.error({ err }, "Telegram document send failed");
    return false;
  }
}

async function downloadTelegramFile(token: string, fileId: string, destPath: string): Promise<boolean> {
  try {
    const getFileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
    const fileData = await getFileRes.json() as any;
    if (!fileData.ok || !fileData.result?.file_path) return false;

    const filePath = fileData.result.file_path;
    const url = `https://api.telegram.org/file/bot${token}/${filePath}`;
    const fileRes = await fetch(url);
    if (!fileRes.ok) return false;

    const buffer = Buffer.from(await fileRes.arrayBuffer());
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, buffer);
    return true;
  } catch (err) {
    logger.error({ err }, "Telegram file download failed");
    return false;
  }
}

function ensureAdminSandbox(): string | null {
  const admin = storage.getUserByUsername("elmodmen");
  if (!admin) return null;
  const sb = sandboxManager.ensureUserSandbox(admin.id, admin.username);
  return sb.homeDir;
}

function getTargetSandbox(): { homeDir: string; username: string } | null {
  if (uploadTargetUserId) {
    const user = storage.getUserById(uploadTargetUserId);
    if (user) {
      const sb = sandboxManager.ensureUserSandbox(user.id, user.username);
      return { homeDir: sb.homeDir, username: user.username };
    }
  }
  const admin = storage.getUserByUsername("elmodmen");
  if (admin) {
    const sb = sandboxManager.ensureUserSandbox(admin.id, admin.username);
    return { homeDir: sb.homeDir, username: admin.username };
  }
  return null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

function listDirTree(dirPath: string, prefix: string = ""): string {
  let result = "";
  try {
    const items = fs.readdirSync(dirPath).sort();
    const dirs = items.filter((i) => { try { return fs.statSync(path.join(dirPath, i)).isDirectory(); } catch { return false; } });
    const files = items.filter((i) => { try { return !fs.statSync(path.join(dirPath, i)).isDirectory(); } catch { return false; } });

    for (const d of dirs) {
      if (d.startsWith(".") || d === "bin" || d === "tmp" || d === "node_modules") continue;
      result += `${prefix}📁 ${d}/\n`;
      result += listDirTree(path.join(dirPath, d), prefix + "  ");
    }
    for (const f of files) {
      if (f.startsWith(".")) continue;
      try {
        const size = fs.statSync(path.join(dirPath, f)).size;
        result += `${prefix}📄 ${f} (${formatSize(size)})\n`;
      } catch {
        result += `${prefix}📄 ${f}\n`;
      }
    }
  } catch {}
  return result;
}

// ===================== INLINE KEYBOARD HELPERS =====================

const COLORS = {
  primary: "primary" as const,
  secondary: "secondary" as const,
  destructive: "destructive" as const,
};

async function sendWithKeyboard(
  token: string, chatId: string, text: string,
  keyboard: any[][], extra?: Record<string, any>
): Promise<boolean> {
  return sendTelegramMsg(token, chatId, text, {
    reply_markup: { inline_keyboard: keyboard },
    ...extra,
  });
}

function btn(text: string, callbackData: string, color?: "primary" | "secondary" | "destructive") {
  const b: any = { text, callback_data: callbackData };
  if (color) b.button_color = color;
  return b;
}

// ===================== CALLBACK QUERY HANDLER =====================

async function handleCallbackQuery(token: string, allowedChatId: string, query: any): Promise<void> {
  const chatId = String(query.message?.chat?.id || "");
  const data: string = query.data || "";
  if (chatId !== allowedChatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: query.id }),
    });
  } catch {}

  if (data === "menu:main") {
    const target = getTargetSandbox();
    await sendWithKeyboard(token, chatId,
      `🖥 *SERVER HUB*\n\n👤 المستخدم الحالي: *${target?.username || "admin"}*`,
      [
        [btn("👥 المستخدمين", "users:list", "primary"), btn("📂 الملفات", "files:current", "primary")],
        [btn("📤 رفع ملف", "upload:info", "secondary"), btn("📊 الحالة", "status:show", "secondary")],
        [btn("🗑 تفريغ الكاش", "cache:clear", "destructive")],
      ]
    );
    return;
  }

  if (data === "users:list") {
    const users = storage.getUsers();
    if (users.length === 0) {
      await sendWithKeyboard(token, chatId, "❌ لا يوجد مستخدمين", [[btn("🔙 رجوع", "menu:main", "secondary")]]);
      return;
    }
    const rows: any[][] = [];
    for (const u of users) {
      const home = sandboxManager.getUserSandboxHome(u.id);
      let fileCount = 0, totalSize = 0;
      if (home && fs.existsSync(home)) {
        try {
          const walk = (dir: string) => {
            for (const i of fs.readdirSync(dir)) {
              if (i.startsWith(".") || i === "bin" || i === "tmp" || i === "node_modules") continue;
              const p = path.join(dir, i);
              const st = fs.statSync(p);
              if (st.isDirectory()) walk(p);
              else { fileCount++; totalSize += st.size; }
            }
          };
          walk(home);
        } catch {}
      }
      const role = u.role === "admin" ? "👑" : "👤";
      rows.push([btn(`${role} ${u.display_name} (${fileCount} 📄 | ${formatSize(totalSize)})`, `user:${u.username}`, "primary")]);
    }
    rows.push([btn("🔙 رجوع", "menu:main", "secondary")]);
    await sendWithKeyboard(token, chatId, "👥 *جميع المستخدمين:*", rows);
    return;
  }

  if (data.startsWith("user:")) {
    const username = data.split(":")[1];
    const user = storage.getUserByUsername(username);
    if (!user) {
      await sendWithKeyboard(token, chatId, `❌ المستخدم ${username} غير موجود`, [[btn("🔙 رجوع", "users:list", "secondary")]]);
      return;
    }
    await sendWithKeyboard(token, chatId, `👤 *${user.display_name}* (@${user.username})\n👑 الدور: ${user.role === "admin" ? "مدمن" : "مستخدم"}`,
      [
        [btn("📂 عرض الملفات", `files:${username}`, "primary"), btn("⬇️ تحميل الكل", `getall:${username}`, "primary")],
        [btn("🎯 تحديد كمستهدف", `settarget:${username}`, "secondary")],
        [btn("🔙 رجوع", "users:list", "secondary")],
      ]
    );
    return;
  }

  if (data === "files:current") {
    const target = getTargetSandbox();
    if (!target) {
      await sendWithKeyboard(token, chatId, "❌ لا يوجد مستخدم", [[btn("🔙 رجوع", "menu:main", "secondary")]]);
      return;
    }
    const user = storage.getUserByUsername(target.username);
    if (user && user.role !== "admin") {
      await handleFilesList(token, chatId, target.username, user);
    } else {
      await sendWithKeyboard(token, chatId, `👤 المستخدم الحالي: *${target.username}*`, [
        [btn("📂 عرض الملفات", `files:${target.username}`, "primary")],
        [btn("🔙 رجوع", "menu:main", "secondary")],
      ]);
    }
    return;
  }

  if (data.startsWith("files:")) {
    const username = data.split(":")[1];
    const user = storage.getUserByUsername(username);
    if (!user) {
      await sendWithKeyboard(token, chatId, `❌ المستخدم ${username} غير موجود`, [[btn("🔙 رجوع", "menu:main", "secondary")]]);
      return;
    }
    await handleFilesList(token, chatId, username, user);
    return;
  }

  if (data.startsWith("getall:")) {
    const username = data.split(":")[1];
    const user = storage.getUserByUsername(username);
    if (!user) {
      await sendWithKeyboard(token, chatId, `❌ المستخدم ${username} غير موجود`, [[btn("🔙 رجوع", "menu:main", "secondary")]]);
      return;
    }
    const home = sandboxManager.getUserSandboxHome(user.id);
    if (!home || !fs.existsSync(home)) {
      await sendWithKeyboard(token, chatId, `📂 لا توجد ملفات`, [[btn("🔙 رجوع", "menu:main", "secondary")]]);
      return;
    }

    await sendWithKeyboard(token, chatId, `📦 جاري تجهيز ملفات *${username}*...`, [[btn("⏳ انتظر...", "menu:main", "secondary")]]);

    const archPath = path.join(os.tmpdir(), `${username}_all_${Date.now()}.tar.gz`);
    try {
      execSync(`tar -czf "${archPath}" -C "${home}" . 2>/dev/null`, { timeout: 30000 });
      const sent = await sendTelegramDocument(token, chatId, archPath, `📦 كل ملفات ${username}`);
      try { fs.unlinkSync(archPath); } catch {}
      if (!sent) await sendTelegramMsg(token, chatId, "❌ فشل إرسال الأرشيف");
    } catch {
      await sendTelegramMsg(token, chatId, "❌ فشل إنشاء الأرشيف");
    }
    await sendWithKeyboard(token, chatId, "✅ تم الإرسال", [[btn("🔙 رجوع", `user:${username}`, "secondary")]]);
    return;
  }

  if (data.startsWith("settarget:")) {
    const username = data.split(":")[1];
    const user = storage.getUserByUsername(username);
    if (!user) {
      await sendWithKeyboard(token, chatId, `❌ المستخدم ${username} غير موجود`, [[btn("🔙 رجوع", "users:list", "secondary")]]);
      return;
    }
    uploadTargetUserId = user.id;
    await sendWithKeyboard(token, chatId, `✅ المستخدم المستهدف: *${user.display_name}*\n\nأرسل ملفات للبوت وسيتم رفعها على *${user.username}*`,
      [[btn("🔄 تغيير", "users:list", "primary"), btn("🏠 القائمة", "menu:main", "secondary")]]
    );
    return;
  }

  if (data.startsWith("filedown:")) {
    const [, username, ...fileParts] = data.split(":");
    const fileName = fileParts.join(":");
    const user = storage.getUserByUsername(username);
    if (!user) {
      await sendWithKeyboard(token, chatId, "❌ المستخدم غير موجود", [[btn("🔙 رجوع", "menu:main", "secondary")]]);
      return;
    }
    const home = sandboxManager.getUserSandboxHome(user.id);
    if (!home) { await sendWithKeyboard(token, chatId, "❌ لا يوجد sandbox", [[btn("🔙 رجوع", "menu:main", "secondary")]]); return; }

    let filePath = path.join(home, fileName);
    if (!fs.existsSync(filePath)) {
      let found = false;
      const search = (dir: string): boolean => {
        try {
          for (const i of fs.readdirSync(dir)) {
            if (i.startsWith(".") || i === "bin" || i === "tmp" || i === "node_modules") continue;
            const p = path.join(dir, i);
            const st = fs.statSync(p);
            if (st.isDirectory()) { if (search(p)) return true; }
            else if (i === fileName) { filePath = p; return true; }
          }
        } catch {}
        return false;
      };
      found = search(home);
      if (!found) {
        await sendWithKeyboard(token, chatId, `❌ الملف ${fileName} غير موجود`, [[btn("🔙 رجوع", `files:${username}`, "secondary")]]);
        return;
      }
    }

    const stat = fs.statSync(filePath);
    if (stat.size > 50 * 1024 * 1024) {
      await sendWithKeyboard(token, chatId, `❌ الملف كبير جداً (${formatSize(stat.size)})`, [[btn("🔙 رجوع", `files:${username}`, "secondary")]]);
      return;
    }

    await sendTelegramMsg(token, chatId, `⏳ جاري إرسال *${fileName}*...`);
    const sent = await sendTelegramDocument(token, chatId, filePath, `📄 ${fileName} | 👤 ${username} | 📦 ${formatSize(stat.size)}`);
    if (!sent) await sendTelegramMsg(token, chatId, `❌ فشل إرسال الملف`);
    return;
  }

  if (data === "cache:clear") {
    try {
      const home = ensureAdminSandbox();
      if (home) {
        const cacheDir = path.join(home, ".cache");
        if (fs.existsSync(cacheDir)) {
          execSync(`rm -rf "${cacheDir}"`, { timeout: 10000 });
          await sendWithKeyboard(token, chatId, "✅ تم تفريغ الكاش بنجاح", [[btn("🔙 رجوع", "menu:main", "secondary")]]);
        } else {
          await sendWithKeyboard(token, chatId, "ℹ️ الكاش فارغ بالفعل", [[btn("🔙 رجوع", "menu:main", "secondary")]]);
        }
      }
    } catch {
      await sendWithKeyboard(token, chatId, "❌ فشل تفريغ الكاش", [[btn("🔙 رجوع", "menu:main", "secondary")]]);
    }
    return;
  }

  if (data === "status:show") {
    const target = getTargetSandbox();
    const users = storage.getUsers();
    await sendWithKeyboard(token, chatId,
      `📊 *حالة الخادم*\n\n` +
      `🟢 البوت: متصل\n` +
      `👤 المستخدم: *${target?.username || "N/A"}*\n` +
      `👥 المستخدمين: ${users.length}\n` +
      `📂 المسار: \`${target?.homeDir || "N/A"}\``,
      [[btn("🔙 رجوع", "menu:main", "secondary")]]
    );
    return;
  }

  if (data.startsWith("back:user:")) {
    const username = data.split(":")[2];
    const user = storage.getUserByUsername(username);
    if (user) {
      await sendWithKeyboard(token, chatId, `👤 *${user.display_name}* (@${user.username})`,
        [
          [btn("📂 الملفات", `files:${username}`, "primary"), btn("⬇️ تحميل الكل", `getall:${username}`, "primary")],
          [btn("🎯 تحديد", `settarget:${username}`, "secondary")],
          [btn("🔙 رجوع", "users:list", "secondary")],
        ]
      );
    }
    return;
  }
}

async function handleFilesList(token: string, chatId: string, username: string, user: any): Promise<void> {
  const home = sandboxManager.getUserSandboxHome(user.id);
  if (!home || !fs.existsSync(home)) {
    await sendWithKeyboard(token, chatId, `📂 لا توجد ملفات لـ *${username}*`, [[btn("🔙 رجوع", "menu:main", "secondary")]]);
    return;
  }

  const files: { name: string; size: number; rel: string }[] = [];
  const walk = (dir: string, rel: string) => {
    try {
      for (const i of fs.readdirSync(dir)) {
        if (i.startsWith(".") || i === "bin" || i === "tmp" || i === "node_modules") continue;
        const p = path.join(dir, i);
        const st = fs.statSync(p);
        if (st.isDirectory()) walk(p, rel ? rel + "/" + i : i);
        else files.push({ name: i, size: st.size, rel: rel ? rel + "/" + i : i });
      }
    } catch {}
  };
  walk(home, "");

  if (files.length === 0) {
    await sendWithKeyboard(token, chatId, `📂 مجلد *${username}* فارغ`, [[btn("🔙 رجوع", `user:${username}`, "secondary")]]);
    return;
  }

  const rows: any[][] = [];
  for (const f of files.slice(0, 30)) {
    rows.push([btn(`📄 ${f.rel} (${formatSize(f.size)})`, `filedown:${username}:${f.name}`, "primary")]);
  }
  if (files.length > 30) {
    rows.push([btn(`... و ${files.length - 30} ملف إضافي`, "menu:main", "secondary")]);
  }
  rows.push([btn("⬇️ تحميل الكل", `getall:${username}`, "destructive")]);
  rows.push([btn("🔙 رجوع", `user:${username}`, "secondary")]);
  await sendWithKeyboard(token, chatId, `📂 *ملفات ${username}* (${files.length} ملف):`, rows);
}

// ===================== WEBHOOK HANDLER =====================

router.post("/telegram/webhook", async (req: Request, res: Response): Promise<void> => {
  res.json({ ok: true });

  try {
    const update = req.body;
    const settings = storage.getSettings();
    if (!settings.telegram_enabled || !settings.telegram_bot_token) return;

    const token = settings.telegram_bot_token;
    const allowedChatId = settings.telegram_chat_id;

    // Handle callback queries (button presses)
    if (update.callback_query) {
      await handleCallbackQuery(token, allowedChatId, update.callback_query);
      return;
    }

    // Handle messages
    const message = update.message || update.edited_message;
    if (!message) return;

    const chatId = String(message.chat.id);
    if (chatId !== allowedChatId) {
      await sendTelegramMsg(token, chatId, "⛔ غير مصرح لك");
      return;
    }

    const text = message.text || "";

    // /start
    if (text === "/start" || text === "/help") {
      const target = getTargetSandbox();
      await sendWithKeyboard(token, chatId,
        `🖥 *SERVER HUB Bot*\n\n👤 المستخدم الحالي: *${target?.username || "admin"}*\n\n📊 اضغط على الزر للمتابعة`,
        [
          [btn("👥 المستخدمين", "users:list", "primary"), btn("📂 الملفات", "files:current", "primary")],
          [btn("📤 رفع ملف", "upload:info", "secondary"), btn("📊 الحالة", "status:show", "secondary")],
          [btn("🗑 تفريغ الكاش", "cache:clear", "destructive")],
        ]
      );
      return;
    }

    if (text === "/users") {
      const users = storage.getUsers();
      if (users.length === 0) {
        await sendWithKeyboard(token, chatId, "❌ لا يوجد مستخدمين", [[btn("🔙 رجوع", "menu:main", "secondary")]]);
        return;
      }
      const rows: any[][] = [];
      for (const u of users) {
        const home = sandboxManager.getUserSandboxHome(u.id);
        let fileCount = 0, totalSize = 0;
        if (home && fs.existsSync(home)) {
          try {
            const walk = (dir: string) => {
              for (const i of fs.readdirSync(dir)) {
                if (i.startsWith(".") || i === "bin" || i === "tmp" || i === "node_modules") continue;
                const p = path.join(dir, i);
                const st = fs.statSync(p);
                if (st.isDirectory()) walk(p);
                else { fileCount++; totalSize += st.size; }
              }
            };
            walk(home);
          } catch {}
        }
        const role = u.role === "admin" ? "👑" : "👤";
        rows.push([btn(`${role} ${u.display_name} (${fileCount} 📄 | ${formatSize(totalSize)})`, `user:${u.username}`, "primary")]);
      }
      rows.push([btn("🔙 رجوع", "menu:main", "secondary")]);
      await sendWithKeyboard(token, chatId, "👥 *جميع المستخدمين:*", rows);
      return;
    }

    if (text.startsWith("/files")) {
      const parts = text.split(" ");
      if (parts.length < 2) {
        await sendWithKeyboard(token, chatId, "❌ الاستخدام: /files <username>",
          [[btn("👥 المستخدمين", "users:list", "primary"), btn("🔙 رجوع", "menu:main", "secondary")]]);
        return;
      }
      const username = parts[1].trim();
      const user = storage.getUserByUsername(username);
      if (!user) {
        await sendWithKeyboard(token, chatId, `❌ المستخدم ${username} غير موجود`, [[btn("👥 المستخدمين", "users:list", "primary")]]);
        return;
      }
      await handleFilesList(token, chatId, username, user);
      return;
    }

    if (text.startsWith("/get")) {
      const parts = text.split(" ");
      if (parts.length < 3) {
        await sendWithKeyboard(token, chatId, "❌ الاستخدام: /get <username> <file>",
          [[btn("👥 المستخدمين", "users:list", "primary")]]);
        return;
      }
      const username = parts[1].trim();
      const fileName = parts.slice(2).join(" ").trim();
      const user = storage.getUserByUsername(username);
      if (!user) {
        await sendWithKeyboard(token, chatId, `❌ المستخدم ${username} غير موجود`, [[btn("🔙 رجوع", "menu:main", "secondary")]]);
        return;
      }
      const home = sandboxManager.getUserSandboxHome(user.id);
      if (!home || !fs.existsSync(home)) {
        await sendWithKeyboard(token, chatId, `📂 لا توجد ملفات`, [[btn("🔙 رجوع", "menu:main", "secondary")]]);
        return;
      }
      let filePath = path.join(home, fileName);
      if (!fs.existsSync(filePath)) {
        let found = false;
        const search = (dir: string): boolean => {
          try {
            for (const i of fs.readdirSync(dir)) {
              if (i.startsWith(".") || i === "bin" || i === "tmp" || i === "node_modules") continue;
              const p = path.join(dir, i);
              const st = fs.statSync(p);
              if (st.isDirectory()) { if (search(p)) return true; }
              else if (i === fileName) { filePath = p; return true; }
            }
          } catch {}
          return false;
        };
        found = search(home);
        if (!found) {
          await sendWithKeyboard(token, chatId, `❌ الملف ${fileName} غير موجود`, [[btn("📂 الملفات", `files:${username}`, "primary")]]);
          return;
        }
      }
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        await sendWithKeyboard(token, chatId, `❌ ${fileName} مجلد وليس ملف`, [[btn("📂 الملفات", `files:${username}`, "primary")]]);
        return;
      }
      if (stat.size > 50 * 1024 * 1024) {
        await sendWithKeyboard(token, chatId, `❌ الملف كبير جداً (${formatSize(stat.size)})`, [[btn("🔙 رجوع", `files:${username}`, "secondary")]]);
        return;
      }
      await sendTelegramMsg(token, chatId, `⏳ جاري إرسال *${fileName}*...`);
      const sent = await sendTelegramDocument(token, chatId, filePath, `📄 ${fileName} | 👤 ${username} | 📦 ${formatSize(stat.size)}`);
      if (!sent) await sendTelegramMsg(token, chatId, "❌ فشل إرسال الملف");
      return;
    }

    if (text === "/setuser") {
      uploadTargetUserId = null;
      const users = storage.getUsers();
      const rows: any[][] = [];
      for (const u of users) {
        rows.push([btn(`${u.role === "admin" ? "👑" : "👤"} ${u.display_name}`, `settarget:${u.username}`, "primary")]);
      }
      rows.push([btn("🏠 للمدمن", "settarget:elmodmen", "destructive")]);
      rows.push([btn("🔙 رجوع", "menu:main", "secondary")]);
      await sendWithKeyboard(token, chatId, "🎯 اختر المستخدم المستهدف للملفات:", rows);
      return;
    }

    if (text === "/target") {
      const target = getTargetSandbox();
      await sendWithKeyboard(token, chatId,
        `👤 المستخدم الحالي: *${target?.username || "admin"}*\n📂 ${target?.homeDir || "N/A"}`,
        [[btn("🔄 تغيير", "setuser:list", "primary"), btn("🔙 رجوع", "menu:main", "secondary")]]
      );
      return;
    }

    // Handle document uploads
    if (message.document) {
      const doc = message.document;
      const fileName = doc.file_name || "unknown_file";
      const target = getTargetSandbox();
      if (!target) {
        await sendWithKeyboard(token, chatId, "❌ لا يوجد مستخدم مستهدف",
          [[btn("🎯 اختر مستخدم", "users:list", "primary")]]);
        return;
      }
      await sendTelegramMsg(token, chatId, `⏳ جاري تحميل *${fileName}*...`);
      const destPath = path.join(target.homeDir, fileName);
      const success = await downloadTelegramFile(token, doc.file_id, destPath);
      if (success) {
        await sendWithKeyboard(token, chatId,
          `✅ تم رفع الملف!\n\n📄 *${fileName}*\n📦 ${formatSize(doc.file_size || 0)}\n👤 *${target.username}*`,
          [[btn("📂 الملفات", `files:${target.username}`, "primary"), btn("🏠 القائمة", "menu:main", "secondary")]]
        );
      } else {
        await sendWithKeyboard(token, chatId, `❌ فشل تحميل ${fileName}`,
          [[btn("🔄 إعادة المحاولة", "menu:main", "destructive")]]);
      }
      return;
    }

    // Handle photos
    if (message.photo && message.photo.length > 0) {
      const photo = message.photo[message.photo.length - 1];
      const target = getTargetSandbox();
      if (!target) {
        await sendWithKeyboard(token, chatId, "❌ لا يوجد مستخدم مستهدف",
          [[btn("🎯 اختر مستخدم", "users:list", "primary")]]);
        return;
      }
      const fileName = `photo_${Date.now()}.jpg`;
      const destPath = path.join(target.homeDir, fileName);
      await sendTelegramMsg(token, chatId, `⏳ جاري تحميل الصورة...`);
      const success = await downloadTelegramFile(token, photo.file_id, destPath);
      if (success) {
        await sendWithKeyboard(token, chatId,
          `✅ تم رفع الصورة!\n\n🖼 *${fileName}*\n📦 ${formatSize(photo.file_size || 0)}\n👤 *${target.username}*`,
          [[btn("📂 الملفات", `files:${target.username}`, "primary"), btn("🏠 القائمة", "menu:main", "secondary")]]
        );
      } else {
        await sendWithKeyboard(token, chatId, "❌ فشل تحميل الصورة",
          [[btn("🔄 إعادة", "menu:main", "destructive")]]);
      }
      return;
    }

    // Handle upload:info callback from text
    if (text === "/upload") {
      const target = getTargetSandbox();
      await sendWithKeyboard(token, chatId,
        `📤 *رفع ملفات*\n\nأرسل أي ملف للبوت مباشرة وسيتم رفعه على *${target?.username || "admin"}*`,
        [[btn("🎯 تغيير المستخدم", "users:list", "primary"), btn("🏠 القائمة", "menu:main", "secondary")]]
      );
      return;
    }

    // Unhandled text
    if (text && !text.startsWith("/")) {
      await sendWithKeyboard(token, chatId, `📝 استخدم الأزرار أو الأوامر:`,
        [
          [btn("👥 المستخدمين", "users:list", "primary"), btn("📂 الملفات", "files:current", "primary")],
          [btn("📊 المساعدة", "menu:main", "secondary")],
        ]
      );
    }
  } catch (err) {
    logger.error({ err }, "Telegram webhook error");
  }
});

// Connect bot - save token + chatId, verify, set webhook, send success message
router.post("/telegram/connect", authenticate, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { bot_token, chat_id } = req.body;
    if (!bot_token || !chat_id) {
      res.status(400).json({ error: "Bot token and chat ID required" });
      return;
    }

    const meRes = await fetch(`https://api.telegram.org/bot${bot_token}/getMe`);
    const meData = await meRes.json() as any;
    if (!meData.ok) {
      res.status(400).json({ error: "Invalid bot token" });
      return;
    }

    storage.updateSettings({
      telegram_bot_token: bot_token,
      telegram_chat_id: chat_id,
      telegram_enabled: true,
    });

    // Set webhook
    const baseUrl = `https://server-hub-ziaf.onrender.com`;
    const webhookUrl = `${baseUrl}/api/telegram/webhook`;
    const setWebhookRes = await fetch(`https://api.telegram.org/bot${bot_token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl, allowed_updates: ["message"] }),
    });
    const webhookData = await setWebhookRes.json() as any;

    const botName = meData.result?.first_name || "Bot";
    await sendTelegramMsg(bot_token, chat_id,
      `✅ *تم ربط البوت بنجاح يا سيدي المدمن!*\n\n` +
      `🤖 البوت: ${botName}\n` +
      `🆔 Chat ID: ${chat_id}\n` +
      `🔗 Webhook: ${webhookData.ok ? "✅ مُعد" : "❌ فشل"}\n` +
      `🖥 الخادم: SERVER HUB\n\n` +
      `📤 أرسل ملف للبوت وسيتم رفعه على السيرفر\n` +
      `📝 اكتب /help للأوامر`
    );

    res.json({ success: true, bot_name: botName, bot_username: meData.result?.username, webhook: webhookData.ok });
  } catch (err: any) {
    logger.error({ err }, "Telegram connect failed");
    res.status(500).json({ error: "Connection failed: " + (err?.message || String(err)) });
  }
});

// Disconnect bot - remove webhook
router.post("/telegram/disconnect", authenticate, requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  const settings = storage.getSettings();
  if (settings.telegram_bot_token) {
    try {
      await fetch(`https://api.telegram.org/bot${settings.telegram_bot_token}/deleteWebhook`);
    } catch {}
  }
  uploadTargetUserId = null;
  storage.updateSettings({ telegram_enabled: false, telegram_bot_token: "", telegram_chat_id: "" });
  res.json({ success: true });
});

router.get("/telegram/status", authenticate, requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  const s = storage.getSettings();
  res.json({
    connected: s.telegram_enabled && !!s.telegram_bot_token && !!s.telegram_chat_id,
    chat_id: s.telegram_chat_id || "",
    has_token: !!s.telegram_bot_token,
    target_user: uploadTargetUserId,
  });
});

router.post("/telegram/send-user-files", authenticate, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { user_id } = req.body;
    if (!user_id) { res.status(400).json({ error: "user_id required" }); return; }

    const settings = storage.getSettings();
    if (!settings.telegram_enabled || !settings.telegram_bot_token || !settings.telegram_chat_id) {
      res.status(400).json({ error: "Telegram not connected" }); return;
    }

    const user = storage.getUserById(user_id);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const sandboxHome = sandboxManager.getUserSandboxHome(user_id);
    if (!sandboxHome || !fs.existsSync(sandboxHome)) {
      res.status(404).json({ error: "No files found for this user" }); return;
    }

    const zipPath = path.join(os.tmpdir(), `user_${user.username}_${Date.now()}.zip`);
    const size = createZip(zipPath, sandboxHome);

    if (!size || !fs.existsSync(zipPath)) {
      res.status(500).json({ error: "Failed to create zip" }); return;
    }

    const caption = `📁 ملفات المستخدم: ${user.display_name} (@${user.username})\n📦 الحجم: ${formatSize(size)}`;
    const sent = await sendTelegramDocument(settings.telegram_bot_token, settings.telegram_chat_id, zipPath, caption);

    try { fs.unlinkSync(zipPath); } catch {}

    if (!sent) { res.status(500).json({ error: "Failed to send to Telegram" }); return; }
    res.json({ success: true, username: user.username, size });
  } catch (err: any) {
    logger.error({ err }, "Send user files to Telegram failed");
    res.status(500).json({ error: "Failed: " + (err?.message || String(err)) });
  }
});

router.post("/telegram/send-all-files", authenticate, requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const settings = storage.getSettings();
    if (!settings.telegram_enabled || !settings.telegram_bot_token || !settings.telegram_chat_id) {
      res.status(400).json({ error: "Telegram not connected" }); return;
    }

    const users = storage.getUsers().filter((u) => u.role !== "admin");
    if (users.length === 0) { res.status(404).json({ error: "No user files found" }); return; }

    const entries: Array<{ dir: string; name: string }> = [];
    for (const user of users) {
      const home = sandboxManager.getUserSandboxHome(user.id);
      if (home && fs.existsSync(home)) {
        entries.push({ dir: home, name: `user_${user.username}` });
      }
    }

    if (entries.length === 0) {
      res.status(404).json({ error: "No sandbox files found" }); return;
    }

    const zipPath = path.join(os.tmpdir(), `all_users_${Date.now()}.zip`);
    const size = createMultiDirZip(zipPath, entries);

    if (!size || !fs.existsSync(zipPath)) {
      res.status(500).json({ error: "Failed to create zip" }); return;
    }

    const caption = `📦 ملفات جميع المستخدمين\n👥 عدد المستخدمين: ${entries.length}\n📦 الحجم: ${(size / 1024 / 1024).toFixed(2)} MB`;
    const sent = await sendTelegramDocument(settings.telegram_bot_token, settings.telegram_chat_id, zipPath, caption);

    try { fs.unlinkSync(zipPath); } catch {}

    if (!sent) { res.status(500).json({ error: "Failed to send to Telegram" }); return; }
    res.json({ success: true, users_count: entries.length, size });
  } catch (err: any) {
    logger.error({ err }, "Send all files to Telegram failed");
    res.status(500).json({ error: "Failed: " + (err?.message || String(err)) });
  }
});

function createZip(zipPath: string, sourceDir: string): number {
  try {
    execSync(`cd "${sourceDir}" && zip -r "${zipPath}" . 2>/dev/null`, {
      timeout: 120000, stdio: "pipe",
    });
  } catch {
    try { execSync(`cd "${path.dirname(sourceDir)}" && zip -r "${zipPath}" "${path.basename(sourceDir)}" 2>/dev/null`, { timeout: 120000, stdio: "pipe" }); } catch {}
  }
  try { return fs.statSync(zipPath).size; } catch { return 0; }
}

function createMultiDirZip(zipPath: string, entries: Array<{ dir: string; name: string }>): number {
  const tmpBase = path.join(os.tmpdir(), `tg_zip_${Date.now()}`);
  try { fs.mkdirSync(tmpBase, { recursive: true }); } catch {}
  for (const e of entries) {
    try {
      execSync(`cp -a "${e.dir}" "${path.join(tmpBase, e.name)}" 2>/dev/null || xcopy "${e.dir}" "${path.join(tmpBase, e.name)}" /E /I /Q 2>nul`, { timeout: 60000, stdio: "pipe" });
    } catch {}
  }
  try {
    execSync(`cd "${tmpBase}" && zip -r "${zipPath}" .`, { timeout: 120000, stdio: "pipe" });
  } catch (err) { logger.error({ err }, "zip failed"); }
  try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  try { return fs.statSync(zipPath).size; } catch { return 0; }
}

export default router;
