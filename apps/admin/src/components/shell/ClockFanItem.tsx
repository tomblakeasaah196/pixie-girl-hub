import type { ReactNode } from "react";
import { Clock, MapPin, LogOut, Loader2, AlertTriangle, Check } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ClockPunch } from "./useClockPunch";

/**
 * Clock in/out as a floating-launcher fan item (canon §3.2 control, relocated
 * to the §3.4 launcher on mobile so the tight mobile top bar stays clean). It
 * shares every bit of punch behaviour with the desktop top-bar pill through
 * `useClockPunch` — geo capture, mandatory-location refusal, off-site / late /
 * unrecognised-device toasts, the live timer — and only differs in skin: the
 * launcher's round glass mini, with a state label that stays visible (the fan
 * is tap-not-hover on mobile, so the running HH:MM:SS has to read at a glance).
 *
 * Presentational: the launcher owns the single `useClockPunch` instance (it
 * also drives the FAB's attendance pip) and hands the result down here.
 */
export function ClockFanItem({
  clock,
  onPunch,
}: {
  clock: ClockPunch;
  onPunch?: () => void;
}) {
  const { view, hhmmss, isOffsite, geofenceRequired, busy } = clock;

  // Not a staff account, a day off, or still loading — occupy no slot in the fan.
  if (view === "hidden" || view === "loading") return null;

  const act = () => {
    if (busy) return;
    if (view === "error") clock.retry();
    else if (view === "in") clock.clockOut();
    else if (view === "idle") clock.clockIn();
    else return; // done — locked for the day
    onPunch?.();
  };

  // Per-state skin: the icon inside the round mini, its tint, and the always-on
  // label chip to the left (which carries the live timer while clocked in).
  let icon: ReactNode;
  let tint: string;
  let label: ReactNode;
  let aria: string;

  const spinner = <Loader2 className="w-5 h-5 animate-spin" />;
  const chip = (main: string, sub?: string) => (
    <>
      <span
        className={cn(
          sub ? "font-mono tabular-nums text-[13px] font-bold leading-none" : "text-[11.5px] font-semibold",
        )}
      >
        {main}
      </span>
      {sub && (
        <span className="mt-0.5 block text-[10px] font-medium text-text-faint leading-none">
          {sub}
        </span>
      )}
    </>
  );

  if (view === "error") {
    icon = busy ? spinner : <AlertTriangle className="w-5 h-5" />;
    tint = "text-warn ring-1 ring-warn/40";
    label = chip("Retry clock");
    aria = "Couldn't load your clock status — tap to retry";
  } else if (view === "done") {
    icon = <Check className="w-5 h-5" />;
    tint = "text-success ring-1 ring-success/40";
    label = chip("Done for today");
    aria = "You've clocked in and out today";
  } else if (view === "in") {
    icon = busy ? spinner : isOffsite ? <AlertTriangle className="w-5 h-5" /> : <LogOut className="w-5 h-5" />;
    tint = isOffsite
      ? "text-warn ring-1 ring-warn/50"
      : "text-success ring-1 ring-success/50 shadow-[0_0_0_4px_rgb(var(--success)/0.12)]";
    label = chip(hhmmss, busy ? "Clocking out…" : isOffsite ? "Off-site · clock out" : "Tap to clock out");
    aria = isOffsite ? "Clocked in (off-site) — tap to clock out" : "Clocked in — tap to clock out";
  } else {
    // idle — on the clock today, not yet punched in
    icon = busy ? spinner : geofenceRequired ? <MapPin className="w-5 h-5" /> : <Clock className="w-5 h-5" />;
    tint = "text-text-primary";
    label = chip(busy ? "Locating…" : "Clock in");
    aria = "Clock in";
  }

  const done = view === "done";

  return (
    <button
      onClick={act}
      disabled={busy || done}
      aria-label={aria}
      title={aria}
      className={cn(
        "relative grid place-items-center w-11 h-11 rounded-full dropglass shadow-[0_8px_22px_rgb(0_0_0/0.4)] transition-all",
        !done && "hover:scale-110 hover:border-accent/40",
        tint,
      )}
    >
      {/* Always-on state label (mobile fan is tap-not-hover). Sits to the left,
          overflowing toward the screen interior so it stays clear of the edge. */}
      <span className="absolute right-[54px] top-1/2 -translate-y-1/2 whitespace-nowrap dropglass px-2.5 py-1.5 rounded-[10px] text-text-primary text-right">
        {label}
      </span>
      {icon}
    </button>
  );
}
