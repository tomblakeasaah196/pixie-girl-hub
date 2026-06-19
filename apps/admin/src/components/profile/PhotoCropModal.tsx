import { createPortal } from "react-dom";
import { useRef, useState, useEffect } from "react";
import { ZoomIn, ZoomOut, X } from "lucide-react";

const PREVIEW = 280;
const EXPORT = 400;

export function PhotoCropModal({
  file,
  onDone,
  onCancel,
}: {
  file: File;
  onDone: (blob: Blob) => void;
  onCancel: () => void;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState("");
  const [zoom, setZoom] = useState(1);
  const [minZoom, setMinZoom] = useState(0.1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const natural = Math.max(PREVIEW / img.width, PREVIEW / img.height);
      setMinZoom(natural);
      setZoom(natural);
      setOffset({ x: 0, y: 0 });
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Non-passive wheel listener — can't use JSX onWheel + preventDefault (passive by default)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => {
        const next = z * (1 - e.deltaY * 0.001);
        return Math.max(minZoom, Math.min(minZoom * 4, next));
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [minZoom]);

  const imgStyle = () => {
    if (!imgRef.current) return {};
    const w = imgRef.current.width * zoom;
    const h = imgRef.current.height * zoom;
    return {
      width: w,
      height: h,
      position: "absolute" as const,
      top: (PREVIEW - h) / 2 + offset.y,
      left: (PREVIEW - w) / 2 + offset.x,
      userSelect: "none" as const,
      pointerEvents: "none" as const,
    };
  };

  const startDrag = (x: number, y: number) => {
    dragging.current = true;
    lastPos.current = { x, y };
  };
  const moveDrag = (x: number, y: number) => {
    if (!dragging.current) return;
    setOffset((o) => ({
      x: o.x + x - lastPos.current.x,
      y: o.y + y - lastPos.current.y,
    }));
    lastPos.current = { x, y };
  };

  const handleConfirm = () => {
    const img = imgRef.current;
    if (!img) return;
    const canvas = document.createElement("canvas");
    canvas.width = EXPORT;
    canvas.height = EXPORT;
    const ctx = canvas.getContext("2d")!;
    ctx.beginPath();
    ctx.arc(EXPORT / 2, EXPORT / 2, EXPORT / 2, 0, Math.PI * 2);
    ctx.clip();
    const scale = EXPORT / PREVIEW;
    const w = img.width * zoom * scale;
    const h = img.height * zoom * scale;
    const x = (EXPORT - w) / 2 + offset.x * scale;
    const y = (EXPORT - h) / 2 + offset.y * scale;
    ctx.drawImage(img, x, y, w, h);
    canvas.toBlob(
      (b) => {
        if (b) onDone(b);
      },
      "image/jpeg",
      0.9,
    );
  };

  const content = (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <button
        aria-label="Close"
        className="absolute inset-0 bg-bg/80 backdrop-blur-xl"
        onClick={onCancel}
      />
      <div className="relative w-full max-w-[360px] dropglass rounded-[22px] p-6 shadow-glass animate-app-in">
        <button
          onClick={onCancel}
          aria-label="Close"
          className="absolute top-4 right-4 grid place-items-center w-8 h-8 rounded-full text-text-faint hover:text-text-primary hover:bg-text-primary/10"
        >
          <X className="w-4 h-4" />
        </button>

        <h2 className="font-display text-[20px] mb-4">Crop photo</h2>

        <div
          ref={containerRef}
          className="mx-auto rounded-full overflow-hidden bg-text-primary/[0.06] border-2 border-accent/30 cursor-grab active:cursor-grabbing"
          style={{ width: PREVIEW, height: PREVIEW, position: "relative" }}
          onMouseDown={(e) => startDrag(e.clientX, e.clientY)}
          onMouseMove={(e) => moveDrag(e.clientX, e.clientY)}
          onMouseUp={() => {
            dragging.current = false;
          }}
          onMouseLeave={() => {
            dragging.current = false;
          }}
          onTouchStart={(e) =>
            startDrag(e.touches[0].clientX, e.touches[0].clientY)
          }
          onTouchMove={(e) => {
            e.preventDefault();
            moveDrag(e.touches[0].clientX, e.touches[0].clientY);
          }}
          onTouchEnd={() => {
            dragging.current = false;
          }}
        >
          {src && <img src={src} alt="" style={imgStyle()} draggable={false} />}
        </div>

        <div className="mt-5 flex items-center gap-3">
          <ZoomOut className="w-4 h-4 text-text-faint shrink-0" />
          <input
            type="range"
            min={minZoom}
            max={minZoom * 4}
            step={minZoom * 0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1 accent-[var(--accent)]"
          />
          <ZoomIn className="w-4 h-4 text-text-faint shrink-0" />
        </div>

        <div className="mt-5 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 h-10 rounded-xl border border-line/60 text-[13px] font-semibold text-text-muted hover:bg-text-primary/[0.05] transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 h-10 rounded-xl bg-accent-deep text-[#F4E9D9] text-[13px] font-semibold hover:bg-accent transition-all"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
