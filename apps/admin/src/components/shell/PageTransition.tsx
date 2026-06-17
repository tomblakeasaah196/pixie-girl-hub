import { useLocation } from "react-router-dom";
import { useRef, useEffect, type ReactNode } from "react";

/** Animates a subtle rise-in (180ms) on every route change.
 *  No external motion library — pure CSS animation restarted via reflow trick. */
export function PageTransition({ children }: { children: ReactNode }) {
  const location = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  const prevPath = useRef(location.pathname);

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
