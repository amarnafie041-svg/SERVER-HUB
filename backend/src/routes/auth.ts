import { Router, type IRouter } from "express";
import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { storage } from "../lib/storage";
import { signToken } from "../lib/jwt";
import { authenticate, requireAdmin } from "../middleware/authenticate";
import { notify } from "../lib/telegram";
import { logger } from "../lib/logger";
import { logActivity } from "./activity";
import { killAllSessionsForUser } from "./terminal";
import { portManager } from "../lib/port-manager";

const router: IRouter = Router();
const BOT_SECRET = process.env.BOT_API_SECRET || "";

router.post("/auth/register", authenticate, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password, display_name } = req.body;
    if (!username || !password) {
      res.status(400).json({ message: "Username and password required" }); return;
    }
    if (storage.getUserByUsername(username)) {
      res.status(409).json({ message: "Username already exists" }); return;
    }
    const newUser: Omit<User, "id" | "created_at" | "last_login"> = {
      username,
      password_hash: bcrypt.hashSync(password, 10),
      role: "user",
      display_name: display_name || username,
      avatar: null,
      created_at: new Date().toISOString(),
      expires_at: null,
      disabled: false,
    };
    const user = storage.createUser(newUser);
    logActivity({ user: username, action: "register", target: "auth", details: "Registered by admin", ip: req.ip || "unknown", status: "success" });
    notify("register", `New user *${username}* created by admin on SERVER HUB v5`);
    res.json({ success: true, user: { id: user.id, username: user.username, role: user.role, display_name: user.display_name, avatar: user.avatar, expires_at: user.expires_at } });
  } catch (err) {
    logger.error({ err }, "Registration failed");
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/auth/bot-create", async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ") || authHeader.slice(7) !== BOT_SECRET) {
      res.status(401).json({ error: "Unauthorized" }); return;
    }
    const { username, password, display_name, expires_at } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: "Username and password required" }); return;
    }
    if (storage.getUserByUsername(username)) {
      res.status(200).json({ message: "User already exists", username });
      return;
    }
    const newUser: Omit<User, "id" | "created_at" | "last_login"> = {
      username,
      password_hash: bcrypt.hashSync(password, 10),
      role: "user",
      display_name: display_name || username,
      avatar: null,
      created_at: new Date().toISOString(),
      expires_at: expires_at || null,
      disabled: false,
    };
    const user = storage.createUser(newUser);

    // Auto-assign unique port for this user
    const freePort = portManager.findFreePort();
    if (freePort) {
      storage.updateUser(user.id, { custom_port: freePort });
      portManager.allocatePort(freePort, user.id, username, `user-${username}`);
    }

    logActivity({ user: username, action: "register", target: "auth", details: "Registered via bot", ip: req.ip || "unknown", status: "success" });
    res.status(201).json({ success: true, user: { id: user.id, username: user.username, role: user.role, custom_port: freePort || null } });
  } catch (err) {
    logger.error({ err }, "Bot create user failed");
    res.status(500).json({ error: "Server error" });
  }
});

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

router.post("/auth/logout", authenticate, async (req: Request, res: Response): Promise<void> => {
  const username = (req as any).user?.username || "";
  const killed = killAllSessionsForUser(username);
  logger.info({ username, killed }, "User logged out, terminal sessions killed");
  res.json({ success: true, killed_sessions: killed });
});

export default router;
