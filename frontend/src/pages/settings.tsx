import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth";
import { useLang } from "@/contexts/language";
import { api } from "@/lib/api";
import { MessageSquare, Globe, Bell, Save, TestTube2, Loader2, Settings2, User, AtSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

interface Settings {
  telegram_bot_token: string;
  telegram_chat_id: string;
  telegram_enabled: boolean;
  language: "en" | "ar";
  notifications: { login: boolean; register: boolean; file_upload: boolean; server_error: boolean };
}

export default function SettingsPage() {
  const { user } = useAuth();
  const { t, lang, setLang } = useLang();
  const { toast } = useToast();
  const [settings, setSettings] = useState<Settings>({
    telegram_bot_token: "", telegram_chat_id: "", telegram_enabled: false, language: "en",
    notifications: { login: true, register: true, file_upload: true, server_error: true },
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try { setSettings(await api.getSettings()); } catch {} finally { setLoading(false); }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      await api.updateSettings({ ...settings, language: lang });
      toast({ title: t("success"), description: t("settings_saved") });
    } catch { toast({ title: t("error"), description: "Failed to save settings", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const testTelegram = async () => {
    setTesting(true);
    try {
      await api.testTelegram();
      toast({ title: t("success"), description: t("test_success") });
    } catch { toast({ title: t("error"), description: t("test_failed"), variant: "destructive" }); }
    finally { setTesting(false); }
  };

  const update = (key: keyof Settings, value: unknown) => setSettings((prev) => ({ ...prev, [key]: value }));
  const updateNotif = (key: keyof Settings["notifications"], value: boolean) => setSettings((prev) => ({ ...prev, notifications: { ...prev.notifications, [key]: value } }));

  if (loading) return <div className="flex items-center justify-center h-full text-zinc-500">{t("loading")}</div>;

  const Toggle = ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
    <button onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${checked ? "bg-accent" : "bg-zinc-700"}`}>
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  );

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4 md:space-y-6">
      <div className="animate-fadeIn">
        <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2"><Settings2 className="w-5 h-5 text-accent" /> {t("settings_title")}</h1>
        <p className="text-zinc-400 text-sm mt-1">Configure system preferences</p>
      </div>

      {/* Admin info */}
      <div className="rounded-2xl border p-4 animate-fadeIn flex items-center gap-3"
        style={{ background: "#140a24", borderColor: "rgba(139,92,246,0.2)" }}>
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 overflow-hidden"
          style={{ background: user?.avatar ? "none" : "linear-gradient(135deg,#6d28d9,#a855f7)" }}>
          {user?.avatar ? <img src={user.avatar} className="w-full h-full object-cover" /> : (user?.display_name || "?")[0].toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{user?.display_name}</p>
          <p className="text-[10px] text-zinc-500">@{user?.username} — {user?.role}</p>
        </div>
        <span className="text-[10px] text-zinc-600 font-mono">Settings</span>
      </div>

      <section className="rounded-2xl border p-4 md:p-5 space-y-4 animate-fadeIn" style={{ background: "#140a24", borderColor: "rgba(139,92,246,0.2)" }}>
        <div className="flex items-center gap-2 font-medium text-white">
          <Globe className="w-4 h-4 text-accent" />{t("language_settings")}
        </div>
        <p className="text-xs text-zinc-500 -mt-2">Choose the interface language for the dashboard</p>
        <div className="flex gap-3">
          {(["en", "ar"] as const).map((l) => (
            <button key={l} onClick={() => setLang(l)}
              className={`flex-1 py-3 rounded-xl border font-medium text-sm transition-all ${lang === l ? "border-accent bg-accent/10 text-accent shadow-[0_0_15px_rgba(139,92,246,0.15)]" : "border-border text-zinc-400 hover:border-[rgba(139,92,246,0.4)] hover:text-white"}`}>
              {l === "en" ? "🇬🇧 English" : "🇸🇦 العربية"}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border p-4 md:p-5 space-y-4 animate-fadeIn" style={{ background: "#140a24", borderColor: "rgba(139,92,246,0.2)" }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 font-medium text-white">
              <MessageSquare className="w-4 h-4 text-accent" />{t("telegram_settings")}
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">Get real-time notifications via Telegram bot</p>
          </div>
          <Toggle checked={settings.telegram_enabled} onChange={(v) => update("telegram_enabled", v)} />
        </div>
        {settings.telegram_enabled && (
          <div className="space-y-3 pt-1 animate-fadeIn">
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">Bot Token</label>
              <Input value={settings.telegram_bot_token} onChange={(e) => update("telegram_bot_token", e.target.value)}
                placeholder="1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ" className="bg-[#1d1033] border-[rgba(139,92,246,0.3)] text-white font-mono text-sm" />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">Chat ID</label>
              <Input value={settings.telegram_chat_id} onChange={(e) => update("telegram_chat_id", e.target.value)}
                placeholder="-100123456789" className="bg-[#1d1033] border-[rgba(139,92,246,0.3)] text-white font-mono text-sm" />
            </div>
            <div className="flex items-center gap-3 pt-1">
              <Button variant="outline" onClick={testTelegram} disabled={testing || !settings.telegram_bot_token || !settings.telegram_chat_id}
                className="border-[rgba(139,92,246,0.3)] text-zinc-300 hover:text-white gap-2 text-sm">
                {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <TestTube2 className="w-4 h-4" />}
                {testing ? t("testing") : t("test_connection")}
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border p-4 md:p-5 space-y-4 animate-fadeIn" style={{ background: "#140a24", borderColor: "rgba(139,92,246,0.2)" }}>
        <div>
          <div className="flex items-center gap-2 font-medium text-white">
            <Bell className="w-4 h-4 text-accent" />Notification Events
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">Choose which events trigger Telegram notifications</p>
        </div>
        <div className="space-y-3">
          {([["login", t("notify_login")], ["register", t("notify_register")], ["file_upload", t("notify_upload")], ["server_error", t("notify_error")]] as const).map(([key, label]) => (
            <label key={key} className="flex items-center justify-between cursor-pointer group py-0.5">
              <span className="text-sm text-zinc-300 group-hover:text-white transition-colors">{label}</span>
              <Toggle checked={settings.notifications[key]} onChange={(v) => updateNotif(key, v)} />
            </label>
          ))}
        </div>
      </section>

      <Button onClick={saveSettings} disabled={saving} className="w-full h-11 font-semibold gap-2 transition-all hover:scale-[1.02] active:scale-[0.98]"
        style={{ background: "linear-gradient(135deg,#6d28d9,#a855f7)" }}>
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        {saving ? t("loading") : t("save_settings")}
      </Button>
    </div>
  );
}
