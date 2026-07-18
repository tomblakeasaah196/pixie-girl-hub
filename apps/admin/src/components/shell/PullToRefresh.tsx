import {
  useRef,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

interface Props {
  onRefresh: () => Promise<void> | void;
  children: ReactNode;
  className?: string;
}

/** Branded pull-to-refresh with Pixie sparkle spinner.
 *  Wraps a scrollable container and shows a sparkle SVG + accent gradient
 *  line when the user drags down from scroll-top. A refresh only fires once
 *  the pull crosses the 80px threshold AND is *held* there briefly — so a
 *  quick flick or an over-scroll bounce never triggers it. Releasing before
 *  the hold completes, or pulling back up, cancels. Uses
 *  overscroll-behavior-y: contain to suppress the browser's built-in PTR on
 *  Android/Chrome. */
export function PullToRefresh({ onRefresh, children, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pulling, setPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [armed, setArmed] = useState(false);
  const startY = useRef(0);
  const isDragging = useRef(false);
  const armedRef = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pull distance (px, sqrt-damped) the drag must reach before the hold
  // timer starts, and how long the finger must dwell past it before a
  // release counts as a refresh. Together they mean a flick never fires.
  const THRESHOLD = 80;
  const HOLD_MS = 400;

  const clearHold = useCallback(() => {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  const disarm = useCallback(() => {
    clearHold();
    armedRef.current = false;
    setArmed(false);
  }, [clearHold]);

  // Cancel any pending hold if we unmount mid-pull.
  useEffect(() => clearHold, [clearHold]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const container = containerRef.current;
    if (!container || container.scrollTop > 0) return;
    startY.current = e.touches[0].clientY;
    isDragging.current = true;
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isDragging.current || refreshing) return;
      const container = containerRef.current;
      if (!container || container.scrollTop > 0) {
        isDragging.current = false;
        disarm();
        setPulling(false);
        setPullDistance(0);
        return;
      }
      const diff = e.touches[0].clientY - startY.current;
      if (diff > 0) {
        // Apply resistance -- pull distance is sqrt-scaled
        const distance = Math.min(Math.sqrt(diff) * 4, 120);
        setPullDistance(distance);
        setPulling(true);
        if (distance >= THRESHOLD) {
          // Past the line: start the dwell timer once. It only arms if the
          // finger is still held here when it fires -- a flick releases
          // (touchend clears it) long before HOLD_MS elapses.
          if (holdTimer.current === null && !armedRef.current) {
            holdTimer.current = setTimeout(() => {
              armedRef.current = true;
              setArmed(true);
              navigator.vibrate?.(15);
              holdTimer.current = null;
            }, HOLD_MS);
          }
        } else {
          // Slipped back under the line before arming -- reset the dwell.
          disarm();
        }
      } else {
        // Pulled back up past the start point -- cancel.
        disarm();
        setPulling(false);
        setPullDistance(0);
      }
    },
    [refreshing, disarm],
  );

  const handleTouchEnd = useCallback(async () => {
    isDragging.current = false;
    const shouldRefresh = armedRef.current && !refreshing;
    disarm();
    if (shouldRefresh) {
      setRefreshing(true);
      try {
        navigator.vibrate?.(25);
        await onRefresh();
      } finally {
        setRefreshing(false);
      }
    }
    setPulling(false);
    setPullDistance(0);
  }, [refreshing, onRefresh, disarm]);

  const progress = Math.min(pullDistance / THRESHOLD, 1);
  const showIndicator = pulling || refreshing;
  const label = armed
    ? "Release to refresh"
    : progress >= 1
      ? "Hold to refresh"
      : "Pull to refresh";

  return (
    <div
      ref={containerRef}
      className={cn("ptr-container", className)}
      style={{ overscrollBehaviorY: "contain" }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {/* Pull indicator */}
      <div
        className={cn(
          "flex flex-col items-center justify-center overflow-hidden transition-[height] duration-200",
          showIndicator ? "opacity-100" : "opacity-0",
        )}
        style={{
          height: refreshing
            ? 56
            : pullDistance > 10
              ? Math.min(pullDistance, 88)
              : 0,
        }}
      >
        {/* Sparkle spinner */}
        <svg
          viewBox="0 0 64 64"
          className={cn(
            "w-7 h-7 text-accent-glow",
            refreshing && "animate-spin",
          )}
          style={{
            transform: `scale(${0.5 + progress * 0.5}) rotate(${pullDistance * 3}deg)`,
            opacity: armed ? 1 : progress,
            transition: refreshing ? "none" : "transform 50ms",
          }}
        >
          <path
            fill="currentColor"
            d="M32 12c1.8 8.4 5.6 12.2 14 14-8.4 1.8-12.2 5.6-14 14-1.8-8.4-5.6-12.2-14-14 8.4-1.8 12.2-5.6 14-14z"
          />
          <circle cx="48" cy="20" r="2.6" fill="currentColor" opacity="0.6" />
          <circle cx="18" cy="46" r="1.8" fill="currentColor" opacity="0.6" />
        </svg>
        {/* Status label -- teaches hold-to-refresh during the pull. */}
        {!refreshing && pulling && progress > 0.15 && (
          <div
            className={cn(
              "mt-1.5 text-[10.5px] font-medium tracking-wide",
              armed ? "text-accent-glow" : "text-text-faint",
            )}
            style={{ opacity: progress }}
          >
            {label}
          </div>
        )}
        {/* Thin gradient line */}
        {refreshing && (
          <div className="w-20 h-[2px] mt-2 rounded-full bg-gradient-to-r from-accent to-accent-deep overflow-hidden">
            <div className="h-full w-1/2 bg-accent-glow rounded-full animate-[ptr-shimmer_1s_ease-in-out_infinite]" />
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
