import { createPortal } from "react-dom";
import { useRef, useState, useEffect } from "react";
import { ZoomIn, ZoomOut, X } from "lucide-react";

// 16:9 to match the cover preview box in CoverImageEditor.
const PREVIEW_W = 480;
const PREVIEW_H = 270;
const EXPORT_W = 1600;
const EXPORT_H = 900;

/** Drag-to-pan, wheel/slider-to-zoom cropper for collection/bundle/shade cover
 *  images — lets the user pull the focal point (hair, not face/fingers) into
 *  frame before it's saved. Mirrors PhotoCropModal's interaction model but
 *  crops to a 16:9 rectangle instead of a circular avatar. */
export function CoverCropModal({
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
      const natural = Math.max(PREVIEW_W / img.width, PREVIEW_H / img.height);
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

  const clampOffset = (o: { x: number; y: number }, z: number) => {
    if (!imgRef.current) return o;
    const w = imgRef.current.width * z;
    const h = imgRef.current.height * z;
    const maxX = Math.max(0, (w - PREVIEW_W) / 2);
    const maxY = Math.max(0, (h - PREVIEW_H) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, o.x)),
      y: Math.max(-maxY, Math.min(maxY, o.y)),
    };
  };

  const imgStyle = () => {
    if (!imgRef.current) return {};
    const w = imgRef.current.width * zoom;
    const h = imgRef.current.height * zoom;
    return {
      width: w,
      height: h,
      position: "absolute" as const,
      top: (PREVIEW_H - h) / 2 + offset.y,
      left: (PREVIEW_W - w) / 2 + offset.x,
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
    setOffset((o) =>
      clampOffset(
        { x: o.x + x - lastPos.current.x, y: o.y + y - lastPos.current.y },
        zoom,
      ),
    );
    lastPos.current = { x, y };
  };

  const handleConfirm = () => {
    const img = imgRef.current;
    if (!img) return;
    const canvas = document.createElement("canvas");
    canvas.width = EXPORT_W;
    canvas.height = EXPORT_H;
    const ctx = canvas.getContext("2d")!;
    const scale = EXPORT_W / PREVIEW_W;
    const w = img.width * zoom * scale;
    const h = img.height * zoom * scale;
    const x = (EXPORT_W - w) / 2 + offset.x * scale;
    const y = (EXPORT_H - h) / 2 + offset.y * scale;
    ctx.drawImage(img, x, y, w, h);
    canvas.toBlob(
      (b) => {
        if (b) onDone(b);
      },
      "image/jpeg",
      0.92,
    );
  };

  const content = (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <button
        aria-label="Close"
        className="absolute inset-0 bg-bg/80 backdrop-blur-xl"
        onClick={onCancel}
      />
      <div className="relative w-full max-w-[540px] dropglass rounded-[22px] p-6 shadow-glass animate-app-in">
        <button
          onClick={onCancel}
          aria-label="Close"
          className="absolute top-4 right-4 grid place-items-center w-8 h-8 rounded-full text-text-faint hover:text-text-primary hover:bg-text-primary/10"
        >
          <X className="w-4 h-4" />
        </button>

        <h2 className="font-display text-[20px] mb-1">Position cover</h2>
        <p className="text-[12px] text-text-faint mb-4">
          Drag to reposition, scroll or use the slider to zoom.
        </p>

        <div
          ref={containerRef}
          className="mx-auto rounded-[12px] overflow-hidden bg-text-primary/[0.06] border-2 border-accent/30 cursor-grab active:cursor-grabbing touch-none"
          style={{ width: PREVIEW_W, height: PREVIEW_H, position: "relative" }}
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
            onChange={(e) => {
              const z = Number(e.target.value);
              setZoom(z);
              setOffset((o) => clampOffset(o, z));
            }}
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
