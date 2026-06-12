import { Router, type IRouter } from "express";
import { Request, Response } from "express";

const router: IRouter = Router();

router.get("/healthz", async (_req: Request, res: Response): Promise<void> => {
  res.json({ status: "ok", version: "6.0.0" });
});

export default router;
