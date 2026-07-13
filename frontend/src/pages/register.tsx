import { useLang } from "@/contexts/language";
import { Globe, Bot, ArrowRight, ArrowLeft } from "lucide-react";

const LOGO_URL = "https://i.ibb.co/s9P5XZrz/IMG-20260525-202044-835.jpg";

export default function RegisterPage() {
  const { lang, setLang } = useLang();

  const goLogin = () => { window.location.hash = "#/login"; };
  const goHome = () => { window.location.hash = "#/"; };

  const bgStyle: React.CSSProperties = {
    background: "linear-gradient(180deg, #0a0015 0%, #0f0220 30%, #0d0d2b 60%, #0a0015 100%)",
  };

  const cardStyle: React.CSSProperties = {
    background: "rgba(12,4,28,0.92)",
    border: "1px solid rgba(139,92,246,0.25)",
    boxShadow: "0 0 80px rgba(139,92,246,0.08), 0 0 40px rgba(139,92,246,0.05), inset 0 1px 0 rgba(255,255,255,0.04)",
    backdropFilter: "blur(20px)",
  };

  const langBtnStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    backdropFilter: "blur(10px)",
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden" style={bgStyle}>
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[700px] pointer-events-none" style={{ background: "radial-gradient(ellipse 50% 55% at 50% 0%, rgba(120,40,200,0.55) 0%, rgba(90,20,160,0.35) 20%, rgba(60,10,120,0.15) 45%, transparent 70%)" }} />

      <button onClick={() => setLang(lang === "en" ? "ar" : "en")}
        className="absolute top-4 md:top-5 right-4 md:right-5 flex items-center gap-2 px-3 md:px-4 py-2 rounded-xl text-xs md:text-sm font-medium text-white/70 hover:text-white transition-all z-20 cursor-pointer" style={langBtnStyle}>
        <Globe className="w-4 h-4" />
        {lang === "en" ? "العربية" : "English"}
      </button>

      <button onClick={goHome}
        className="absolute top-4 md:top-5 left-4 md:left-5 flex items-center gap-2 px-3 md:px-4 py-2 rounded-xl text-xs md:text-sm font-medium text-white/70 hover:text-white transition-all z-20 cursor-pointer" style={langBtnStyle}>
        {lang === "ar" ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
        {lang === "ar" ? "الرئيسية" : "Home"}
      </button>

      <div className="w-full max-w-[400px] relative z-10" dir={lang === "ar" ? "rtl" : "ltr"}>
        <div className="rounded-3xl p-6 md:p-8 animate-scaleIn" style={cardStyle}>
          <div className="flex flex-col items-center mb-6">
            <div className="w-[100px] h-[100px] md:w-[120px] md:h-[120px] rounded-[20px] flex items-center justify-center mb-4 overflow-hidden"
              style={{ border: "2.5px solid rgba(139,92,246,0.55)", boxShadow: "0 0 40px rgba(139,92,246,0.35)" }}>
              <img src={LOGO_URL} alt="MODMEN" className="w-full h-full object-cover rounded-[18px]" draggable={false} />
            </div>
            <h1 className="text-[18px] md:text-[20px] font-bold tracking-[0.35em] text-white mb-0.5" style={{ fontFamily: "'JetBrains Mono', monospace", textShadow: "0 0 25px rgba(139,92,246,0.3)" }}>
              𝐒𝐄𝐑𝐕𝐄𝐑 𝐇𝐔𝐁
            </h1>
          </div>

          <div className="flex flex-col items-center text-center gap-4 py-4">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.25)" }}>
              <Bot className="w-8 h-8 text-accent" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white mb-2">
                {lang === "ar" ? "التسجيل عبر البوت فقط" : "Registration via Bot Only"}
              </h2>
              <p className="text-zinc-400 text-sm leading-relaxed max-w-xs">
                {lang === "ar"
                  ? "حسابات المستخدمين يتم إنشاؤها فقط بواسطة بوت التليجرام أو لوحة الإدارة."
                  : "User accounts can only be created via the Telegram bot or Admin Panel."}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 mt-4">
            <button onClick={goLogin}
              className="w-full h-[48px] rounded-xl text-white font-semibold text-[15px] transition-all cursor-pointer hover:opacity-90 active:scale-[0.98]"
              style={{ background: "linear-gradient(135deg, #6d28d9 0%, #7c3aed 40%, #a855f7 100%)", boxShadow: "0 4px 20px rgba(139,92,246,0.35)" }}>
              {lang === "ar" ? "تسجيل الدخول" : "Sign In"}
            </button>
          </div>

          <p className="text-center text-zinc-600 text-[11px] mt-6 tracking-[0.15em]">
            𝐒𝐄𝐑𝐕𝐄𝐑 𝐇𝐔𝐁 &copy; 2026
          </p>
        </div>
      </div>
    </div>
  );
}
