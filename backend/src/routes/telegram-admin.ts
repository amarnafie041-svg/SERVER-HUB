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

function createZip(zipPath: string, sourceDir: string): number {
  const tmpDir = os.tmpdir();
  const relZipPath = path.relative(tmpDir, zipPath).replace(/\\/g, "/");
  try {
    execSync(`cd "${tmpDir}" && zip -r "${zipPath}" . -i "${sourceDir}/**/*" 2>/dev/null || zip -r "${zipPath}" .`, {
      timeout: 120000, stdio: "pipe",
    });
  } catch {
    execSync(`cd "${sourceDir}" && zip -r "${zipPath}" . 2>/dev/null`, {
      timeout: 120000, stdio: "pipe",
    });
  }
  try { return fs.statSync(zipPath).size; } catch { return 0; }
}

function createMultiDirZip(zipPath: string, entries: Array<{ dir: string; name: string }>): number {
  const tmpBase = path.join(os.tmpdir(), `tg_zip_${Date.now()}`);
  try { fs.mkdirSync(tmpBase, { recursive: true }); } catch {}

  for (const e of entries) {
    const destDir = path.join(tmpBase, e.name);
    try {
      execSync(`cp -a "${e.dir}" "${destDir}" 2>/dev/null || xcopy "${e.dir}" "${destDir}" /E /I /Q 2>nul`, {
        timeout: 60000, stdio: "pipe",
      });
    } catch {}
  }

  try {
    execSync(`cd "${tmpBase}" && zip -r "${zipPath}" .`, { timeout: 120000, stdio: "pipe" });
  } catch (err) {
    logger.error({ err }, "zip failed");
  }

  try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  try { return fs.statSync(zipPath).size; } catch { return 0; }
}

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

    const botName = meData.result?.first_name || "Bot";
    const url = `https://api.telegram.org/bot${bot_token}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id,
        text: `✅ *تم ربط البوت بنجاح يا سيدي المدمن!*\n\n🤖 البوت: ${botName}\n🆔 Chat ID: ${chat_id}\n🖥 الخادم: SERVER HUB`,
        parse_mode: "Markdown",
      }),
    });

    res.json({ success: true, bot_name: botName, bot_username: meData.result?.username });
  } catch (err: any) {
    logger.error({ err }, "Telegram connect failed");
    res.status(500).json({ error: "Connection failed: " + (err?.message || String(err)) });
  }
});

router.post("/telegram/disconnect", authenticate, requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  storage.updateSettings({ telegram_enabled: false, telegram_bot_token: "", telegram_chat_id: "" });
  res.json({ success: true });
});

router.get("/telegram/status", authenticate, requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  const s = storage.getSettings();
  res.json({
    connected: s.telegram_enabled && !!s.telegram_bot_token && !!s.telegram_chat_id,
    chat_id: s.telegram_chat_id || "",
    has_token: !!s.telegram_bot_token,
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

    const caption = `📁 ملفات المستخدم: ${user.display_name} (@${user.username})\n📦 الحجم: ${(size / 1024).toFixed(1)} KB`;
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

export default router;
