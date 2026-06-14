import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "./primitives";

/**
 * Right-side glass Drawer — the dominant detail/edit pattern (canon §5).
 * Esc + scrim-click close. Footer is optional (e.g. a SaveBar).
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

  return (
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
          "fixed top-0 right-0 h-full z-[90] flex flex-col dropglass border-l shadow-[-30px_0_80px_rgb(0_0_0/0.5)] transition-transform duration-300 ease-brand",
          wide ? "w-[min(560px,97vw)]" : "w-[min(460px,95vw)]",
          open ? "translate-x-0" : "translate-x-full",
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
    </>
  );
}
