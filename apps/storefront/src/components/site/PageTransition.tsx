import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * Route-change transition (ported from the reference). Keyed on pathname so each
 * client-side navigation fades/blurs in with a gold curtain wipe — no full-page
 * reload. Requires nav via <Link> (not <a href>).
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const reduce = useReducedMotion();

  if (reduce) return <>{children}</>;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        exit={{ opacity: 0, y: -16, filter: "blur(6px)" }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="relative"
      >
        <motion.div
          initial={{ scaleY: 1 }}
          animate={{ scaleY: 0 }}
          exit={{ scaleY: 0 }}
          transition={{ duration: 0.9, ease: [0.85, 0, 0.15, 1] }}
          style={{ transformOrigin: "top" }}
          className="pointer-events-none fixed inset-0 z-[80] bg-gradient-to-b from-ink via-burgundy/40 to-ink"
        />
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
