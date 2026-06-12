import { Router, type IRouter, Request, Response } from "express";
import { dockerManager } from "../lib/docker-manager";
import { authenticate, requireAdmin } from "../middleware/authenticate";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function ownContainerOrAdmin(req: Request, res: Response, next: () => void): void {
  const { username } = req.params;
  const reqUser = (req as any).user;
  if (reqUser?.role === "admin" || reqUser?.username === username) {
    next();
    return;
  }
  res.status(403).json({ error: "Access denied - not your container" });
}

router.get("/docker/status", authenticate, requireAdmin, async (_req: Request, res: Response) => {
  res.json({
    available: dockerManager.isAvailable,
    containers: dockerManager.getAllContainerInfos().map((c) => ({
      username: c.username,
      id: c.id,
      status: c.status,
      created: c.created,
      restartCount: c.restartCount,
    })),
  });
});

router.get("/docker/container/:username", authenticate, ownContainerOrAdmin, async (req: Request, res: Response) => {
  try {
    const { username } = req.params;
    const info = await dockerManager.getContainerInfo(username);
    if (!info) {
      res.status(404).json({ error: "Container not found" });
      return;
    }
    res.json(info);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/docker/container/:username/start", authenticate, ownContainerOrAdmin, async (req: Request, res: Response) => {
  try {
    const ok = await dockerManager.startContainer(req.params.username);
    res.json({ success: ok });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/docker/container/:username/stop", authenticate, ownContainerOrAdmin, async (req: Request, res: Response) => {
  try {
    const ok = await dockerManager.stopContainer(req.params.username);
    res.json({ success: ok });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/docker/container/:username/restart", authenticate, ownContainerOrAdmin, async (req: Request, res: Response) => {
  try {
    const ok = await dockerManager.restartContainer(req.params.username);
    res.json({ success: ok });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/docker/container/:username/pause", authenticate, ownContainerOrAdmin, async (req: Request, res: Response) => {
  try {
    const ok = await dockerManager.pauseContainer(req.params.username);
    res.json({ success: ok });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/docker/container/:username/unpause", authenticate, ownContainerOrAdmin, async (req: Request, res: Response) => {
  try {
    const ok = await dockerManager.unpauseContainer(req.params.username);
    res.json({ success: ok });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/docker/container/:username", authenticate, ownContainerOrAdmin, async (req: Request, res: Response) => {
  try {
    const ok = await dockerManager.removeContainer(req.params.username);
    res.json({ success: ok });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/docker/container/:username/stats", authenticate, ownContainerOrAdmin, async (req: Request, res: Response) => {
  try {
    const stats = await dockerManager.getContainerStats(req.params.username);
    if (!stats) {
      res.status(404).json({ error: "Container not found or stats unavailable" });
      return;
    }
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/docker/container/:username/logs", authenticate, ownContainerOrAdmin, async (req: Request, res: Response) => {
  try {
    const tail = parseInt(req.query.tail as string) || 100;
    const logs = await dockerManager.getContainerLogs(req.params.username, tail);
    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/docker/container/:username/processes", authenticate, ownContainerOrAdmin, async (req: Request, res: Response) => {
  try {
    const procs = await dockerManager.getContainerProcesses(req.params.username);
    res.json(procs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/docker/stats", authenticate, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const allStats = await dockerManager.getContainerStatsAll();
    res.json(allStats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function myUsername(req: Request): string | null {
  return (req as any).user?.username || null;
}

router.get("/docker/my-container", authenticate, async (req: Request, res: Response) => {
  try {
    const username = myUsername(req);
    if (!username) { res.status(401).json({ error: "Not authenticated" }); return; }
    const info = await dockerManager.getContainerInfo(username);
    if (!info) { res.json({ exists: false }); return; }
    const stats = await dockerManager.getContainerStats(username);
    res.json({ exists: true, ...info, stats });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/docker/my-container/start", authenticate, async (req: Request, res: Response) => {
  try {
    const ok = await dockerManager.startContainer(myUsername(req)!);
    res.json({ success: ok });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/docker/my-container/stop", authenticate, async (req: Request, res: Response) => {
  try {
    const ok = await dockerManager.stopContainer(myUsername(req)!);
    res.json({ success: ok });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/docker/my-container/restart", authenticate, async (req: Request, res: Response) => {
  try {
    const ok = await dockerManager.restartContainer(myUsername(req)!);
    res.json({ success: ok });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get("/docker/info", authenticate, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const infos = dockerManager.getAllContainerInfos();
    const detailed = await Promise.all(
      infos.map(async (info) => {
        const stats = await dockerManager.getContainerStats(info.username);
        return { ...info, stats };
      })
    );
    res.json({
      available: dockerManager.isAvailable,
      containers: detailed,
      total: detailed.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
