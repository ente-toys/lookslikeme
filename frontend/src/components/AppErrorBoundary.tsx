import { Component, type ErrorInfo, type ReactNode } from "react";

type DebugEntry = {
  time: string;
  event: string;
  details?: Record<string, unknown>;
};

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

function pushDebugEntry(event: string, details?: Record<string, unknown>) {
  const globalState = globalThis as typeof globalThis & {
    __LLU_DEBUG_LOGS__?: DebugEntry[];
  };

  if (!globalState.__LLU_DEBUG_LOGS__) {
    globalState.__LLU_DEBUG_LOGS__ = [];
  }
  globalState.__LLU_DEBUG_LOGS__.push({
    time: new Date().toISOString(),
    event,
    details,
  });
  if (globalState.__LLU_DEBUG_LOGS__.length > 100) {
    globalState.__LLU_DEBUG_LOGS__.shift();
  }
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    pushDebugEntry("Render crash", {
      message: error.message,
      stack: error.stack ?? "",
      componentStack: errorInfo.componentStack,
    });
    console.error("[LLU] Render crash", error, errorInfo);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen px-4 py-10">
        <div className="mx-auto max-w-2xl rounded-[2rem] border border-[rgba(212,109,61,0.28)] bg-[rgba(255,247,240,0.96)] p-6 text-[var(--accent-strong)] shadow-[var(--shadow)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
            Looks Like Me
          </p>
          <h1 className="theme-editorial mt-3 text-[2.2rem] font-semibold text-[var(--text)]">
            The page hit a render error
          </h1>
          <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
            Open the browser console and inspect <code>window.__LLU_DEBUG_LOGS__</code> to
            see the last analyze/compare steps before the crash.
          </p>
          <div className="mt-5 rounded-[1.3rem] bg-white/70 p-4 text-sm">
            {this.state.error.message}
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="theme-primary-button mt-5 rounded-[1rem] px-4 py-3 font-semibold"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
