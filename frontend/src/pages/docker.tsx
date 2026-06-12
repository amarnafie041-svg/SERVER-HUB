import { useState, useEffect, useCallback } from "react";
import { Play, Square, RefreshCcw, Pause, Trash2, TerminalSquare, Activity, Cpu, HardDrive, Globe, Server, Bug, AlertCircle, CheckCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/auth";
import { useToast } from "@/hooks/use-toast";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(1)} ${units[i]}`;
}

function StatCard({ icon: Icon, label, value, sub, color }: { icon: any; label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl border p-3 flex items-center gap-3" style={{ borderColor: "rgba(139,92,246,0.15)", background: "rgba(20,10,36,0.4)" }}>
      <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: color ? `${color}15` : "rgba(139,92,246,0.1)" }}>
        <Icon className="w-5 h-5" style={{ color: color || "#8b5cf6" }} />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider">{label}</div>
        <div className="text-sm font-bold text-white font-mono truncate">{value}</div>
        {sub && <div className="text-[10px] text-zinc-600">{sub}</div>}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: "bg-green-500/20 text-green-400 border-green-500/30",
    paused: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    stopped: "bg-red-500/20 text-red-400 border-red-500/30",
    exited: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
    created: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  };
  const icons: Record<string, any> = {
    running: CheckCircle,
    paused: Pause,
    stopped: XCircle,
    exited: AlertCircle,
    created: Server,
  };
  const Icon = icons[status] || AlertCircle;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${colors[status] || "bg-zinc-500/20 text-zinc-400"}`}>
      <Icon className="w-3 h-3" /> {status}
    </span>
  );
}

