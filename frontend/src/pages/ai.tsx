import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  Send, Bot, User, Copy, Check, Trash2, FileSearch,
  ChevronDown, Loader2, Sparkles, Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { api, BASE } from "@/lib/api";
import { useAuth } from "@/contexts/auth";

type Model = "chat" | "console";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
  timestamp: Date;
  streaming?: boolean;
}

const MODEL_CONFIG = {
  chat: { label: "GPT-OSS 20B", icon: Sparkles, color: "#8b5cf6" },
  console: { label: "Qwen 3.5 397B", icon: Terminal, color: "#a855f7" },
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="p-1.5 rounded text-zinc-500 hover:text-white hover:bg-white/10 transition-colors">
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

export default function AIPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState<Model>("chat");
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeTab, setActiveTab] = useState<"chat" | "analyze">("chat");
  const [analyzePath, setAnalyzePath] = useState("");
  const [analyzeQuestion, setAnalyzeQuestion] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const sendMessage = useCallback(async () => {
    const msg = input.trim();
    if (!msg || isStreaming) return;
    setInput("");

    const userMsg: Message = { id: Math.random().toString(36).slice(2), role: "user", content: msg, timestamp: new Date() };
    const assistantMsg: Message = { id: Math.random().toString(36).slice(2), role: "assistant", content: "", model: MODEL_CONFIG[model].label, timestamp: new Date(), streaming: true };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);

    const history = messages.slice(-10).map((m) => ({ role: m.role, content: m.content }));
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch(`${BASE}/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, model, history, stream: true }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) throw new Error("Stream failed");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              fullContent = parsed.content;
              setMessages((prev) => prev.map((m) => m.id === assistantMsg.id ? { ...m, content: fullContent } : m));
            }
          } catch {}
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setMessages((prev) => prev.map((m) => m.id === assistantMsg.id ? { ...m, content: "Sorry, something went wrong. Please try again." } : m));
      }
    } finally {
      setIsStreaming(false);
      setMessages((prev) => prev.map((m) => m.id === assistantMsg.id ? { ...m, streaming: false } : m));
    }
  }, [input, isStreaming, model, messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const handleAnalyze = async () => {
    if (!analyzePath.trim() || !analyzeQuestion.trim() || analyzing) return;
    setAnalyzing(true);
    try {
      const response = await fetch(`${BASE}/api/ai/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: analyzePath, question: analyzeQuestion }),
      });
      const result = await response.json();
      const userMsg: Message = { id: Math.random().toString(36).slice(2), role: "user", content: `Analyze file: ${analyzePath}\n\n${analyzeQuestion}`, timestamp: new Date() };
      const aiMsg: Message = { id: Math.random().toString(36).slice(2), role: "assistant", content: result.content || result.error || "No response", model: result.model, timestamp: new Date() };
      setMessages((prev) => [...prev, userMsg, aiMsg]);
      setActiveTab("chat");
    } catch { toast({ title: "Analysis failed", variant: "destructive" }); }
    finally { setAnalyzing(false); }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b shrink-0" style={{ background: "#0b0616", borderColor: "rgba(52,211,153,0.15)" }}>
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4" style={{ color: "rgba(52,211,153,0.6)" }} />
          <span className="text-xs font-mono" style={{ color: "rgba(52,211,153,0.5)" }}>AI_TERMINAL</span>
          <div className="flex ml-3 overflow-hidden rounded" style={{ border: "1px solid rgba(52,211,153,0.15)" }}>
            <button onClick={() => setActiveTab("chat")}
              className={`px-3 py-1 text-[10px] font-mono transition-colors ${activeTab === "chat" ? "text-emerald-300" : "text-zinc-600 hover:text-zinc-400"}`}
              style={activeTab === "chat" ? { background: "rgba(52,211,153,0.1)" } : {}}>chat</button>
            <button onClick={() => setActiveTab("analyze")}
              className={`px-3 py-1 text-[10px] font-mono transition-colors ${activeTab === "analyze" ? "text-emerald-300" : "text-zinc-600 hover:text-zinc-400"}`}
              style={activeTab === "analyze" ? { background: "rgba(52,211,153,0.1)" } : {}}>analyze</button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <select value={model} onChange={(e) => setModel(e.target.value as Model)}
              className="appearance-none h-7 pl-2 pr-6 text-[10px] font-mono rounded border cursor-pointer outline-none"
              style={{ background: "rgba(52,211,153,0.05)", borderColor: "rgba(52,211,153,0.2)", color: "rgba(52,211,153,0.7)" }}>
              {Object.entries(MODEL_CONFIG).map(([key, cfg]) => <option key={key} value={key}>{cfg.label}</option>)}
            </select>
            <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none" style={{ color: "rgba(52,211,153,0.4)" }} />
          </div>
          <Button variant="ghost" size="sm" onClick={() => setMessages([])} className="h-7 px-1.5" style={{ color: "rgba(52,211,153,0.4)" }} title="Clear chat">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {activeTab === "analyze" ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-4 max-w-xl mx-auto w-full">
          <div className="text-center mb-2">
            <span className="text-lg font-mono" style={{ color: "rgba(52,211,153,0.3)" }}>╔═ file analyzer ═╗</span>
            <p className="text-[10px] font-mono mt-2" style={{ color: "rgba(52,211,153,0.3)" }}>analyze any file with AI assistance</p>
          </div>
          <div className="w-full space-y-3">
            <div>
              <label className="text-[10px] font-mono mb-1 block" style={{ color: "rgba(52,211,153,0.4)" }}>$ file_path</label>
              <Input value={analyzePath} onChange={(e) => setAnalyzePath(e.target.value)} placeholder="/path/to/file.py"
                className="font-mono text-sm" style={{ background: "rgba(52,211,153,0.03)", borderColor: "rgba(52,211,153,0.2)", color: "rgba(52,211,153,0.7)" }} />
            </div>
            <div>
              <label className="text-[10px] font-mono mb-1 block" style={{ color: "rgba(52,211,153,0.4)" }}>$ question</label>
              <textarea value={analyzeQuestion} onChange={(e) => setAnalyzeQuestion(e.target.value)}
                placeholder="what does this file do?" rows={4}
                className="w-full px-3 py-2 rounded font-mono text-sm resize-none focus:outline-none"
                style={{ background: "rgba(52,211,153,0.03)", border: "1px solid rgba(52,211,153,0.2)", color: "rgba(52,211,153,0.7)" }} />
            </div>
            <Button onClick={handleAnalyze} disabled={analyzing || !analyzePath.trim() || !analyzeQuestion.trim()}
              className="w-full font-mono text-xs"
              style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.2)", color: "rgba(52,211,153,0.7)" }}>
              {analyzing ? <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> processing...</> : <><FileSearch className="w-3.5 h-3.5 mr-2" /> analyze</>}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
                <div className="flex flex-col items-center gap-2">
                  <span className="text-2xl font-mono" style={{ color: "rgba(52,211,153,0.3)" }}>╭──────────────────╮</span>
                  <span className="text-lg font-mono tracking-widest" style={{ color: "rgba(52,211,153,0.5)" }}>AI TERMINAL</span>
                  <span className="text-2xl font-mono" style={{ color: "rgba(52,211,153,0.3)" }}>╰──────────────────╯</span>
                </div>
                <p className="text-xs font-mono" style={{ color: "rgba(52,211,153,0.3)" }}>ask anything about servers, code, or linux</p>
                <div className="grid grid-cols-2 gap-2 max-w-md w-full mt-2">
                  {["how to monitor CPU?", "explain bash script", "set up nginx?", "debug python code"].map((s) => (
                    <button key={s} onClick={() => { setInput(s); textareaRef.current?.focus(); }}
                      className="px-3 py-2 text-xs font-mono text-left rounded border transition-all"
                      style={{ borderColor: "rgba(52,211,153,0.15)", color: "rgba(52,211,153,0.4)", background: "rgba(52,211,153,0.03)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(52,211,153,0.4)"; e.currentTarget.style.color = "rgba(52,211,153,0.7)"; e.currentTarget.style.background = "rgba(52,211,153,0.08)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(52,211,153,0.15)"; e.currentTarget.style.color = "rgba(52,211,153,0.4)"; e.currentTarget.style.background = "rgba(52,211,153,0.03)"; }}>{s}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 mt-1 ${
                  msg.role === "assistant" ? "text-emerald-400" : "text-accent"
                }`}>
                  {msg.role === "user" ? <span className="text-xs font-mono">&gt;</span> : <span className="text-xs font-mono">#</span>}
                </div>
                <div className={`max-w-[85%] flex flex-col gap-1`}>
                  {msg.role === "assistant" && msg.model && (
                    <span className="text-[9px] font-mono" style={{ color: "rgba(52,211,153,0.5)" }}>
                      ──[{msg.model}]
                    </span>
                  )}
                  {msg.role === "user" && (
                    <span className="text-[9px] font-mono" style={{ color: "rgba(168,85,247,0.5)" }}>
                      ──[{user?.display_name || user?.username || "user"}]
                    </span>
                  )}
                  <div className={`px-3 py-2 text-sm font-mono leading-relaxed`}
                    style={msg.role === "user"
                      ? { background: "rgba(168,85,247,0.08)", borderLeft: "2px solid rgba(168,85,247,0.4)", color: "#d8b4fe" }
                      : { background: "rgba(52,211,153,0.04)", borderLeft: "2px solid rgba(52,211,153,0.3)", color: "#6ee7b7" }}>
                    {msg.streaming ? (
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-4 bg-emerald-400 inline-block animate-pulse" />
                        <span className="text-xs text-emerald-600 font-mono">processing...</span>
                      </div>
                    ) : (
                      <div className="prose prose-invert prose-sm max-w-none font-mono">
                        <ReactMarkdown components={{
                          code({ node, className, children, ...props }: any) {
                            const inline = !className;
                            const match = /language-(\w+)/.exec(className || "");
                            const codeString = String(children).replace(/\n$/, "");
                            if (!inline && match) {
                              return (
                                <div className="relative my-2 overflow-hidden" style={{ border: "1px solid rgba(52,211,153,0.15)" }}>
                                  <div className="flex items-center justify-between px-3 py-1 text-xs font-mono" style={{ background: "rgba(52,211,153,0.06)", color: "rgba(52,211,153,0.5)" }}>
                                    <span>{match[1]}</span><CopyButton text={codeString} />
                                  </div>
                                  <SyntaxHighlighter style={vscDarkPlus as any} language={match[1]} PreTag="div"
                                    customStyle={{ margin: 0, padding: "12px", fontSize: "12px" }}>{codeString}</SyntaxHighlighter>
                                </div>
                              );
                            }
                            return <code className="bg-black/40 px-1 py-0.5 rounded font-mono" style={{ color: "rgba(52,211,153,0.9)", fontSize: "11px" }} {...props}>{children}</code>;
                          },
                        }}>{msg.content}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                  {msg.role === "assistant" && !msg.streaming && (
                    <div className="flex gap-2 px-1">
                      <CopyButton text={msg.content} />
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className="px-4 py-2 border-t shrink-0" style={{ background: "#0b0616", borderColor: "rgba(52,211,153,0.1)" }}>
            <div className="flex gap-2 items-end rounded p-2" style={{ border: "1px solid rgba(52,211,153,0.15)", background: "#05020a" }}>
              <span className="text-xs font-mono pb-1.5 shrink-0" style={{ color: "rgba(52,211,153,0.4)" }}>$</span>
              <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
                placeholder="type your command..." rows={1}
                className="flex-1 bg-transparent border-none text-sm font-mono resize-none focus:ring-0 focus:outline-none max-h-32 py-1.5"
                style={{ color: "rgba(52,211,153,0.7)", minHeight: "28px", caretColor: "rgba(52,211,153,0.8)" }} />
              <Button onClick={sendMessage} disabled={!input.trim() || isStreaming} size="icon" className="h-7 w-7 shrink-0 rounded"
                style={input.trim() && !isStreaming ? { background: "rgba(52,211,153,0.15)", color: "rgba(52,211,153,0.7)" } : { background: "transparent", color: "rgba(52,211,153,0.2)" }}>
                {isStreaming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              </Button>
            </div>
            <p className="text-[9px] font-mono mt-1 text-center" style={{ color: "rgba(52,211,153,0.2)" }}>// AI may make mistakes</p>
          </div>
        </>
      )}
    </div>
  );
}
