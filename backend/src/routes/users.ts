import { Router, type IRouter } from "express";
import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { storage } from "../lib/storage";
import { authenticate, requireAdmin } from "../middleware/authenticate";
import { notify } from "../lib/telegram";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/users", authenticate, requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  const users = storage.getUsers().map(({ password_hash, ...u }) => u);
  res.json(users);
});

function computeExpiry(expires_days?: number | null, expires_hours?: number | null): string | null {
  const now = Date.now();
  let ms = 0;
  if (expires_days && expires_days > 0) ms += expires_days * 86400000;
  if (expires_hours && expires_hours > 0) ms += expires_hours * 3600000;
  if (ms === 0) return null;
  return new Date(now + ms).toISOString();
}

router.post("/users", authenticate, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password, role, display_name, expires_days, expires_hours, cpu_limit, ram_limit, disk_limit } = req.body;
    if (!username || !password) { res.status(400).json({ error: "Username and password required" }); return; }
    const existing = storage.getUserByUsername(username);
    if (existing) { res.status(409).json({ error: "Username already exists" }); return; }
    const expires_at = computeExpiry(expires_days, expires_hours);
    const user = storage.createUser({
      username, role: role || "user", display_name: display_name || username,
      password_hash: bcrypt.hashSync(password, 10), avatar: null, expires_at, disabled: false,
      cpu_limit: cpu_limit ?? null, ram_limit: ram_limit ?? null, disk_limit: disk_limit ?? null,
      custom_subdomain: null, custom_port: null,
    });
    notify("register", `New user created: *${user.username}* (${user.role})`);
    res.status(201).json({ id: user.id, username: user.username, role: user.role, display_name: user.display_name, created_at: user.created_at, expires_at: user.expires_at, disabled: user.disabled, cpu_limit: user.cpu_limit, ram_limit: user.ram_limit, disk_limit: user.disk_limit });
  } catch (err) {
    logger.error({ err }, "Create user failed");
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/users/:id", authenticate, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { password, expires_days, expires_hours, ...updates } = req.body;
    if (password) updates.password_hash = bcrypt.hashSync(password, 10);
    if (expires_days !== undefined || expires_hours !== undefined) {
      updates.expires_at = computeExpiry(expires_days, expires_hours);
    }
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const updated = storage.updateUser(rawId, updates);
    if (!updated) { res.status(404).json({ error: "User not found" }); return; }
    res.json({ id: updated.id, username: updated.username, role: updated.role, display_name: updated.display_name, disabled: updated.disabled, expires_at: updated.expires_at, cpu_limit: updated.cpu_limit, ram_limit: updated.ram_limit, disk_limit: updated.disk_limit });
  } catch (err) {
    logger.error({ err }, "Update user failed");
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/users/:id", authenticate, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const user = storage.getUserById(rawId);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    if (user.username === "elmodmen") { res.status(403).json({ error: "Cannot delete main admin" }); return; }
    storage.deleteUser(rawId);
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Delete user failed");
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
