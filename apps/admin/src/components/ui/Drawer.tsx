import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
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
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return createPortal(
    <>
      <div
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-[80] bg-black/50 backdrop-blur-[3px] transition-opacity duration-300",
          open ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      />
      <aside
        role="dialog"
        aria-modal="true"
        className={cn(
          // `visibility` rides the same transition as the transform so the
          // panel stays visible while it slides out, then flips to hidden —
          // otherwise the big left-spreading shadow bleeds back on-screen and
          // the drawer appears to "hang" at the right edge when closed.
          "fixed top-0 right-0 h-full z-[90] flex flex-col dropglass border-l shadow-[-30px_0_80px_rgb(0_0_0/0.5)] transition-[transform,visibility] duration-300 ease-brand",
          // Mobile widths are frozen (min() caps); the lg:/xl: overrides only
          // widen the panel on the desktop tier (≥1024px) so detail/edit
          // content isn't crushed into a phone-width column on a big monitor.
          wide
            ? "w-[min(560px,97vw)] lg:w-[min(880px,82vw)] xl:w-[960px]"
            : "w-[min(460px,95vw)] lg:w-[600px] xl:w-[680px]",
          open ? "translate-x-0 visible" : "translate-x-full invisible pointer-events-none",
        )}
      >
        <div className="flex items-center gap-3 p-5 border-b hairline">
          {leading}
          <div className="min-w-0">
            <h2 className="font-display text-xl font-medium leading-tight truncate">{title}</h2>
            {subtitle && <div className="micro mt-0.5">{subtitle}</div>}
          </div>
          <IconButton className="ml-auto" onClick={onClose} aria-label="Close">
            <X className="w-[18px] h-[18px]" />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto p-[22px]">{children}</div>
        {footer && <div className="p-[15px_20px] border-t hairline flex gap-2 justify-end">{footer}</div>}
      </aside>
    </>,
    document.body,
  );
}
