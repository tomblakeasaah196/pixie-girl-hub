import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

/**
 * A dropdown panel that renders into a body-level portal, anchored under a
 * trigger element. Escaping to <body> is the whole point: every Card in this
 * app is `.glass` (backdrop-filter), and a backdrop-filter creates a new
 * stacking context — so an `absolute z-50` panel inside one card is still
 * painted *beneath* the next sibling card, and the panel "hides behind the
 * container". Portalling + `position: fixed` sidesteps that (and any
 * `overflow:hidden` ancestor) completely.
 *
 * It positions itself with getBoundingClientRect, matches the trigger's width,
 * flips above the trigger when there isn't room below, follows scroll/resize,
 * and owns its own outside-click / Escape close (counting BOTH the trigger and
 * the panel as "inside", so clicking a row never closes it before the click
 * lands).
 */
export function AnchoredDropdown({
  anchorRef,
  open,
  onClose,
  children,
  maxHeight = 300,
  className,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  maxHeight?: number;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
    maxHeight: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    if (!anchor) return;

    const reposition = () => {
      const r = anchor.getBoundingClientRect();
      const gap = 4;
      const spaceBelow = window.innerHeight - r.bottom - gap;
      const spaceAbove = r.top - gap;
      // Flip up only when below is genuinely cramped and above is roomier.
      const openUp = spaceBelow < 180 && spaceAbove > spaceBelow;
      const avail = Math.max(120, (openUp ? spaceAbove : spaceBelow) - 8);
      setPos({
        left: r.left,
        width: r.width,
        maxHeight: Math.min(maxHeight, avail),
        ...(openUp
          ? { bottom: window.innerHeight - r.top + gap }
          : { top: r.bottom + gap }),
      });
    };

    reposition();
    // Capture-phase scroll catches scrolling in any ancestor container, not
    // just the window, so the panel stays glued to its trigger.
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, anchorRef, maxHeight]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      ref={panelRef}
      className={cn(
        "select-dropdown-list fixed z-[120] rounded-[11px] overflow-hidden py-1 overflow-y-auto",
        className,
      )}
      style={{
        left: pos.left,
        width: pos.width,
        top: pos.top,
        bottom: pos.bottom,
        maxHeight: pos.maxHeight,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
