import { useEffect, useRef, useState } from "react";
import { Clock, MapPin } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Top-bar clock-in with a live timer (canon §3.2). Geofence check would run
 * server-side at punch; here it toggles + counts. Hidden for users not linked
 * to a staff profile in the real app.
 */
export function ClockWidget({ compact = false }: { compact?: boolean }) {
  const [on, setOn] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const start = useRef(0);

  useEffect(() => {
    if (!on) return;
    start.current = Date.now();
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - start.current) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, [on]);

  const hhmmss = [elapsed / 3600, (elapsed % 3600) / 60, elapsed % 60]
    .map((n) => String(Math.floor(n)).padStart(2, "0"))
    .join(":");

  return (
    <button
      onClick={() => {
        setOn((v) => !v);
        setElapsed(0);
      }}
      className={cn(
        "inline-flex items-center gap-2 h-[38px] px-[13px] rounded-[11px] border border-line bg-text-primary/[0.04] font-semibold text-xs text-text-muted transition-all hover:text-text-primary",
        on && "text-success border-success/40 bg-success/10",
      )}
      title={on ? "Clock out" : "Clock in (on-site)"}
    >
      {on ? <MapPin className="w-[15px]" /> : <Clock className="w-[15px]" />}
      {on ? (
        <span className="font-mono tabular-nums">{hhmmss}</span>
      ) : (
        !compact && <span>Clock in</span>
      )}
    </button>
  );
}
