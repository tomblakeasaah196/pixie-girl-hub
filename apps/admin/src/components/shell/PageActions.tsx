import { useEffect, useState, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useIsDesktop } from "@/hooks/useMediaQuery";

/**
 * Desktop page-action slot (canon §3.2). The top bar exposes a slot; pages
 * teleport their primary actions into it on desktop so the bar's wide centre
 * is used instead of wasted. On tablet/phone the actions render inline exactly
 * where the page places <PageActions>, so the mobile layout is unchanged.
 *
 * Usage in a page:
 *   <PageActions><Button variant="primary">New contact</Button></PageActions>
 */

// Module-level registry of the live slot node + subscribers. A singleton is
// fine: there is exactly one top bar mounted at a time.
let slotEl: HTMLElement | null = null;
const listeners = new Set<(el: HTMLElement | null) => void>();

/** Called by the TopBar to publish (or retract) its action slot node. */
export function registerPageActionsSlot(el: HTMLElement | null) {
  slotEl = el;
  listeners.forEach((l) => l(el));
}

function useSlotNode(): HTMLElement | null {
  const [el, setEl] = useState<HTMLElement | null>(slotEl);
  useEffect(() => {
    const l = (next: HTMLElement | null) => setEl(next);
    listeners.add(l);
    setEl(slotEl); // sync in case it registered before this mounted
    return () => {
      listeners.delete(l);
    };
  }, []);
  return el;
}

export function PageActions({ children }: { children: ReactNode }) {
  const isDesktop = useIsDesktop();
  const el = useSlotNode();

  // Desktop: portal into the top-bar slot once it exists (it mounts before
  // pages, so this is ready on first paint). Until then render nothing to
  // avoid a flash in the page body.
  if (isDesktop) return el ? createPortal(<>{children}</>, el) : null;

  // Tablet / phone: render where the page placed us — unchanged behaviour.
  return <>{children}</>;
}

/** Ref callback the TopBar attaches to its slot container. */
export function usePageActionsSlotRef() {
  return useCallback((node: HTMLElement | null) => {
    registerPageActionsSlot(node);
  }, []);
}
