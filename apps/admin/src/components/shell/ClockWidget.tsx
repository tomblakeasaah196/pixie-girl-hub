import { Clock, MapPin, LogOut, Loader2, AlertTriangle, Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { useClockPunch } from "./useClockPunch";

/**
 * Top-bar clock in/out pill (canon §3.2). Captures the device location +
 * reverse-geocoded address at punch and sends it to the server, which compares
 * the point to the office geofences and flags off-site clock-ins. Hidden for
 * accounts not linked to a staff profile.
 *
 * All punch logic lives in `useClockPunch`; this is just the desktop skin. On
 * mobile the same state machine is rendered by `ClockFanItem` in the floating
 * launcher so the tight mobile top bar can stay clean.
 */
export function ClockWidget({ compact = false }: { compact?: boolean }) {
  const { view, hhmmss, isOffsite, geofenceRequired, busy, isFetching, clockIn, clockOut, retry } =
    useClockPunch();

  if (view === "hidden" || view === "loading") return null;

  if (view === "error") {
    return (
      <button
        onClick={retry}
        disabled={isFetching}
        title="Couldn't load your clock status — tap to retry"
        className="inline-flex items-center gap-2 h-[38px] px-[13px] rounded-[11px] border border-warn/40 bg-warn/10 font-semibold text-xs text-warn transition-all"
      >
        {isFetching ? <Loader2 className="w-[15px] animate-spin" /> : <AlertTriangle className="w-[15px]" />}
        {!compact && <span>Retry clock</span>}
      </button>
    );
  }

  if (view === "in") {
    return (
      <button
        onClick={() => !busy && clockOut()}
        disabled={busy}
        title={isOffsite ? "Clocked in (off-site) — clock out" : "Clock out"}
        className={cn(
          "inline-flex items-center gap-2 h-[38px] px-[13px] rounded-[11px] border font-semibold text-xs transition-all",
          isOffsite
            ? "text-warn border-warn/40 bg-warn/10"
            : "text-success border-success/40 bg-success/10",
        )}
      >
        {busy ? (
          <Loader2 className="w-[15px] animate-spin" />
        ) : isOffsite ? (
          <AlertTriangle className="w-[15px]" />
        ) : (
          <LogOut className="w-[15px]" />
        )}
        <span className="font-mono tabular-nums">{hhmmss}</span>
      </button>
    );
  }

  // Already clocked in AND out today — one cycle per day, so lock the control
  // to a "Done" state rather than inviting a second clock-in.
  if (view === "done") {
    return (
      <span
        title="You've clocked in and out today"
        className="inline-flex items-center gap-2 h-[38px] px-[13px] rounded-[11px] border border-success/40 bg-success/10 font-semibold text-xs text-success"
      >
        <Check className="w-[15px]" />
        {!compact && <span>Done for today</span>}
      </span>
    );
  }

  return (
    <button
      onClick={() => !busy && clockIn()}
      disabled={busy}
      title="Clock in"
      className={cn(
        "inline-flex items-center gap-2 h-[38px] px-[13px] rounded-[11px] border border-line bg-text-primary/[0.04] font-semibold text-xs text-text-muted transition-all hover:text-text-primary",
      )}
    >
      {busy ? (
        <Loader2 className="w-[15px] animate-spin" />
      ) : geofenceRequired ? (
        <MapPin className="w-[15px]" />
      ) : (
        <Clock className="w-[15px]" />
      )}
      {!compact && <span>{busy ? "Locating…" : "Clock in"}</span>}
    </button>
  );
}
