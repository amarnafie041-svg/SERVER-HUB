import Docker from "dockerode";
import { PassThrough } from "stream";
import { logger } from "./logger";

const DOCKER_SOCKET = process.env.DOCKER_HOST || "/var/run/docker.sock";
const CONTAINER_IMAGE = process.env.CONTAINER_IMAGE || "server-hub-user:latest";
const NETWORK_NAME = process.env.DOCKER_NETWORK || "server-hub-network";
const CONTAINER_MEMORY = parseInt(process.env.CONTAINER_MEMORY || "512", 10);
const CONTAINER_CPU = parseFloat(process.env.CONTAINER_CPU || "0.5");
const CONTAINER_DISK = process.env.CONTAINER_DISK || "2g";

interface ContainerInfo {
  id: string;
  username: string;
  userId: string;
  created: Date;
  status: string;
  restartCount: number;
}

interface ContainerStats {
  cpu_percent: number;
  mem_used: number;
  mem_total: number;
  mem_percent: number;
  net_rx: number;
  net_tx: number;
  block_rx: number;
  block_tx: number;
  process_count: number;
  uptime: number;
}

interface ContainerLogEntry {
  timestamp: string;
  stream: "stdout" | "stderr";
  message: string;
}

class DockerManager {
  private docker: Docker | null = null;
  private available = false;
  private userContainers = new Map<string, ContainerInfo>();
  private containerPrefix = "sh-user-";
  private eventMonitor: any = null;
  private cleanupInterval: any = null;

  constructor() {
    this.init();
  }

  private init(): void {
    try {
      if (process.platform === "win32") {
        logger.warn("Docker isolation not available on Windows - using fallback mode");
        this.available = false;
        return;
      }
      const socketPath = DOCKER_SOCKET.replace("unix://", "");
      this.docker = new Docker(
        DOCKER_SOCKET.startsWith("unix:")
          ? { socketPath, timeout: 10000 }
          : { host: "localhost", port: 2375, timeout: 10000 }
      );
      this.docker.ping((err) => {
        if (err) {
          logger.warn({ err: err.message }, "Docker not available - running without isolation");
          this.available = false;
          return;
        }
        this.available = true;
        logger.info("Docker isolation engine ready");
        this.ensureNetwork();
        this.startEventMonitor();
        this.startCleanupLoop();
      });
    } catch (err: any) {
      logger.warn({ err: err.message }, "Docker not available - running without isolation");
      this.available = false;
    }
  }

  get isAvailable(): boolean {
    return this.available;
  }

  private async ensureNetwork(): Promise<void> {
    try {
      const networks = await this.docker!.listNetworks();
      const exists = networks.find((n) => n.Name === NETWORK_NAME);
      if (!exists) {
        await this.docker!.createNetwork({
          Name: NETWORK_NAME,
          Driver: "bridge",
          Internal: false,
          Options: {
            "com.docker.network.bridge.name": "sh-net",
            "com.docker.network.bridge.enable_ip_masquerade": "true",
            "com.docker.network.bridge.enable_icc": "false",
            "com.docker.network.driver.mtu": "1500",
          },
          IPAM: { Config: [{ Subnet: "172.28.0.0/16" }] },
        });
        logger.info({ network: NETWORK_NAME }, "Isolation network created");
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, "Could not create network");
    }
  }

  private async startEventMonitor(): Promise<void> {
    try {
      const events = await this.docker!.getEvents({
        filters: { label: ["server-hub.managed=true"] },
      });
      this.eventMonitor = events;
      events.on("data", (chunk: Buffer) => {
        try {
          const event = JSON.parse(chunk.toString());
          if (event.Type === "container" && (event.Action === "die" || event.Action === "stop" || event.Action === "kill")) {
            const containerId = event.id;
            const containerInfo = Array.from(this.userContainers.values()).find((c) => c.id === containerId);
            if (containerInfo) {
              containerInfo.status = "exited";
              containerInfo.restartCount++;
              logger.warn({ username: containerInfo.username, containerId, action: event.Action }, "Container stopped unexpectedly - auto-restarting");
              this.restartContainer(containerInfo.username);
            }
          }
          if (event.Type === "container" && event.Action === "start") {
            const containerInfo = Array.from(this.userContainers.values()).find((c) => c.id === event.id);
            if (containerInfo) containerInfo.status = "running";
          }
        } catch {}
      });
      events.on("error", () => {
        setTimeout(() => this.startEventMonitor(), 5000);
      });
    } catch (err: any) {
      logger.warn({ err: err.message }, "Could not start Docker event monitor");
      setTimeout(() => this.startEventMonitor(), 10000);
    }
  }

