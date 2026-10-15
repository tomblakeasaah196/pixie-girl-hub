import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { IconButton } from "./primitives";

/**
 * Right-side glass Drawer — the dominant detail/edit pattern (canon §5).
 * Esc + scrim-click close. Footer is optional (e.g. a SaveBar).
 *
 * Portaled to document.body (like Modal). Page content can pick up a CSS
 * containing block from a transform/filter/backdrop-filter ancestor
 * (e.g. PageTransition's enter animation, or a `.glass` panel) — any of
 * which would confine an un-portaled `position: fixed` Drawer to that
 * ancestor's box instead of the viewport.
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  leading,
  footer,
  wide,
  /** Renders above an open Modal (z-92) — for editors opened from inside a
   *  config Modal, e.g. Comms Studio's automation editor inside the
   *  Messaging Settings modal. Leave unset for a page-level Drawer. */
  elevated,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  elevated?: boolean;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Keep keyboard focus inside the drawer while it's open; restore it on close.
  useFocusTrap(panelRef, open);

  return createPortal(
    <>
      <div
        data-modal-root
        data-modal-open={open ? "true" : "false"}
        onClick={onClose}
        className={cn(
          "fixed inset-0 bg-black/50 backdrop-blur-[3px] transition-opacity duration-300",
          elevated ? "z-[94]" : "z-[80]",
          open ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        data-modal-root
        data-modal-open={open ? "true" : "false"}
        className={cn(
          // `visibility` rides the same transition as the transform so the
          // panel stays visible while it slides out, then flips to hidden —
          // otherwise the big left-spreading shadow bleeds back on-screen and
          // the drawer appears to "hang" at the right edge when closed.
          "fixed top-0 right-0 h-[100dvh] max-h-[100dvh] min-w-0 flex flex-col dropglass border-l shadow-[-30px_0_80px_rgb(0_0_0/0.5)] transition-[transform,visibility] duration-300 ease-brand pt-safe",
          elevated ? "z-[96]" : "z-[90]",
          // Mobile widths are frozen (min() caps); the lg:/xl: overrides only
          // widen the panel on the desktop tier (≥1024px) so detail/edit
          // content isn't crushed into a phone-width column on a big monitor.
          wide
            ? "w-[min(560px,97vw)] lg:w-[min(880px,82vw)] xl:w-[960px]"
            : "w-[min(460px,95vw)] lg:w-[600px] xl:w-[680px]",
          open
            ? "translate-x-0 visible"
            : "translate-x-full invisible pointer-events-none",
        )}
      >
        <div className="flex items-start gap-3 p-4 md:p-5 border-b hairline min-w-0 shrink-0">
          {leading}
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl font-medium leading-tight whitespace-normal break-words">
              {title}
            </h2>
            {subtitle && <div className="micro mt-0.5 whitespace-normal break-words">{subtitle}</div>}
          </div>
          <IconButton className="ml-auto" onClick={onClose} aria-label="Close">
            <X className="w-[18px] h-[18px]" />
          </IconButton>
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto overscroll-contain p-4 md:p-[22px]">{children}</div>
        {footer && (
          <div className="shrink-0 p-3 md:p-[15px_20px] pb-[max(env(safe-area-inset-bottom,0px),12px)] md:pb-[15px] border-t hairline flex flex-wrap gap-2 justify-end">
            {footer}
          </div>
        )}
      </aside>
    </>,
    document.body,
  );
}
