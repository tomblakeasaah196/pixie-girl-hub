import { useEffect, useState } from "react";
import { useUiStore } from "@/stores/ui";
import { useBusinesses } from "@/stores/business";
import { Sparkles } from "lucide-react";

const LOADING_LINES = [
  "Switching workspace…",
  "Loading brand settings…",
  "Syncing your modules…",
  "Refreshing live data…",
  "Almost there…",
];

/**
 * Full-screen branded overlay during a business switch (5-7 s, canon §3.1).
 * Shows the incoming business gradient, animated loading copy, and a progress bar.
 * Mounts/unmounts on useUiStore.switchingToBiz.
 */
export function BusinessSwitchOverlay() {
  const switchingToBiz = useUiStore((s) => s.switchingToBiz);
  const businesses = useBusinesses();
  const [lineIdx, setLineIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  const biz = businesses.find((b) => b.key === switchingToBiz) ?? businesses[0];

  useEffect(() => {
    if (!switchingToBiz) {
      setVisible(false);
      setProgress(0);
      setLineIdx(0);
      return;
    }
    setVisible(true);
    setProgress(0);
    setLineIdx(0);

    // Cycle loading copy every ~1.1 s
    const lineTimer = setInterval(
      () => setLineIdx((i) => Math.min(i + 1, LOADING_LINES.length - 1)),
      1100,
    );
    // Progress bar: fill over ~5.4 s then hold at 95% until dismissed
    const start = performance.now();
    const DURATION = 5400;
    let raf: number;
    const tick = (now: number) => {
      const pct = Math.min(((now - start) / DURATION) * 95, 95);
      setProgress(pct);
      if (pct < 95) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      clearInterval(lineTimer);
      cancelAnimationFrame(raf);
    };
  }, [switchingToBiz]);

  if (!switchingToBiz) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-6"
      style={{
        background: `linear-gradient(160deg, ${biz.grad1}ee, ${biz.grad2}f5 60%, #0a0408)`,
        opacity: visible ? 1 : 0,
        transition: "opacity 0.4s ease",
      }}
    >
      {/* Brand monogram pulse */}
      <div
        className="relative w-[88px] h-[88px] rounded-[28px] grid place-items-center shadow-[0_0_60px_rgb(0_0_0/0.5)]"
        style={{
          background: `linear-gradient(140deg, ${biz.grad1}, ${biz.grad2})`,
        }}
      >
        <span className="font-display font-semibold text-[32px] text-white/90">
          {biz.logoUrl ? (
            <img
              src={biz.logoUrl}
              alt=""
              className="w-full h-full rounded-[28px] object-cover"
            />
          ) : (
            biz.monogram
          )}
        </span>
        {/* Pulsing ring */}
        <span
          className="absolute inset-0 rounded-[28px] animate-pulse"
          style={{
            boxShadow: `0 0 0 2px ${biz.grad1}88, 0 0 0 8px ${biz.grad1}22`,
          }}
        />
      </div>

      {/* Business name */}
      <div className="text-center">
        <h2 className="font-display font-light text-3xl text-white/90 mb-1">
          {biz.name}
        </h2>
        <p
          key={lineIdx}
          className="text-white/55 text-sm animate-app-in"
          style={{ minHeight: "1.4em" }}
        >
          {LOADING_LINES[lineIdx]}
        </p>
      </div>

      {/* Progress bar */}
      <div className="w-[240px] h-[3px] rounded-full overflow-hidden bg-white/10">
        <div
          className="h-full rounded-full transition-all duration-300 ease-out"
          style={{
            width: `${progress}%`,
            background: `linear-gradient(90deg, ${biz.grad1}cc, white 120%)`,
          }}
        />
      </div>

      {/* Sparkle accent */}
      <Sparkles className="w-4 h-4 text-white/25 animate-pulse" />
    </div>
  );
}
