import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useFocusTrap } from "@/hooks/useFocusTrap";
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
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Keep keyboard focus inside the dialog while it's open; restore it on close.
  useFocusTrap(panelRef, open);

  return createPortal(
    // data-modal-root / data-modal-open let ancestors with outside-click
    // dismissal (ChatDock and friends) recognise that a click landed in a
    // portalled dialog rather than "outside" — the dialog lives under
    // document.body, so a DOM containment check alone can't tell.
    <div
      data-modal-root
      data-modal-open={open ? "true" : "false"}
      className={cn(
        // Phone: bottom sheet (native-app dialogs). md+: centered glass modal.
        // z-[110]: the modal portals to <body>, and the immersive full-screen
        // pages (Messaging + Chief-of-Staff) cover the app shell at z-[100] on
        // phones. At the old z-[92] a modal opened FROM inside messaging (Share
        // catalogue / Capture an order) rendered BEHIND that page and only
        // appeared once you left the thread. Clear the immersive layer — same
        // band CustomerPanelDrawer (z-105/110) and the Lightbox (z-120) use.
        "fixed inset-0 z-[110] flex items-end justify-center md:items-center md:p-4 bg-black/50 backdrop-blur-[3px] transition-[opacity,visibility] duration-300",
        open
          ? "opacity-100 visible"
          : "opacity-0 invisible pointer-events-none",
      )}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{ "--modal-w": `${SIZE_PX[size]}px` } as React.CSSProperties}
        className={cn(
          // Height-capped flex column: header/footer pinned, body scrolls.
          "w-full md:w-[min(94vw,var(--modal-w))] max-h-[92dvh] md:max-h-[calc(100dvh-2rem)] flex flex-col dropglass overflow-hidden transition-transform duration-300 ease-brand",
          "rounded-t-[22px] rounded-b-none md:rounded-[18px]",
          open
            ? "translate-y-0 scale-100"
            : "translate-y-full md:translate-y-0 md:scale-95",
        )}
      >
        <div className="md:hidden grid place-items-center pt-2.5 -mb-1 shrink-0">
          <span className="h-1 w-9 rounded-full bg-text-primary/20" aria-hidden />
        </div>
        {title && (
          <div className="flex items-center gap-3 p-5 max-md:py-4 border-b hairline shrink-0">
            <h2 className="font-display text-lg font-medium flex-1 min-w-0 truncate">
              {title}
            </h2>
            <IconButton onClick={onClose} aria-label="Close">
              <X className="w-[18px] h-[18px]" />
            </IconButton>
          </div>
        )}
        <div
          className={cn(
            "p-5 overflow-y-auto",
            !footer && "max-md:pb-[max(env(safe-area-inset-bottom,0px),20px)]",
          )}
        >
          {children}
        </div>
        {footer && (
          <div className="p-[14px_20px] pb-[max(env(safe-area-inset-bottom,0px),14px)] md:pb-[14px] border-t hairline flex flex-wrap items-center gap-2 justify-end shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
