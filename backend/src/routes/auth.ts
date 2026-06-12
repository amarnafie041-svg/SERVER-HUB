import { Router, type IRouter } from "express";
import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { storage } from "../lib/storage";
import { signToken } from "../lib/jwt";
import { authenticate } from "../middleware/authenticate";
import { notify } from "../lib/telegram";
import { logger } from "../lib/logger";
import { logActivity } from "./activity";

const router: IRouter = Router();

router.post("/auth/login", async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body;
    if (!username || !password) { res.status(400).json({ message: "Username and password required" }); return; }
    const user = storage.getUserByUsername(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      logActivity({ user: username || "unknown", action: "login", target: "auth", details: "Invalid credentials", ip: req.ip || "unknown", status: "failed" });
      res.status(401).json({ message: "Invalid username or password" }); return;
    }
    if (user.disabled) {
      logActivity({ user: username, action: "login", target: "auth", details: "Account disabled", ip: req.ip || "unknown", status: "failed" });
      res.status(403).json({ message: "Account is disabled" }); return;
    }
    if (user.expires_at && new Date(user.expires_at) < new Date()) {
      logActivity({ user: username, action: "login", target: "auth", details: "Account expired", ip: req.ip || "unknown", status: "failed" });
      res.status(403).json({ message: "Account has expired" }); return;
    }
    storage.updateUser(user.id, { last_login: new Date().toISOString() });
    const token = signToken({ userId: user.id, username: user.username, role: user.role });
    logActivity({ user: username, action: "login", target: "auth", details: "Logged in successfully", ip: req.ip || "unknown", status: "success" });
    notify("login", `User *${user.username}* logged in from SERVER HUB v5`);
    res.json({ token, user: { id: user.id, username: user.username, role: user.role, display_name: user.display_name, avatar: user.avatar, expires_at: user.expires_at } });
  } catch (err) {
    logger.error({ err }, "Login failed");
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/auth/me", authenticate, async (req: Request, res: Response): Promise<void> => {
  const user = storage.getUserById(req.user!.userId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ id: user.id, username: user.username, role: user.role, display_name: user.display_name, avatar: user.avatar, expires_at: user.expires_at });
});

router.put("/auth/profile", authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { display_name, avatar, current_password, new_password } = req.body;
    const user = storage.getUserById(req.user!.userId);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    const updates: Record<string, any> = {};
    if (display_name) updates.display_name = display_name;
    if (avatar !== undefined) updates.avatar = avatar || null;
    if (current_password && new_password) {
      if (!bcrypt.compareSync(current_password, user.password_hash)) {
        res.status(400).json({ error: "Current password is incorrect" }); return;
      }
      updates.password_hash = bcrypt.hashSync(new_password, 10);
    }
    storage.updateUser(user.id, updates);
    res.json({ success: true, message: "Profile updated" });
  } catch (err) {
    logger.error({ err }, "Profile update failed");
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/auth/logout", authenticate, async (_req: Request, res: Response): Promise<void> => {
  res.json({ success: true });
});

export default router;
