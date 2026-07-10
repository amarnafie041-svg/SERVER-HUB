import { useState, useEffect } from "react";
import { Globe, Server, ExternalLink, Copy, Check, Code, Package, ArrowUpRight } from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";

export default function HostingPage() {
  const { user } = useAuth();
  const [hostingStatus, setHostingStatus] = useState<any>(null);
  const [languages, setLanguages] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    Promise.all([
      api.getHostingStatus().catch(() => null),
      api.getHostingLanguages().catch(() => ({ languages: [] })),
      api.getHostingTemplates().catch(() => ({ templates: [] })),
    ]).then(([status, langs, temp]) => {
      setHostingStatus(status);
      setLanguages(langs?.languages || []);
      setTemplates(temp?.templates || []);
      setLoading(false);
    });
  }, []);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-white">Hosting</h1>
        <p className="text-zinc-400 mt-1">Manage your hosted applications</p>
      </div>

      {/* URLs */}
      <div className="rounded-xl border p-5" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Globe className="w-5 h-5 text-purple-400" />
          Your URLs
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: "Subdomain", url: hostingStatus?.urls?.subdomain, key: "subdomain" },
            { label: "Local", url: hostingStatus?.urls?.local, key: "local" },
            { label: "Direct", url: hostingStatus?.urls?.direct, key: "direct" },
          ].map((item) => (
            <div key={item.key} className="rounded-lg p-4" style={{ background: "var(--background)" }}>
              <p className="text-xs text-zinc-500 mb-1">{item.label}</p>
              <div className="flex items-center gap-2">
                <span className="text-sm text-white font-mono flex-1 truncate">{item.url}</span>
                <button onClick={() => copyToClipboard(item.url || "", item.key)} className="p-1 text-zinc-400 hover:text-white transition-colors">
                  {copied === item.key ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                </button>
                <a href={item.url} target="_blank" rel="noopener" className="p-1 text-zinc-400 hover:text-white transition-colors">
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Supported Languages */}
      <div className="rounded-xl border p-5" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Code className="w-5 h-5 text-purple-400" />
          Supported Languages
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {languages.map((lang) => (
            <div key={lang.name} className="rounded-lg p-4 border" style={{ background: "var(--background)", borderColor: "var(--border)" }}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-lg" style={{ backgroundColor: lang.color + "20", color: lang.color }}>
                  {lang.name[0]}
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{lang.name}</p>
                  <p className="text-xs text-zinc-500 font-mono">{lang.version}</p>
                </div>
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Run:</span>
                  <span className="text-white font-mono">{lang.runCmd}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Install:</span>
                  <span className="text-white font-mono">{lang.installCmd}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Deploy Templates */}
      <div className="rounded-xl border p-5" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Package className="w-5 h-5 text-amber-400" />
          Quick Deploy Templates
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((template) => (
            <div key={template.id} className="rounded-lg p-4 border hover:border-purple-500/30 transition-colors" style={{ background: "var(--background)", borderColor: "var(--border)" }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2 py-0.5 bg-purple-500/10 text-purple-400 text-xs rounded font-mono">{template.language}</span>
              </div>
              <h3 className="text-sm font-medium text-white mb-1">{template.name}</h3>
              <p className="text-xs text-zinc-500 mb-3">{template.description}</p>
              <div className="text-xs text-zinc-500 mb-3 space-y-1">
                <p>Install: <span className="text-white font-mono">{template.installCmd}</span></p>
                <p>Run: <span className="text-white font-mono">{template.runCmd}</span></p>
              </div>
              <a href="#/terminal" className="w-full flex items-center justify-center gap-2 py-2 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 rounded-lg text-sm text-purple-400 transition-colors">
                <ArrowUpRight className="w-4 h-4" />
                Deploy
              </a>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
