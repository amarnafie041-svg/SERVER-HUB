import { useState, useEffect } from "react";
import { Globe, Server, Copy, Check, ExternalLink, ArrowRight } from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";

export default function DomainsPage() {
  const { user } = useAuth();
  const [domainInfo, setDomainInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    api.getDomainInfo()
      .then(setDomainInfo)
      .catch(() => {})
      .finally(() => setLoading(false));
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
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-white">Domains & Ports</h1>
        <p className="text-zinc-400 mt-1">Manage your subdomain and port configuration</p>
      </div>

      {/* Current Domain */}
      <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Globe className="w-5 h-5 text-purple-400" />
          Your Subdomain
        </h2>

        <div className="rounded-lg p-4 mb-4" style={{ background: "var(--background)" }}>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
              <Globe className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-lg font-mono text-white">{domainInfo?.subdomain}</p>
              <p className="text-sm text-zinc-400">Port: {domainInfo?.port}</p>
            </div>
            <a href={domainInfo?.urls?.subdomain} target="_blank" rel="noopener" className="flex items-center gap-2 px-4 py-2 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/20 rounded-lg text-purple-400 transition-colors">
              <ExternalLink className="w-4 h-4" />
              Visit
            </a>
          </div>
        </div>

        {/* All URLs */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-zinc-400">Access URLs</h3>
          {[
            { label: "Subdomain", url: domainInfo?.urls?.subdomain, desc: "Your unique subdomain" },
            { label: "Local", url: domainInfo?.urls?.local, desc: "Direct port access" },
            { label: "Path-based", url: domainInfo?.urls?.direct, desc: "Server path routing" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-3 rounded-lg p-3" style={{ background: "var(--background)" }}>
              <span className="text-xs text-zinc-500 w-20">{item.label}</span>
              <span className="text-sm text-white font-mono flex-1">{item.url}</span>
              <button onClick={() => copyToClipboard(item.url || "", item.label)} className="p-1 text-zinc-400 hover:text-white transition-colors">
                {copied === item.label ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
              </button>
              <a href={item.url} target="_blank" rel="noopener" className="p-1 text-zinc-400 hover:text-white transition-colors">
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          ))}
        </div>
      </div>

      {/* Domain Format */}
      <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Server className="w-5 h-5 text-amber-400" />
          Domain Format
        </h2>

        <div className="rounded-lg p-4" style={{ background: "var(--background)" }}>
          <div className="text-center">
            <p className="text-2xl font-mono text-white mb-2">
              <span className="text-purple-400">{user?.username}</span>
              <span className="text-zinc-500">.</span>
              <span className="text-indigo-400">server.app</span>
            </p>
            <p className="text-sm text-zinc-400">
              Your subdomain follows the format: <code className="text-white px-1 rounded" style={{ background: "var(--card)" }}>username.server.app</code>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
