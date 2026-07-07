/**
 * ErrorBoundary — catches render-time crashes so ONE broken screen never takes
 * down the whole app. React's default behaviour on an unhandled render error
 * is to unmount the entire tree, which is why (before this) a shape drift in
 * "My HR" left users staring at a stack trace with no chrome, no sidebar, and
 * no way out except a hard refresh.
 *
 * Placed just above <Outlet /> in the app shell so the sidebar, top bar, and
 * nav stay usable. Resets automatically when the route pathname changes so
 * navigating away from a broken screen recovers cleanly.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";
import { Card, Button } from "@/components/ui/primitives";

interface Props {
  children: ReactNode;
  /** Changes to this key reset the boundary — pass the route pathname so a
   *  crash on one screen is forgotten as soon as the user navigates elsewhere. */
  resetKey?: string;
  onGoHome?: () => void;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

class ErrorBoundaryInner extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info });
    // Surface to the console so the error still shows up in dev tools and
    // whatever telemetry hook the console is wired to.
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] caught render error:", error, info);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null, info: null });
    }
  }

  reset = () => this.setState({ error: null, info: null });

  render() {
    if (!this.state.error) return this.props.children;

    const msg = this.state.error.message || "Something went wrong.";
    const isDev = import.meta.env.DEV;

    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Card className="p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-danger/15 text-danger">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-xl text-text-primary">
                This screen ran into a problem
              </h2>
              <p className="mt-1 text-sm text-text-muted">
                The rest of the app is still working — use the sidebar to keep
                going, or try again below.
              </p>
              {isDev && (
                <pre className="mt-4 max-h-48 overflow-auto rounded-lg border border-line bg-text-primary/[0.03] p-3 font-mono text-[11px] text-text-muted">
                  {msg}
                  {this.state.info?.componentStack ?? ""}
                </pre>
              )}
              <div className="mt-5 flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  icon={<RotateCcw className="h-4 w-4" />}
                  onClick={this.reset}
                >
                  Try again
                </Button>
                {this.props.onGoHome && (
                  <Button
                    variant="secondary"
                    icon={<Home className="h-4 w-4" />}
                    onClick={this.props.onGoHome}
                  >
                    Go home
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Card>
      </div>
    );
  }
}

/** Route-scoped wrapper — resets on navigation so leaving the broken screen
 *  is the natural recovery path. */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <ErrorBoundaryInner
      resetKey={location.pathname}
      onGoHome={() => navigate("/")}
    >
      {children}
    </ErrorBoundaryInner>
  );
}

export { ErrorBoundaryInner as ErrorBoundary };
