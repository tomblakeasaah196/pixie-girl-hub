import { useEffect, type RefObject } from "react";

/**
 * Trap keyboard focus inside an open overlay (Modal / Drawer / BottomSheet).
 *
 * Accessibility contract (WCAG 2.1.2 "No Keyboard Trap" done right + 2.4.3
 * "Focus Order"): while the overlay is open,
 *   1. focus moves INTO the panel on open (first focusable element, else the
 *      panel itself), so keyboard/screen-reader users start inside the dialog;
 *   2. Tab / Shift+Tab CYCLE within the panel and never escape to the page
 *      behind it (which is inert while `aria-modal` is set);
 *   3. focus is RESTORED to whatever was focused before the overlay opened
 *      (usually the trigger button) when it closes/unmounts.
 *
 * The panels already handle Escape-to-close and set role="dialog" +
 * aria-modal; this hook adds the missing focus management. It is deliberately
 * dependency-free (no focus-trap library) and no-ops while closed.
 *
 * @param ref   Ref to the dialog panel container.
 * @param open  Whether the overlay is currently open.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
) {
  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    if (!node) return;

    // Remember where focus was so we can return it on close.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const FOCUSABLE = [
      "a[href]",
      "button:not([disabled])",
      "textarea:not([disabled])",
      "input:not([disabled]):not([type='hidden'])",
      "select:not([disabled])",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");

    const focusableIn = () =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    // Move focus inside the panel on open. Prefer the first focusable control;
    // fall back to the panel itself (made programmatically focusable) so screen
    // readers announce the dialog even when it has no interactive elements yet.
    const initial = focusableIn()[0];
    if (initial) {
      initial.focus();
    } else {
      node.setAttribute("tabindex", "-1");
      node.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusable = focusableIn();
      if (focusable.length === 0) {
        // Nothing to move to — keep focus on the panel.
        e.preventDefault();
        node.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        // Shift+Tab off the first element wraps to the last.
        if (active === first || !node.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab off the last element wraps to the first.
        if (active === last || !node.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    node.addEventListener("keydown", onKeyDown);
    return () => {
      node.removeEventListener("keydown", onKeyDown);
      // Restore focus to the trigger, but only if it's still in the document
      // and focusable — avoids throwing on an element that unmounted.
      if (
        previouslyFocused &&
        typeof previouslyFocused.focus === "function" &&
        document.contains(previouslyFocused)
      ) {
        previouslyFocused.focus();
      }
    };
  }, [open, ref]);
}
