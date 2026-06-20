import { useRef, useState, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleTouchStart = (e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY;
    setDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!dragging) return;
    const diff = e.touches[0].clientY - startY.current;
    if (diff > 0) setDragY(diff);
  };

  const handleTouchEnd = () => {
    setDragging(false);
    const sheetHeight = sheetRef.current?.offsetHeight ?? 300;
    if (dragY > sheetHeight * 0.35) {
      onClose();
    }
    setDragY(0);
  };

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-[2px] animate-fade-in"
        onClick={onClose}
      />
      <div
        ref={sheetRef}
        className={cn(
          "fixed bottom-0 inset-x-0 z-[81] rounded-t-[24px] glass border-t animate-[sheet-slide-up_250ms_cubic-bezier(.16,1,.3,1)_both]",
          !dragging && "transition-transform duration-200",
        )}
        style={{ transform: dragY > 0 ? `translateY(${dragY}px)` : undefined }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <div className="w-10 h-1 rounded-full bg-text-faint/30 mx-auto mt-3 mb-2" />
        {title && (
          <h3 className="text-[11px] uppercase tracking-[0.2em] font-semibold text-accent-glow text-center mb-3 px-5">
            {title}
          </h3>
        )}
        <div className="px-5 pb-[max(20px,calc(env(safe-area-inset-bottom,0px)+12px))] max-h-[70vh] overflow-y-auto">
          {children}
        </div>
      </div>
    </>,
    document.body,
  );
}
