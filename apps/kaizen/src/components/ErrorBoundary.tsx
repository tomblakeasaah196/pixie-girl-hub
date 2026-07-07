import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "@/lib/errorReporter";

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
  message?: string;
}

/**
 * App-wide error boundary. Catches render errors, reports them to Kaizen
 * (source "kaizen"), and shows a non-alarming fallback with a reload.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Best-effort report; never let reporting throw.
    try {
      reportError(
        { message: error.message, stack: `${error.stack}\n${info.componentStack}` },
        "kaizen",
      );
    } catch {
      /* ignore */
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="grid min-h-screen place-items-center bg-ink-950 p-6 text-center">
        <div className="max-w-md">
          <h1 className="font-display text-xl font-semibold text-fog-100">
            Something broke in the console
          </h1>
          <p className="mt-2 text-sm text-fog-300">
            The error has been reported to Kaizen. Try reloading.
          </p>
          <button
            className="btn-primary mt-4"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
