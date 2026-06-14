import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "./primitives";

/** Centered glass Modal — confirmations & small forms (canon §5). */
export function Modal({
  open,
  onClose,
  title,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  footer?: ReactNode;
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
        "fixed inset-0 z-[92] grid place-items-center p-4 bg-black/50 backdrop-blur-[3px] transition-opacity duration-300",
        open ? "opacity-100" : "opacity-0 pointer-events-none",
      )}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "w-[min(460px,94vw)] dropglass rounded-[18px] overflow-hidden transition-transform duration-300 ease-brand",
          open ? "scale-100" : "scale-95",
        )}
      >
        {title && (
          <div className="flex items-center gap-3 p-5 border-b hairline">
            <h2 className="font-display text-lg font-medium flex-1">{title}</h2>
            <IconButton onClick={onClose} aria-label="Close">
              <X className="w-[18px] h-[18px]" />
            </IconButton>
          </div>
        )}
        <div className="p-5">{children}</div>
        {footer && <div className="p-[14px_20px] border-t hairline flex gap-2 justify-end">{footer}</div>}
      </div>
    </div>
  );
}
