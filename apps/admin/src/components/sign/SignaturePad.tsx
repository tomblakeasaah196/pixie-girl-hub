import { useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";

/**
 * A finger/mouse/stylus signature pad. Draws dark ink on a white "paper"
 * surface (so the captured signature looks the same wherever it's rendered —
 * on the page, on the signed PDF, in either theme) and emits a base64 PNG
 * data URL via onChange (null while empty).
 */
export function SignaturePad({
  onChange,
  disabled,
}: {
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const inked = useRef(false);
  const [empty, setEmpty] = useState(true);

  // Size the backing store at device resolution for crisp strokes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1A1816";
  }, []);

  function pointFrom(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    e.preventDefault();
    drawing.current = true;
    last.current = pointFrom(e);
    canvasRef.current?.setPointerCapture(e.pointerId);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || disabled) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !last.current) return;
    const p = pointFrom(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!inked.current) {
      inked.current = true;
      setEmpty(false);
    }
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    const canvas = canvasRef.current;
    if (canvas) onChange(inked.current ? canvas.toDataURL("image/png") : null);
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    inked.current = false;
    setEmpty(true);
    onChange(null);
  }

  return (
    <div>
      <div className="relative rounded-xl overflow-hidden border hairline bg-white">
        <canvas
          ref={canvasRef}
          className="w-full h-[176px] block cursor-crosshair touch-none"
          style={{ touchAction: "none" }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          onPointerCancel={end}
        />
        {empty && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="text-[13px] text-neutral-400 select-none">
              Draw your signature here
            </span>
          </div>
        )}
        {/* Signature baseline, like a paper form */}
        <div className="pointer-events-none absolute left-5 right-5 bottom-9 border-b border-dashed border-neutral-300" />
      </div>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={clear}
          disabled={empty || disabled}
          className="inline-flex items-center gap-1.5 text-[12px] text-text-muted hover:text-text-primary disabled:opacity-40 transition-colors"
        >
          <Eraser className="w-3.5 h-3.5" />
          Clear
        </button>
      </div>
    </div>
  );
}
