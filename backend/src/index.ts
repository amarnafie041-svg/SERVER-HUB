import http from "http";
import { WebSocketServer } from "ws";
import app from "./app";
import { logger } from "./lib/logger";
import { setupTerminalWebSocket } from "./routes/terminal";
import { sandboxManager } from "./lib/sandbox-manager";
import { startPortCleanup } from "./lib/port-manager";
import { verifyToken } from "./lib/jwt";

sandboxManager.startCleanupLoop();
startPortCleanup();

const rawPort = process.env["PORT"] || "3001";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = req.url || "";
  if (url.includes("/api/terminal/ws/")) {
    try {
      const parsed = new URL(url, "http://localhost");
      const token = parsed.searchParams.get("token");
      if (!token || !verifyToken(token)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
    } catch {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

setupTerminalWebSocket(wss);

server.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "Server listening");
});

server.on("error", (err) => {
  logger.error({ err }, "Server error");
  process.exit(1);
});
