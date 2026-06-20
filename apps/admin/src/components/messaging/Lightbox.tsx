import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Download } from "lucide-react";

/** Full-screen image viewer. Click backdrop or Esc to close. */
export function Lightbox({
  url,
  name,
  onClose,
}: {
  url: string;
  name?: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-black/85 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div className="absolute top-4 right-4 flex gap-2">
        <a
          href={url}
          download={name ?? true}
          onClick={(e) => e.stopPropagation()}
          className="grid place-items-center w-9 h-9 rounded-full bg-white/10 text-white hover:bg-white/20"
          title="Download"
        >
          <Download className="w-4 h-4" />
        </a>
        <button
          onClick={onClose}
          className="grid place-items-center w-9 h-9 rounded-full bg-white/10 text-white hover:bg-white/20"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <img
        src={url}
        alt={name ?? "image"}
        className="max-h-[90vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body,
  );
}
