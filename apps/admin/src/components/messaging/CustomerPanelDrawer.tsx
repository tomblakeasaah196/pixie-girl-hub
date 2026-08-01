import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { CustomerSidebar } from "./CustomerSidebar";
import type { Channel } from "@/lib/smartcomm-types";

/**
 * Below `xl` there's no room for the persistent Customer-360 column
 * (SmartCommPage hides it entirely under 1280px), but the info in it —
 * phone, email, order/invoice status — is exactly what a rep needs
 * mid-chat. This slides the same `CustomerSidebar` in as a portaled
 * overlay from the right edge instead of losing it below the desktop
 * tier. Triggered by the floating edge tab in SmartCommPage.
 *
 * Deliberately lighter than the shared `Drawer` primitive: `CustomerSidebar`
 * already renders its own header (identity + value tiles) and manages its
 * own internal scroll split, so this only adds the portal/scrim/slide
 * mechanics plus a close button — a second title bar would just duplicate
 * the name that's already the first thing in the panel.
 */
export function CustomerPanelDrawer({
  open,
  onClose,
  channel,
}: {
  open: boolean;
  onClose: () => void;
  channel: Channel | null | undefined;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!channel) return null;

  return createPortal(
    <>
      <div
        onClick={onClose}
        aria-hidden
        className={cn(
          // Above the immersive full-screen chat container's z-[100]
          // (SmartCommPage, mobile) as well as the standard shell layers —
          // a modal-ish overlay must always win over whatever it's covering.
          "fixed inset-0 z-[105] bg-black/50 backdrop-blur-[3px] transition-opacity duration-300",
          open ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Customer details"
        className={cn(
          "fixed top-0 right-0 h-full z-[110] w-[min(400px,88vw)] pt-safe",
          "dropglass border-l shadow-[-30px_0_80px_rgb(0_0_0/0.5)]",
          "transition-[transform,visibility] duration-300 ease-brand",
          open
            ? "translate-x-0 visible"
            : "translate-x-full invisible pointer-events-none",
        )}
      >
        <button
          onClick={onClose}
          aria-label="Close customer details"
          className="absolute top-3 right-3 z-10 grid place-items-center w-8 h-8 rounded-full bg-panel/85 border hairline text-text-muted hover:text-text-primary backdrop-blur"
        >
          <X className="w-4 h-4" />
        </button>
        <CustomerSidebar channel={channel} />
      </aside>
    </>,
    document.body,
  );
}
