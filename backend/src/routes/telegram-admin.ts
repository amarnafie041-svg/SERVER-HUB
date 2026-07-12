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

// Handle Telegram updates (webhook)
router.post("/telegram/webhook", async (req: Request, res: Response): Promise<void> => {
  res.json({ ok: true });

  try {
    const update = req.body;
    const settings = storage.getSettings();
    if (!settings.telegram_enabled || !settings.telegram_bot_token) return;

    const token = settings.telegram_bot_token;
    const allowedChatId = settings.telegram_chat_id;

    // Handle messages
    const message = update.message || update.edited_message;
    if (!message) return;

    const chatId = String(message.chat.id);
    if (chatId !== allowedChatId) {
      await sendTelegramMsg(token, chatId, "⛔ غير مصرح لك بالتعامل مع هذا البوت");
      return;
    }

    const text = message.text || "";

    // /start
    if (text === "/start" || text === "/help") {
      const target = getTargetSandbox();
      await sendTelegramMsg(token, chatId,
        `🖥 *SERVER HUB Bot*\n\n` +
        `📂 *الأوامر المتاحة:*\n` +
        `/start - بدء البوت\n` +
        `/help - المساعدة\n` +
        `/status - حالة الاتصال\n` +
        `/list - قائمة الملفات\n` +
        `/setuser <username> - تغيير المستخدم المستهدف\n` +
        `/clearuser - إعادة المستخدم للمدمن\n` +
        `/target - عرض المستخدم المستهدف\n\n` +
        `📤 *رفع ملفات:*\n` +
        `أرسل أي ملف للبوت وسيتم رفعه تلقائياً على السيرفر\n\n` +
        `👤 المستخدم الحالي: *${target?.username || "admin"}*`
      );
      return;
    }

    // /status
    if (text === "/status") {
      const target = getTargetSandbox();
      const users = storage.getUsers();
      await sendTelegramMsg(token, chatId,
        `📊 *حالة الخادم*\n\n` +
        `🟢 البوت: متصل\n` +
        `👤 المستخدم المستهدف: *${target?.username || "admin"}*\n` +
        `👥 عدد المستخدمين: ${users.length}\n` +
        `📂 المسار: ${target?.homeDir || "N/A"}`
      );
      return;
    }

    // /list
    if (text === "/list") {
      const target = getTargetSandbox();
      if (!target || !fs.existsSync(target.homeDir)) {
        await sendTelegramMsg(token, chatId, "❌ لا توجد ملفات");
        return;
      }
      const listing = listDirTree(target.homeDir);
      if (!listing.trim()) {
        await sendTelegramMsg(token, chatId, `📂 المجلد فارغ: ${target.homeDir}`);
        return;
      }
      const msg = `📂 *ملفات ${target.username}:*\n\n${listing}`;
      if (msg.length > 4000) {
        const lines = listing.split("\n");
        const half = Math.ceil(lines.length / 2);
        await sendTelegramMsg(token, chatId, `📂 *ملفات ${target.username} (1/2):*\n\n${lines.slice(0, half).join("\n")}`);
        await sendTelegramMsg(token, chatId, `📂 *ملفات ${target.username} (2/2):*\n\n${lines.slice(half).join("\n")}`);
      } else {
        await sendTelegramMsg(token, chatId, msg);
      }
      return;
    }

    // /setuser <username>
    if (text.startsWith("/setuser")) {
      const parts = text.split(" ");
      if (parts.length < 2) {
        await sendTelegramMsg(token, chatId, "❌ الاستخدام: /setuser <username>\nمثال: /setuser ahmed");
        return;
      }
      const targetUsername = parts[1].trim();
      const targetUser = storage.getUserByUsername(targetUsername);
      if (!targetUser) {
        await sendTelegramMsg(token, chatId, `❌ المستخدم *${targetUsername}* غير موجود`);
        return;
      }
      uploadTargetUserId = targetUser.id;
      await sendTelegramMsg(token, chatId, `✅ تم تغيير المستخدم المستهدف إلى: *${targetUser.display_name}* (@${targetUser.username})`);
      return;
    }

    // /clearuser
    if (text === "/clearuser") {
      uploadTargetUserId = null;
      await sendTelegramMsg(token, chatId, "✅ تم إعادة المستخدم المستهدف للمدمن (admin)");
      return;
    }

    // /target
    if (text === "/target") {
      const target = getTargetSandbox();
      await sendTelegramMsg(token, chatId, `👤 المستخدم الحالي: *${target?.username || "admin"}*\n📂 المسار: \`${target?.homeDir || "N/A"}\``);
      return;
    }

    // Handle document uploads
    if (message.document) {
      const doc = message.document;
      const fileName = doc.file_name || "unknown_file";
      const target = getTargetSandbox();
      if (!target) {
        await sendTelegramMsg(token, chatId, "❌ لا يوجد مستخدم مستهدف");
        return;
      }

      await sendTelegramMsg(token, chatId, `⏳ جاري تحميل *${fileName}*...`);

      const destPath = path.join(target.homeDir, fileName);
      const success = await downloadTelegramFile(token, doc.file_id, destPath);

      if (success) {
        const size = doc.file_size || 0;
        await sendTelegramMsg(token, chatId,
          `✅ تم رفع الملف بنجاح!\n\n` +
          `📄 الملف: *${fileName}*\n` +
          `📦 الحجم: ${formatSize(size)}\n` +
          `👤 المستخدم: *${target.username}*\n` +
          `📂 المسار: \`${destPath}\``
        );
      } else {
        await sendTelegramMsg(token, chatId, `❌ فشل تحميل الملف *${fileName}*`);
      }
      return;
    }

    // Handle photos (save highest resolution)
    if (message.photo && message.photo.length > 0) {
      const photo = message.photo[message.photo.length - 1];
      const target = getTargetSandbox();
      if (!target) {
        await sendTelegramMsg(token, chatId, "❌ لا يوجد مستخدم مستهدف");
        return;
      }

      const ext = "jpg";
      const fileName = `photo_${Date.now()}.${ext}`;
      const destPath = path.join(target.homeDir, fileName);

      await sendTelegramMsg(token, chatId, `⏳ جاري تحميل الصورة...`);
      const success = await downloadTelegramFile(token, photo.file_id, destPath);

      if (success) {
        await sendTelegramMsg(token, chatId,
          `✅ تم رفع الصورة بنجاح!\n\n` +
          `🖼 الملف: *${fileName}*\n` +
          `📦 الحجم: ${formatSize(photo.file_size || 0)}\n` +
          `👤 المستخدم: *${target.username}*`
        );
      } else {
        await sendTelegramMsg(token, chatId, "❌ فشل تحميل الصورة");
      }
      return;
    }

    // Unhandled message type
    if (text && !text.startsWith("/")) {
      await sendTelegramMsg(token, chatId,
        `📝 تم استلام رسالتك\n\nلرفع ملفات، أرسل الملف مباشرة للبوت\nاكتب /help للأوامر`
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