  private startCleanupLoop(): void {
    this.cleanupInterval = setInterval(async () => {
      if (!this.available || !this.docker) return;
      try {
        const containers = await this.docker.listContainers({
          all: true,
          filters: { label: ["server-hub.managed=true"] },
        });
        for (const c of containers) {
          if (c.State === "exited" || c.State === "dead") {
            const info = Array.from(this.userContainers.values()).find((ci) => ci.id === c.Id);
            if (info) {
              logger.info({ username: info.username, container: c.Id }, "Cleaning up dead container");
              try {
                const container = this.docker.getContainer(c.Id);
                await container.remove();
              } catch {}
              this.userContainers.delete(info.username);
            }
          }
        }
      } catch {}
    }, 300000);
  }

  private containerName(username: string): string {
    const safe = username.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
    return `${this.containerPrefix}${safe}`;
  }

  async ensureContainer(username: string, userId: string): Promise<string | null> {
    if (!this.available || !this.docker) return null;

    const name = this.containerName(username);
    const existing = this.userContainers.get(username);
    if (existing) {
      try {
        const container = this.docker.getContainer(existing.id);
        const info = await container.inspect();
        if (info.State.Running) return existing.id;
        if (info.State.Status === "exited" || info.State.Status === "dead") {
          await container.start();
          existing.status = "running";
          return existing.id;
        }
      } catch {
        this.userContainers.delete(username);
      }
    }

    try {
      const containers = await this.docker.listContainers({ all: true });
      const existingContainer = containers.find((c) =>
        c.Names?.includes(`/${name}`)
      );
      if (existingContainer) {
        if (existingContainer.State !== "running") {
          await this.docker.getContainer(existingContainer.Id).start();
        }
        const info: ContainerInfo = {
          id: existingContainer.Id,
          username,
          userId,
          created: new Date(),
          status: "running",
          restartCount: 0,
        };
        this.userContainers.set(username, info);
        logger.info({ username, container: name }, "Reusing existing user container");
        return existingContainer.Id;
      }

      const memBytes = CONTAINER_MEMORY * 1024 * 1024;
      const cpuPeriod = 100000;
      const cpuQuota = Math.round(cpuPeriod * CONTAINER_CPU);

      const container = await this.docker.createContainer({
        name,
        Image: CONTAINER_IMAGE,
        Cmd: ["/bin/bash", "--login"],
        Env: [
          `USERNAME=${username}`,
          `HOME=/home/runner`,
          `TERM=xterm-256color`,
          `LANG=C.UTF-8`,
          `LC_ALL=C.UTF-8`,
          `PYTHONUNBUFFERED=1`,
          `CONTAINER_MEMORY=${memBytes}`,
          `CONTAINER_CPU=${CONTAINER_CPU}`,
        ],
        WorkingDir: "/home/runner",
        HostConfig: {
          NetworkMode: NETWORK_NAME,
          Memory: memBytes,
          MemorySwap: memBytes,
          MemoryReservation: Math.round(memBytes * 0.75),
          CpuPeriod: cpuPeriod,
          CpuQuota: cpuQuota,
          PidsLimit: 200,
          ReadonlyRootfs: true,
          StorageOpt: { size: CONTAINER_DISK },
          Tmpfs: {
            "/tmp": "size=100m,noexec,nosuid,nodev",
            "/home/runner": "size=500m,noexec,nosuid,nodev",
            "/var/tmp": "size=50m,noexec,nosuid,nodev",
            "/run": "size=50m,noexec,nosuid,nodev",
          },
          SecurityOpt: ["no-new-privileges:true"],
          CapDrop: ["ALL"],
          CapAdd: ["NET_BIND_SERVICE", "CHOWN", "SETUID", "SETGID", "DAC_OVERRIDE"],
          RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 5 },
          Ulimits: [
            { Name: "nofile", Soft: 1024, Hard: 2048 },
            { Name: "nproc", Soft: 200, Hard: 400 },
          ],
        },
        Labels: {
          "server-hub.user": username,
          "server-hub.userid": userId,
          "server-hub.managed": "true",
          "server-hub.version": "5.0.0",
          "server-hub.created": new Date().toISOString(),
        },
      });

      await container.start();
      const info: ContainerInfo = {
        id: container.id,
        username,
        userId,
        created: new Date(),
        status: "running",
        restartCount: 0,
      };
      this.userContainers.set(username, info);
      logger.info({ username, container: name, id: container.id }, "User container created with full isolation");
      return container.id;
    } catch (err: any) {
      logger.error({ err: err.message, username }, "Failed to create user container");
      return null;
    }
  }

  async execInContainer(
    username: string,
    command: string[],
    options: {
      Cwd?: string;
      Env?: string[];
      Tty?: boolean;
    } = {}
  ): Promise<{ output: string; exitCode: number }> {
    if (!this.available || !this.docker) {
      return { output: "", exitCode: -1 };
    }
    const containerInfo = this.userContainers.get(username);
    if (!containerInfo) {
      return { output: "Container not found", exitCode: -1 };
    }
    try {
      const container = this.docker.getContainer(containerInfo.id);
      const exec = await container.exec({
        Cmd: command,
        AttachStdout: true,
        AttachStderr: true,
        Tty: options.Tty || false,
        Env: options.Env,
        WorkingDir: options.Cwd,
      });
      const stream = await exec.start({ Tty: options.Tty || false, stdin: false });
      let output = "";
      stream.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
      });
      stream.on("error", () => {});
      const inspect = await exec.inspect();
      const exitCode = inspect.ExitCode || 0;
      return { output, exitCode };
    } catch (err: any) {
      logger.error({ err: err.message, username, command }, "Docker exec failed");
      return { output: `Error: ${err.message}`, exitCode: -1 };
    }
  }

  createExecStream(
    username: string,
    command: string[],
    options: {
      Cwd?: string;
      Env?: string[];
      cols?: number;
      rows?: number;
    } = {}
  ): Promise<{ stream: NodeJS.ReadWriteStream | null; containerId: string | null }> {
    return new Promise(async (resolve) => {
      if (!this.available || !this.docker) {
        resolve({ stream: null, containerId: null });
        return;
      }
      const containerInfo = this.userContainers.get(username);
      if (!containerInfo) {
        resolve({ stream: null, containerId: null });
        return;
      }
      try {
        const container = this.docker.getContainer(containerInfo.id);
        const exec = await container.exec({
          Cmd: command,
          AttachStdout: true,
          AttachStderr: true,
          AttachStdin: true,
          Tty: true,
          Env: options.Env,
          WorkingDir: options.Cwd,
        });
        const rawStream = await exec.start({ Tty: true, stdin: true, hijack: true });
        const stream = new PassThrough();
        rawStream.on("data", (data: Buffer) => {
          const demuxed = this.demuxTty(data);
          stream.write(demuxed);
        });
        rawStream.on("end", () => stream.end());
        rawStream.on("error", (err: Error) => stream.destroy(err));
        if (options.cols && options.rows) {
          try { await exec.resize({ h: options.rows, w: options.cols }); } catch {}
        }
        resolve({ stream, containerId: containerInfo.id });
      } catch (err: any) {
        logger.error({ err: err.message, username }, "Failed to create exec stream");
        resolve({ stream: null, containerId: null });
      }
    });
  }

  private demuxTty(data: Buffer): Buffer {
    if (data.length < 8) return data;
    const header = data.readUInt8(0);
    const payload = data.subarray(8);
    return header === 1 || header === 0 ? payload : data;
  }

  async getContainerInfo(username: string): Promise<ContainerInfo | null> {
    if (!this.available || !this.docker) return null;
    let info = this.userContainers.get(username);
    if (!info) {
      const name = this.containerName(username);
      try {
        const containers = await this.docker.listContainers({ all: true });
        const c = containers.find((cc) => cc.Names?.includes(`/${name}`));
        if (c) {
          const detail = await this.docker.getContainer(c.Id).inspect();
          info = {
            id: c.Id,
            username,
            userId: detail.Config.Labels?.["server-hub.userid"] || "",
            created: new Date(detail.Created),
            status: c.State,
            restartCount: detail.RestartCount || 0,
          };
          this.userContainers.set(username, info);
        }
      } catch {}
    }
    return info;
  }

  async getContainerStats(username: string): Promise<ContainerStats | null> {
    if (!this.available || !this.docker) return null;
    const containerInfo = this.userContainers.get(username);
    if (!containerInfo) return null;
    try {
      const container = this.docker.getContainer(containerInfo.id);
      const stats = await container.stats({ stream: false });
      const memUsed = stats.memory_stats.usage || 0;
      const memTotal = stats.memory_stats.limit || 0;
      const cpuDelta =
        stats.cpu_stats.cpu_usage.total_usage -
        (stats.precpu_stats.cpu_usage.total_usage || 0);
      const systemDelta =
        stats.cpu_stats.system_cpu_usage -
        (stats.precpu_stats.system_cpu_usage || 0);
      const cpuCount = stats.cpu_stats.online_cpus || 1;
      const cpuPercent = systemDelta > 0
        ? (cpuDelta / systemDelta) * cpuCount * 100
        : 0;

      let netRx = 0, netTx = 0, blockRx = 0, blockTx = 0;
      if (stats.networks) {
        for (const iface of Object.values(stats.networks) as any[]) {
          netRx += iface.rx_bytes || 0;
          netTx += iface.tx_bytes || 0;
        }
      }
      if (stats.blkio_stats?.io_service_bytes_recursive) {
        for (const entry of stats.blkio_stats.io_service_bytes_recursive) {
          if (entry.op === "read") blockRx += entry.value || 0;
          if (entry.op === "write") blockTx += entry.value || 0;
        }
      }

      const processResult = await this.execInContainer(username, [
        "ps", "aux", "--no-headers", "|", "wc", "-l",
      ]);
      const processCount = parseInt(processResult.output.trim(), 10) || 0;

      const uptime = stats.statsd ? Date.now() / 1000 - stats.statsd : 0;

      return {
        cpu_percent: Math.round(cpuPercent * 10) / 10,
        mem_used: memUsed,
        mem_total: memTotal,
        mem_percent: memTotal > 0 ? Math.round((memUsed / memTotal) * 1000) / 10 : 0,
        net_rx: netRx,
        net_tx: netTx,
        block_rx: blockRx,
        block_tx: blockTx,
        process_count: processCount,
        uptime,
      };
    } catch {
      return null;
    }
  }

  async getContainerProcesses(username: string): Promise<any[]> {
    const result = await this.execInContainer(username, [
      "ps", "aux", "--sort=-%cpu", "--no-headers",
    ]);
    if (result.exitCode !== 0) return [];
    return result.output
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(0, 30)
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        return {
          pid: parseInt(parts[1], 10) || 0,
          user: parts[0] || "unknown",
          cpu: parseFloat(parts[2]) || 0,
          memory: parseFloat(parts[3]) || 0,
          command: parts.slice(10).join(" ") || "unknown",
        };
      });
  }

  async getContainerLogs(username: string, tail: number = 100): Promise<ContainerLogEntry[]> {
    if (!this.available || !this.docker) return [];
    const containerInfo = this.userContainers.get(username);
    if (!containerInfo) return [];
    try {
      const container = this.docker.getContainer(containerInfo.id);
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        tail,
        timestamps: true,
      });
      const entries: ContainerLogEntry[] = [];
      const lines = logs.toString("utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        if (line.length < 30) continue;
        const ts = line.substring(0, 30).trim();
        const msg = line.substring(30).replace(/^\x01\x00\x00\x00\x00\x00\x00/, "").replace(/^\x02\x00\x00\x00\x00\x00\x00/, "");
        const streamFlag = line.charCodeAt(0) === 1 ? "stdout" : "stderr";
        entries.push({ timestamp: ts, stream: streamFlag, message: msg });
      }
      return entries;
    } catch {
      return [];
    }
  }

  async startContainer(username: string): Promise<boolean> {
    const containerInfo = this.userContainers.get(username);
    if (!containerInfo || !this.docker) return false;
    try {
      const container = this.docker.getContainer(containerInfo.id);
      await container.start();
      containerInfo.status = "running";
      logger.info({ username }, "Container started");
      return true;
    } catch (err: any) {
      logger.error({ err: err.message, username }, "Failed to start container");
      return false;
    }
  }

  async stopContainer(username: string): Promise<boolean> {
    const containerInfo = this.userContainers.get(username);
    if (!containerInfo || !this.docker) return false;
    try {
      const container = this.docker.getContainer(containerInfo.id);
      await container.stop({ t: 10 });
      containerInfo.status = "stopped";
      logger.info({ username }, "Container stopped");
      return true;
    } catch (err: any) {
      logger.error({ err: err.message, username }, "Failed to stop container");
      return false;
    }
  }

  async restartContainer(username: string): Promise<boolean> {
    const containerInfo = this.userContainers.get(username);
    if (!containerInfo || !this.docker) return false;
    try {
      const container = this.docker.getContainer(containerInfo.id);
      await container.restart({ t: 5 });
      containerInfo.status = "running";
      logger.info({ username }, "Container restarted");
      return true;
    } catch (err: any) {
      logger.error({ err: err.message, username }, "Failed to restart container");
      return false;
    }
  }

  async pauseContainer(username: string): Promise<boolean> {
    const containerInfo = this.userContainers.get(username);
    if (!containerInfo || !this.docker) return false;
    try {
      const container = this.docker.getContainer(containerInfo.id);
      await container.pause();
      containerInfo.status = "paused";
      logger.info({ username }, "Container paused");
      return true;
    } catch (err: any) {
      logger.error({ err: err.message, username }, "Failed to pause container");
      return false;
    }
  }

  async unpauseContainer(username: string): Promise<boolean> {
    const containerInfo = this.userContainers.get(username);
    if (!containerInfo || !this.docker) return false;
    try {
      const container = this.docker.getContainer(containerInfo.id);
      await container.unpause();
      containerInfo.status = "running";
      logger.info({ username }, "Container unpaused");
      return true;
    } catch (err: any) {
      logger.error({ err: err.message, username }, "Failed to unpause container");
      return false;
    }
  }

  async removeContainer(username: string): Promise<boolean> {
    const containerInfo = this.userContainers.get(username);
    if (!containerInfo || !this.docker) return false;
    try {
      const container = this.docker.getContainer(containerInfo.id);
      await container.stop({ t: 5 });
      await container.remove({ v: true });
      this.userContainers.delete(username);
      logger.info({ username }, "User container removed");
      return true;
    } catch (err: any) {
      logger.error({ err: err.message, username }, "Failed to remove container");
      return false;
    }
  }

  async stopUserContainers(): Promise<void> {
    if (!this.docker) return;
    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: { label: ["server-hub.managed=true"] },
      });
      for (const c of containers) {
        try {
          const container = this.docker.getContainer(c.Id);
          if (c.State === "running") await container.stop({ t: 10 });
          await container.remove({ v: true });
        } catch {}
      }
      this.userContainers.clear();
      logger.info("All user containers cleaned up");
    } catch (err: any) {
      logger.error({ err: err.message }, "Failed to clean up containers");
    }
  }

  async getContainerStatsAll(): Promise<{ username: string; stats: ContainerStats | null }[]> {
    const results: { username: string; stats: ContainerStats | null }[] = [];
    for (const username of this.userContainers.keys()) {
      const stats = await this.getContainerStats(username);
      results.push({ username, stats });
    }
    return results;
  }

  getContainerIds(): string[] {
    return Array.from(this.userContainers.values()).map((c) => c.id);
  }

  getContainerUsers(): string[] {
    return Array.from(this.userContainers.keys());
  }

  getAllContainerInfos(): ContainerInfo[] {
    return Array.from(this.userContainers.values());
  }

  async destroy(): Promise<void> {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    if (this.eventMonitor) {
      try { this.eventMonitor.destroy(); } catch {}
    }
    await this.stopUserContainers();
  }

  execFileRead(username: string, filePath: string): Promise<string | null> {
    return this.execInContainer(username, ["cat", filePath], { Tty: false }).then(
      (r) => (r.exitCode !== 0 ? null : r.output)
    );
  }

  async execFileWrite(username: string, filePath: string, content: string): Promise<boolean> {
    const escaped = content.replace(/\\/g, "\\\\").replace(/'/g, "'\\''");
    const result = await this.execInContainer(username, [
      "bash", "-c", `mkdir -p "$(dirname '${filePath}')" && cat > '${filePath}' << 'ENDOFFILE'\n${content}\nENDOFFILE`,
    ]);
    return result.exitCode === 0;
  }

  execFileDelete(username: string, filePath: string): Promise<boolean> {
    return this.execInContainer(username, ["rm", "-rf", filePath]).then((r) => r.exitCode === 0);
  }

  async execFileList(username: string, dirPath: string): Promise<any[] | null> {
    const result = await this.execInContainer(username, [
      "bash", "-c",
      `ls -la '${dirPath}' 2>/dev/null | tail -n +2 | while read perms links owner group size mon day time name; do
        if [ -L "$name" ]; then echo "LINK|$name|$size|$mon $day $time";
        elif [ -d "$name" ]; then echo "DIR|$name|$size|$mon $day $time";
        else echo "FILE|$name|$size|$mon $day $time"; fi; done`,
    ]);
    if (result.exitCode !== 0) return null;
    const items: any[] = [];
    const lines = result.output.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      const parts = line.split("|");
      if (parts.length < 4) continue;
      const [type, name, size, dateStr] = parts;
      items.push({
        name,
        path: `${dirPath}/${name}`.replace(/\/+/g, "/"),
        is_dir: type === "DIR",
        size: type === "DIR" ? "-" : size,
        modified: dateStr,
      });
    }
    return items;
  }

  execFileStats(username: string, filePath: string): Promise<{
    exists: boolean; is_dir: boolean; size: number; modified: string;
  } | null> {
    return this.execInContainer(username, [
      "stat", "--format=%F|%s|%Y", filePath,
    ]).then((result) => {
      if (result.exitCode !== 0) return null;
      const parts = result.output.trim().split("|");
      if (parts.length < 3) return null;
      return {
        exists: true,
        is_dir: parts[0] === "directory",
        size: parseInt(parts[1], 10) || 0,
        modified: new Date(parseInt(parts[2], 10) * 1000).toISOString(),
      };
    });
  }

  execMkdir(username: string, dirPath: string): Promise<boolean> {
    return this.execInContainer(username, ["mkdir", "-p", dirPath]).then((r) => r.exitCode === 0);
  }

  execRename(username: string, oldPath: string, newPath: string): Promise<boolean> {
    return this.execInContainer(username, [
      "bash", "-c",
      `mkdir -p "$(dirname '${newPath}')" && mv '${oldPath}' '${newPath}'`,
    ]).then((r) => r.exitCode === 0);
  }

  async execFileSearch(username: string, query: string, searchPath: string = "/home/runner"): Promise<any[]> {
    const result = await this.execInContainer(username, [
      "bash", "-c",
      `find '${searchPath}' -maxdepth 5 -iname '*${query}*' -not -path '*/.*' 2>/dev/null | head -50`,
    ]);
    if (result.exitCode !== 0) return [];
    const items: any[] = [];
    for (const line of result.output.trim().split("\n").filter(Boolean)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const statResult = await this.execFileStats(username, trimmed);
      items.push({
        name: trimmed.split("/").pop() || trimmed,
        path: trimmed,
        is_dir: statResult?.is_dir || false,
        size: statResult?.size || 0,
        modified: statResult?.modified || "",
      });
    }
    return items;
  }

  async execExtract(username: string, archivePath: string, destDir?: string): Promise<boolean> {
    const dest = destDir || `/home/runner`;
    const lower = archivePath.toLowerCase();
    let cmd: string[] = [];
    if (lower.endsWith(".zip")) {
      cmd = ["unzip", "-o", archivePath, "-d", dest];
    } else if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
      cmd = ["tar", "-xzf", archivePath, "-C", dest];
    } else if (lower.endsWith(".tar")) {
      cmd = ["tar", "-xf", archivePath, "-C", dest];
    } else {
      return false;
    }
    const result = await this.execInContainer(username, cmd);
    return result.exitCode === 0;
  }
}

export const dockerManager = new DockerManager();
