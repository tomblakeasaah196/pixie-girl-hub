import { useLocation } from "react-router-dom";
import { useRef, useEffect, type ReactNode } from "react";

/** Animates a subtle rise-in (180ms) on every route change.
 *  No external motion library — pure CSS animation restarted via reflow trick.
 *
 *  The `page-enter` class is removed once the animation finishes (both on
 *  mount and on every restart). `animation-fill-mode: both` leaves the final
 *  keyframe's `transform: translateY(0)` applied indefinitely otherwise —
 *  and any non-`none` transform creates a CSS containing block for
 *  `position: fixed` descendants, silently trapping every un-portaled fixed
 *  overlay (drawers, sheets, scrims) rendered anywhere on the page instead
 *  of letting it position against the viewport. */
export function PageTransition({ children }: { children: ReactNode }) {
  const location = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  const prevPath = useRef(location.pathname);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const clearOnFinish = () => el.classList.remove("page-enter");
    el.addEventListener("animationend", clearOnFinish);
    return () => el.removeEventListener("animationend", clearOnFinish);
  }, []);

  useEffect(() => {
    if (prevPath.current !== location.pathname) {
      prevPath.current = location.pathname;
      const el = ref.current;
      if (!el) return;
      el.classList.remove("page-enter");
      // Force reflow to restart animation
      void el.offsetHeight;
      el.classList.add("page-enter");
    }
  }, [location.pathname]);

  return (
    <div ref={ref} className="page-enter">
      {children}
    </div>
  );
}
