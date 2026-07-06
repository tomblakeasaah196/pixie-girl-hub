import { useEffect, useRef, useState } from "react";
import { useBranding, useLoginConfig } from "@/lib/branding";

const MIN_DURATION_MS = 2000;
// Hold here until `ready` flips true — the last stretch to 100% only
// plays once the real work (branding fetch / session bootstrap) is done.
const HOLD_AT_PERCENT = 92;
const TICK_MS = 60;

/**
 * The single branded loading screen for the app — shown while a session is
 * restored (RequireAuth) and reused as the login page's first-paint splash.
 * Logo → app name → subline, then a determinate, left-to-right progress bar
 * with a live percentage. Never dismisses before `minDurationMs` (default
 * 2s) even if the underlying work finishes sooner, and never gets stuck
 * before 100% once it's actually ready.
 */
export function BootSplash({
  ready = true,
  minDurationMs = MIN_DURATION_MS,
  onDone,
}: {
  /** Flips true once the real async work (branding load, session bootstrap)
   *  has resolved. While false, progress holds just short of 100%. */
  ready?: boolean;
  minDurationMs?: number;
  onDone?: () => void;
}) {
  const { data } = useBranding();
  const cfg = useLoginConfig();
  const p = data?.platform;
  const product = p?.product_name ?? "Pixie Hub";
  const subline = cfg.splash?.subline;
  const logo = p?.logo_dark_url ?? p?.logo_light_url ?? null;
  const mark = product.trim().charAt(0).toUpperCase() || "P";

  const [percent, setPercent] = useState(0);
  const startRef = useRef(performance.now());
  const percentRef = useRef(0);
  const doneRef = useRef(false);
  const readyRef = useRef(ready);
  readyRef.current = ready;

  useEffect(() => {
    const id = setInterval(() => {
      const elapsed = performance.now() - startRef.current;
      const timeShare = Math.min(100, (elapsed / minDurationMs) * 100);
      const next = readyRef.current
        ? Math.min(100, Math.max(timeShare, percentRef.current + 4))
        : Math.min(HOLD_AT_PERCENT, timeShare);

      if (next > percentRef.current) {
        percentRef.current = next;
        setPercent(next);
      }

      if (
        readyRef.current &&
        next >= 100 &&
        elapsed >= minDurationMs &&
        !doneRef.current
      ) {
        doneRef.current = true;
        clearInterval(id);
        setTimeout(() => onDone?.(), 220);
      }
    }, TICK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minDurationMs]);

  const words = product.split(" ");
  const tail = words.length > 1 ? words.pop()! : "";
  const head = words.join(" ");

  return (
    <div className="fixed inset-0 z-[9999] grid place-items-center bg-bg">
      <div className="flex flex-col items-center px-6 text-center">
        <div className="w-[104px] h-[104px] rounded-full grid place-items-center glass border border-accent/40 animate-splash-pulse overflow-hidden">
          {logo ? (
            <img
              src={logo}
              alt={product}
              className="w-full h-full object-contain p-4"
            />
          ) : (
            <span className="font-display text-accent-glow text-5xl">
              {mark}
            </span>
          )}
        </div>

        <div className="font-display text-[22px] font-semibold mt-6 tracking-wide">
          {head}
          {tail && <span className="text-accent-glow"> {tail}</span>}
        </div>

        {subline && (
          <div className="micro mt-2 max-w-[280px]">{subline}</div>
        )}

        <div className="mt-8 w-[200px]">
          <div className="h-[3px] rounded-full bg-text-primary/10 overflow-hidden">
            <div
              className="boot-bar-fill h-full rounded-full bg-gradient-to-r from-accent-deep to-accent"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="mt-2 text-[11px] font-mono tabular-nums text-text-faint">
            {Math.round(percent)}%
          </div>
        </div>
      </div>
    </div>
  );
}