export default function DockerPage() {
  const { user } = useAuth();
  const [available, setAvailable] = useState(false);
  const [containers, setContainers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedContainer, setSelectedContainer] = useState<any>(null);
  const [containerStats, setContainerStats] = useState<any>(null);
  const [containerLogs, setContainerLogs] = useState<any[]>([]);
  const [containerProcs, setContainerProcs] = useState<any[]>([]);
  const [logTail, setLogTail] = useState(50);
  const { toast } = useToast();
  const isAdmin = user?.role === "admin";

  const fetchData = useCallback(async () => {
    try {
      if (isAdmin) {
        const info = await api.getDockerInfo();
        setAvailable(info.available);
        setContainers(info.containers || []);
      } else {
        const info = await api.getMyDockerContainer();
        setAvailable(true);
        const c = info.exists ? [{ ...info }] : [];
        setContainers(c);
        if (info.exists) setSelectedContainer(info as any);
      }
    } catch {
      setAvailable(false);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!selectedContainer) return;
    api.getDockerContainerStats(selectedContainer.username).then(setContainerStats).catch(() => setContainerStats(null));
    api.getDockerContainerLogs(selectedContainer.username, logTail).then(setContainerLogs).catch(() => setContainerLogs([]));
    api.getDockerContainerProcesses(selectedContainer.username).then(setContainerProcs).catch(() => setContainerProcs([]));
    const interval = setInterval(() => {
      if (selectedContainer) {
        api.getDockerContainerStats(selectedContainer.username).then(setContainerStats).catch(() => {});
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [selectedContainer, logTail]);

  const doAction = async (action: string, username: string) => {
    try {
      const adminActions: Record<string, any> = {
        start: api.dockerStartContainer,
        stop: api.dockerStopContainer,
        restart: api.dockerRestartContainer,
        pause: api.dockerPauseContainer,
        unpause: api.dockerUnpauseContainer,
        remove: api.dockerRemoveContainer,
      };
      const myActions: Record<string, any> = {
        start: api.dockerStartMyContainer,
        stop: api.dockerStopMyContainer,
        restart: api.dockerRestartMyContainer,
      };
      const actions = isAdmin ? adminActions : myActions;
      await actions[action]();
      toast({ title: `Container ${action}ed`, description: username });
      fetchData();
      if (selectedContainer?.username === username) {
        if (action === "remove") setSelectedContainer(null);
      }
    } catch (e: any) {
      toast({ title: `Failed to ${action}`, description: e.message, variant: "destructive" });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "#8b5cf6", borderTopColor: "transparent" }} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0" style={{ borderColor: "rgba(139,92,246,0.2)" }}>
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-accent" />
          <h1 className="text-sm font-bold text-white">Docker Container Manager</h1>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={available ? "running" : "stopped"} />
          <span className="text-[11px] text-zinc-500 font-mono">{containers.length} container(s)</span>
          <Button variant="ghost" size="sm" onClick={fetchData} className="h-7 w-7 p-0">
            <RefreshCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {!available ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "rgba(239,68,68,0.1)" }}>
            <XCircle className="w-8 h-8 text-red-400" />
          </div>
          <h2 className="text-lg font-bold text-zinc-400">Docker Not Available</h2>
          <p className="text-sm text-zinc-600 text-center max-w-md">
            Docker socket is not accessible from this environment. Container isolation requires Docker to be installed and running on the host machine with the Docker socket mounted.
          </p>
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          {isAdmin && (
            <div className="w-72 border-r overflow-y-auto shrink-0" style={{ borderColor: "rgba(139,92,246,0.15)" }}>
              <div className="p-2 space-y-1.5">
                {containers.map((c: any) => (
                  <div key={c.username} onClick={() => setSelectedContainer(c)}
                    className={`flex items-center gap-2 p-2.5 rounded-lg cursor-pointer transition-all border ${
                      selectedContainer?.username === c.username
                        ? "bg-primary/20 border-accent/30 text-white"
                        : "hover:bg-white/5 border-transparent text-zinc-400 hover:text-zinc-200"
                    }`}
                    style={{ borderColor: selectedContainer?.username === c.username ? "rgba(139,92,246,0.3)" : "transparent" }}>
                    <TerminalSquare className="w-4 h-4 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-mono font-semibold truncate">{c.username}</div>
                      <StatusBadge status={c.status} />
                    </div>
                    {c.restartCount > 0 && (
                      <span className="text-[9px] text-yellow-500 bg-yellow-500/10 px-1 rounded">{c.restartCount}x</span>
                    )}
                  </div>
                ))}
                {containers.length === 0 && (
                  <div className="text-xs text-zinc-600 text-center py-8">No containers yet</div>
                )}
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {!selectedContainer ? (
              <div className="flex flex-col items-center justify-center h-full text-zinc-600 gap-3">
                <Server className="w-12 h-12 opacity-30" />
                <p className="text-sm">Select a container to view details</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h2 className="text-base font-bold text-white font-mono">{selectedContainer.username}</h2>
                    <StatusBadge status={selectedContainer.status} />
                    {selectedContainer.restartCount > 0 && (
                      <span className="text-[10px] text-yellow-500 bg-yellow-500/10 px-2 py-0.5 rounded-full">
                        Restarts: {selectedContainer.restartCount}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {selectedContainer.status === "stopped" || selectedContainer.status === "exited" ? (
                      <Button variant="ghost" size="sm" onClick={() => doAction("start", selectedContainer.username)} className="h-8 w-8 p-0 text-green-400 hover:text-green-300" title="Start"><Play className="w-4 h-4" /></Button>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => doAction("stop", selectedContainer.username)} className="h-8 w-8 p-0 text-red-400 hover:text-red-300" title="Stop"><Square className="w-4 h-4" /></Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => doAction("restart", selectedContainer.username)} className="h-8 w-8 p-0 text-yellow-400 hover:text-yellow-300" title="Restart"><RefreshCcw className="w-4 h-4" /></Button>
                    {selectedContainer.status === "running" ? (
                      <Button variant="ghost" size="sm" onClick={() => doAction("pause", selectedContainer.username)} className="h-8 w-8 p-0 text-amber-400 hover:text-amber-300" title="Pause"><Pause className="w-4 h-4" /></Button>
                    ) : selectedContainer.status === "paused" ? (
                      <Button variant="ghost" size="sm" onClick={() => doAction("unpause", selectedContainer.username)} className="h-8 w-8 p-0 text-green-400 hover:text-green-300" title="Unpause"><Play className="w-4 h-4" /></Button>
                    ) : null}
                    <Button variant="ghost" size="sm" onClick={() => doAction("remove", selectedContainer.username)} className="h-8 w-8 p-0 text-red-500 hover:text-red-400" title="Remove"><Trash2 className="w-4 h-4" /></Button>
                  </div>
                </div>

                {containerStats && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <StatCard icon={Cpu} label="CPU" value={`${containerStats.cpu_percent}%`} color="#22c55e" />
                    <StatCard icon={Activity} label="Memory" value={formatBytes(containerStats.mem_used)} sub={`${containerStats.mem_percent}% of ${formatBytes(containerStats.mem_total)}`} color="#8b5cf6" />
                    <StatCard icon={Globe} label="Network" value={`${formatBytes(containerStats.net_rx)} / ${formatBytes(containerStats.net_tx)}`} sub="RX / TX" color="#58a6ff" />
                    <StatCard icon={HardDrive} label="Disk I/O" value={`${formatBytes(containerStats.block_rx)} / ${formatBytes(containerStats.block_tx)}`} sub="Read / Write" color="#d29922" />
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-xl border p-3" style={{ borderColor: "rgba(139,92,246,0.15)", background: "rgba(20,10,36,0.4)" }}>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5"><Bug className="w-3.5 h-3.5" /> Processes</h3>
                      <span className="text-[10px] text-zinc-600">{containerStats?.process_count || 0} processes</span>
                    </div>
                    <div className="space-y-0.5 max-h-40 overflow-y-auto">
                      {containerProcs.slice(0, 15).map((p: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 text-[10px] font-mono">
                          <span className="text-zinc-600 w-12 truncate">{p.pid}</span>
                          <span className="text-zinc-500 w-12 truncate">{p.user}</span>
                          <span className="text-green-400 w-10 text-right">{p.cpu}%</span>
                          <span className="text-blue-400 w-12 text-right">{p.memory}%</span>
                          <span className="text-zinc-400 flex-1 truncate">{p.command}</span>
                        </div>
                      ))}
                      {containerProcs.length === 0 && <div className="text-[10px] text-zinc-600 text-center py-4">No process data</div>}
                    </div>
                  </div>

                  <div className="rounded-xl border p-3" style={{ borderColor: "rgba(139,92,246,0.15)", background: "rgba(20,10,36,0.4)" }}>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" /> Logs</h3>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-zinc-600">tail:</span>
                        <select value={logTail} onChange={(e) => setLogTail(parseInt(e.target.value))}
                          className="h-6 text-[10px] bg-[#1d1033] border border-[rgba(139,92,246,0.25)] text-zinc-400 rounded px-1 outline-none">
                          <option value={20}>20</option>
                          <option value={50}>50</option>
                          <option value={100}>100</option>
                          <option value={200}>200</option>
                        </select>
                      </div>
                    </div>
                    <div className="space-y-0.5 max-h-40 overflow-y-auto font-mono">
                      {containerLogs.slice(0, 50).map((log: any, i: number) => (
                        <div key={i} className="text-[9px] leading-relaxed flex gap-1">
                          <span className="text-zinc-700 shrink-0">{log.timestamp?.split(".")[0] || ""}</span>
                          <span className={log.stream === "stderr" ? "text-red-400" : "text-zinc-500"}>{log.message}</span>
                        </div>
                      ))}
                      {containerLogs.length === 0 && <div className="text-[10px] text-zinc-600 text-center py-4">No logs</div>}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
