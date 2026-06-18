import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "./primitives";

/** Centered glass Modal — confirmations & forms (canon §5).
 *
 *  `size` only widens the panel on DESKTOP: the width is `min(94vw, size)`, so
 *  on phones it is always 94vw (unchanged regardless of size) and the cap only
 *  bites once the viewport is wide enough. The panel is height-capped and its
 *  body scrolls internally, so a tall form can never push its header (title +
 *  close) off-screen — the long-standing "form head is hidden" bug. */
export type ModalSize = "sm" | "md" | "lg" | "xl";

/** Desktop width caps (px). Mobile is always 94vw via min(). */
const SIZE_PX: Record<ModalSize, number> = {
  sm: 460, // confirmations / short forms (the historical default)
  md: 640,
  lg: 860,
  xl: 1100, // full workspace forms — feels close to a page without being one
};

export function Modal({
  open,
  onClose,
  title,
  footer,
  size = "sm",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-[92] grid place-items-center p-4 bg-black/50 backdrop-blur-[3px] transition-[opacity,visibility] duration-300",
        open ? "opacity-100 visible" : "opacity-0 invisible pointer-events-none",
      )}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{ width: `min(94vw, ${SIZE_PX[size]}px)` }}
        className={cn(
          // Height-capped flex column: header/footer pinned, body scrolls.
          "max-h-[calc(100dvh-2rem)] flex flex-col dropglass rounded-[18px] overflow-hidden transition-transform duration-300 ease-brand",
          open ? "scale-100" : "scale-95",
        )}
      >
        {title && (
          <div className="flex items-center gap-3 p-5 border-b hairline shrink-0">
            <h2 className="font-display text-lg font-medium flex-1 min-w-0 truncate">{title}</h2>
            <IconButton onClick={onClose} aria-label="Close">
              <X className="w-[18px] h-[18px]" />
            </IconButton>
          </div>
        )}
        <div className="p-5 overflow-y-auto">{children}</div>
        {footer && (
          <div className="p-[14px_20px] border-t hairline flex gap-2 justify-end shrink-0">{footer}</div>
        )}
      </div>
    </div>
  );
}
