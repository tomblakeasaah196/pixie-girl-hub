import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Pause, Clock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useMyCurrentSession, useStudioLifecycle } from "./hooks";

/**
 * Page-level "You're working on Job X — 47m elapsed [Pause]" strip.
 *
 * Rendered by ServiceJobsPage above the tabs for own-scope stylists only.
 * The elapsed time ticks locally every second (no request per tick); the
 * underlying session is polled every 30s via useMyCurrentSession so a
 * start/pause done in another tab is picked up. When no clock is running
 * the strip renders nothing — no empty state, no placeholder tile.
 */
export function WorkingNowStrip({ enabled }: { enabled: boolean }) {
  const { data: session } = useMyCurrentSession(enabled);

  if (!enabled || !session) return null;

  return <StripInner session={session} />;
}

function StripInner({
  session,
}: {
  session: NonNullable<
    ReturnType<typeof useMyCurrentSession>["data"]
  >;
}) {
  const life = useStudioLifecycle(session.job_id);
  const elapsedMinutes = useElapsedMinutes(session.started_at);

  return (
    <div
      className="glass shadow-glass rounded-[13px] border-l-[3px] p-3 flex items-center gap-3 flex-wrap"
      style={{ borderLeftColor: "rgb(var(--accent))" }}
      role="status"
      aria-live="polite"
    >
      <span
        className="grid place-items-center w-9 h-9 rounded-[10px] bg-accent/10 text-accent shrink-0"
        aria-hidden
      >
        <Clock className="w-4 h-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs uppercase tracking-wide text-text-muted font-semibold">
          Working on
        </div>
        <div className="text-sm truncate">
          <span className="font-mono">{session.job_number}</span>
          {session.service_type_name ? (
            <>
              {" · "}
              <span>{session.service_type_name}</span>
            </>
          ) : null}
        </div>
      </div>
      <div
        className="font-display tabular-nums text-lg"
        aria-label={`Elapsed: ${elapsedMinutes} minutes`}
      >
        {formatElapsed(elapsedMinutes)}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={<Pause className="w-4 h-4" />}
          disabled={life.pause.isPending}
          onClick={() => life.pause.mutate()}
        >
          Pause
        </Button>
        <Link
          to={`/service-jobs?tab=board&job=${session.job_id}`}
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-primary"
        >
          Open
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}

/**
 * Tick the elapsed-minutes counter locally once a minute. The session's
 * `started_at` is fixed for the lifetime of the running clock, so we don't
 * need to hit the network to advance the display — just re-render.
 */
function useElapsedMinutes(startedAt: string): number {
  const compute = () =>
    Math.max(
      0,
      Math.floor((Date.now() - new Date(startedAt).getTime()) / 60_000),
    );
  const [minutes, setMinutes] = useState(compute);

  useEffect(() => {
    // Immediate recompute — remounts / session changes shouldn't lag a minute.
    setMinutes(compute());
    const id = window.setInterval(() => setMinutes(compute()), 30_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt]);

  return minutes;
}

/** "47m" / "1h 12m" / "3h" — kept terse so the strip stays one line on mobile. */
function formatElapsed(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
