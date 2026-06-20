import { useRef, useState, useCallback, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface Props {
  onRefresh: () => Promise<void> | void;
  children: ReactNode;
  className?: string;
}

/** Branded pull-to-refresh with Pixie sparkle spinner.
 *  Wraps a scrollable container and shows a sparkle SVG + accent gradient
 *  line when the user drags down from scroll-top. Triggers refresh after
 *  passing the 60px threshold. Uses overscroll-behavior-y: contain to
 *  suppress the browser's built-in PTR on Android/Chrome. */
export function PullToRefresh({ onRefresh, children, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pulling, setPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const isDragging = useRef(false);

  const THRESHOLD = 60;

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
      }
    },
    [refreshing],
  );

  const handleTouchEnd = useCallback(async () => {
    isDragging.current = false;
    if (pullDistance >= THRESHOLD && !refreshing) {
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
  }, [pullDistance, refreshing, onRefresh]);

  const progress = Math.min(pullDistance / THRESHOLD, 1);
  const showIndicator = pulling || refreshing;

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
              ? Math.min(pullDistance, 80)
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
            opacity: progress,
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
