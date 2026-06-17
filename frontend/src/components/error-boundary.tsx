import { Component, type ReactNode } from "react";
import { TerminalSquare, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-screen w-full" style={{ background: "#0b0616" }}>
          <div className="flex flex-col items-center gap-4 max-w-md text-center px-6">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #6d28d9, #a855f7)", boxShadow: "0 0 30px rgba(139,92,246,0.3)" }}>
              <TerminalSquare className="w-7 h-7 text-white" />
            </div>
            <h2 className="text-sm font-bold text-white font-mono tracking-wider" style={{ color: "#ef4444" }}>SYSTEM ERROR</h2>
            <p className="text-xs font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>
              {this.state.error?.message || "An unexpected error occurred"}
            </p>
            <button onClick={() => { this.setState({ hasError: false, error: null }); window.location.hash = "/"; window.location.reload(); }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono transition-all cursor-pointer"
              style={{ background: "rgba(139,92,246,0.15)", color: "#a855f7", border: "1px solid rgba(139,92,246,0.25)" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(139,92,246,0.25)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(139,92,246,0.15)"; }}>
              <RefreshCw className="w-3.5 h-3.5" /> reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
