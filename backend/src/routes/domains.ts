import { Router, type IRouter } from "express";
import { Request, Response } from "express";
import { authenticate } from "../middleware/authenticate";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Get domain info for current user
router.get("/domains/info", authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const username = (req as any).user?.username || "";
    const userId = (req as any).user?.userId || "";
    const baseDomain = process.env.BASE_DOMAIN || "server.app";
    const baseUrl = process.env.RENDER_EXTERNAL_URL || process.env.RAILWAY_STATIC_URL || `http://localhost:${process.env.PORT || 3001}`;

    res.json({
      subdomain: `${username}.${baseDomain}`,
      port: parseInt(process.env.PORT || "3001"),
      baseDomain,
      urls: {
        subdomain: `https://${username}.${baseDomain}`,
        local: `http://localhost:${process.env.PORT || 3001}`,
        direct: `${baseUrl}/~${username}`,
      },
      username,
      userId,
    });
  } catch (err) {
    logger.error({ err }, "Failed to get domain info");
    res.status(500).json({ error: "Failed to get domain info" });
  }
});

// List all domains (admin only)
router.get("/domains/list", authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const isAdmin = (req as any).user?.role === "admin";
    if (!isAdmin) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    res.json({ domains: [] });
  } catch (err) {
    logger.error({ err }, "Failed to list domains");
    res.status(500).json({ error: "Failed to list domains" });
  }
});

export default router;
