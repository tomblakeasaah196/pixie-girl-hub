import { createPortal } from "react-dom";
import { useRef, useState, useEffect, useCallback } from "react";
import { ZoomIn, ZoomOut, X } from "lucide-react";

// Preview/export dimensions per supported cover aspect ratio. Export is a
// fixed multiple of preview so exported quality stays consistent across
// ratios.
const DIMENSIONS = {
  "16:9": { previewW: 480, previewH: 270, exportW: 1600, exportH: 900 },
  "4:5": { previewW: 360, previewH: 450, exportW: 1200, exportH: 1500 },
} as const;

/** Drag-to-pan, wheel/slider-to-zoom cropper for collection/bundle/shade cover
 *  images — lets the user pull the focal point (hair, not face/fingers) into
 *  frame before it's saved. Mirrors PhotoCropModal's interaction model but
 *  crops to a rectangle instead of a circular avatar. */
export function CoverCropModal({
  file,
  aspect = "16:9",
  onDone,
  onCancel,
}: {
  file: File;
  aspect?: keyof typeof DIMENSIONS;
  onDone: (blob: Blob) => void;
  onCancel: () => void;
}) {
  const { previewW, previewH, exportW, exportH } = DIMENSIONS[aspect];
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
      const natural = Math.max(previewW / img.width, previewH / img.height);
      setMinZoom(natural);
      setZoom(natural);
      setOffset({ x: 0, y: 0 });
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file, previewW, previewH]);

  const clampOffset = useCallback(
    (o: { x: number; y: number }, z: number) => {
      if (!imgRef.current) return o;
      const w = imgRef.current.width * z;
      const h = imgRef.current.height * z;
      const maxX = Math.max(0, (w - previewW) / 2);
      const maxY = Math.max(0, (h - previewH) / 2);
      return {
        x: Math.max(-maxX, Math.min(maxX, o.x)),
        y: Math.max(-maxY, Math.min(maxY, o.y)),
      };
    },
    [previewW, previewH],
  );

  // Non-passive wheel listener — can't use JSX onWheel + preventDefault (passive by default)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => {
        const next = Math.max(
          minZoom,
          Math.min(minZoom * 4, z * (1 - e.deltaY * 0.001)),
        );
        // Re-clamp the offset for the new zoom immediately — otherwise
        // zooming back out with the wheel leaves the pan offset from the
        // more-zoomed-in state in place, and the image no longer covers
        // the box (gaps of empty background appear at the edges).
        setOffset((o) => clampOffset(o, next));
        return next;
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [minZoom, clampOffset]);

  const imgStyle = () => {
    if (!imgRef.current) return {};
    const w = imgRef.current.width * zoom;
    const h = imgRef.current.height * zoom;
    return {
      width: w,
      height: h,
      // Tailwind's preflight sets `img { max-width: 100% }`, which silently
      // caps the rendered width at the container's width once zoom pushes
      // it past that — height keeps scaling but width doesn't, so the image
      // stops covering the box and shows background on one side. Override
      // it so the explicit width above always wins.
      maxWidth: "none" as const,
      position: "absolute" as const,
      top: (previewH - h) / 2 + offset.y,
      left: (previewW - w) / 2 + offset.x,
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
    // Compute the delta against lastPos synchronously, before mutating it —
    // setOffset's updater callback runs later, during React's render phase,
    // so if lastPos were read inside that callback it would already reflect
    // this same call's (x, y) by the time the callback runs (the mutation
    // below always executes first), making every delta compute as zero.
    // That's why drag-to-reposition never actually moved the image.
    const dx = x - lastPos.current.x;
    const dy = y - lastPos.current.y;
    lastPos.current = { x, y };
    setOffset((o) => clampOffset({ x: o.x + dx, y: o.y + dy }, zoom));
  };
  const endDrag = () => {
    dragging.current = false;
  };

  // Mouse drag is tracked on `window`, not just the small preview box — the
  // box is only 270-450px tall, so a normal-speed drag routinely carries the
  // cursor outside it, and element-scoped mousemove/mouseup listeners simply
  // stop firing at that point (making "drag to reposition" feel broken).
  const onMouseDownDrag = (e: React.MouseEvent) => {
    startDrag(e.clientX, e.clientY);
    const onMove = (ev: MouseEvent) => moveDrag(ev.clientX, ev.clientY);
    const onUp = () => {
      endDrag();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleConfirm = () => {
    const img = imgRef.current;
    if (!img) return;
    const canvas = document.createElement("canvas");
    canvas.width = exportW;
    canvas.height = exportH;
    const ctx = canvas.getContext("2d")!;
    const scale = exportW / previewW;
    const w = img.width * zoom * scale;
    const h = img.height * zoom * scale;
    const x = (exportW - w) / 2 + offset.x * scale;
    const y = (exportH - h) / 2 + offset.y * scale;
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
          style={{ width: previewW, height: previewH, position: "relative" }}
          onMouseDown={onMouseDownDrag}
          onTouchStart={(e) =>
            startDrag(e.touches[0].clientX, e.touches[0].clientY)
          }
          onTouchMove={(e) => {
            e.preventDefault();
            moveDrag(e.touches[0].clientX, e.touches[0].clientY);
          }}
          onTouchEnd={endDrag}
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
