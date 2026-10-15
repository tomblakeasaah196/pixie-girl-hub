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
  mobileMinWidth,
  className,
  id,
  role,
  "aria-label": ariaLabel,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  maxHeight?: number;
  /** Expand a narrow anchored panel on phones, while keeping it in the viewport. */
  mobileMinWidth?: number;
  className?: string;
  /** Element id, so a trigger can point at this panel via aria-controls. */
  id?: string;
  /** ARIA role for the panel, e.g. "listbox" or "menu". */
  role?: string;
  "aria-label"?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    left: number;
    width: number;
    top: number;
    openUp: boolean;
    maxHeight: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    if (!anchor) return;

    const reposition = () => {
      const r = anchor.getBoundingClientRect();
      const gap = 4;
      // Use the visual viewport when a phone keyboard or pinch zoom changes
      // the actually-visible area; window.innerHeight still describes the
      // layout viewport in several mobile browsers.
      const visual = window.visualViewport;
      const viewportLeft = visual?.offsetLeft ?? 0;
      const viewportTop = visual?.offsetTop ?? 0;
      const viewportWidth = visual?.width ?? window.innerWidth;
      const viewportHeight = visual?.height ?? window.innerHeight;
      const viewportRight = viewportLeft + viewportWidth;
      const viewportBottom = viewportTop + viewportHeight;
      const spaceBelow = viewportBottom - r.bottom - gap;
      const spaceAbove = r.top - viewportTop - gap;
      // Flip up only when below is genuinely cramped and above is roomier.
      const openUp = spaceBelow < 180 && spaceAbove > spaceBelow;
      const avail = Math.max(96, (openUp ? spaceAbove : spaceBelow) - 8);
      const mobileInset = 10;
      const expandOnMobile = mobileMinWidth != null && viewportWidth <= 640;
      const width = Math.min(
        expandOnMobile ? Math.max(r.width, mobileMinWidth) : r.width,
        Math.max(0, viewportWidth - mobileInset * 2),
      );
      const left = Math.min(
        Math.max(viewportLeft + mobileInset, expandOnMobile ? r.left + (r.width - width) / 2 : r.left),
        Math.max(viewportLeft + mobileInset, viewportRight - width - mobileInset),
      );
      setPos({
        left,
        width,
        maxHeight: Math.min(maxHeight, avail),
        openUp,
        // Anchor above by translating the panel's own measured height, not by
        // positioning from the layout viewport bottom. This stays visible
        // when the on-screen keyboard shrinks the visual viewport.
        top: openUp ? r.top - gap : Math.max(viewportTop, r.bottom + gap),
      });
    };

    reposition();
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(reposition);
    resizeObserver?.observe(anchor);
    // Capture-phase scroll catches scrolling in any ancestor container, not
    // just the window, so the panel stays glued to its trigger.
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("scroll", reposition);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
    };
  }, [open, anchorRef, maxHeight, mobileMinWidth]);

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
      id={id}
      role={role}
      aria-label={ariaLabel}
      className={cn(
        "select-dropdown-list fixed z-[120] rounded-[11px] overflow-hidden py-1 overflow-y-auto",
        className,
      )}
      style={{
        left: pos.left,
        width: pos.width,
        top: pos.top,
        transform: pos.openUp ? "translateY(-100%)" : undefined,
        maxHeight: pos.maxHeight,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
