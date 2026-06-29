import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut, X, Crop, RotateCcw } from "lucide-react";
import type { BundleComponent, CollageCrop } from "@/lib/catalogue";

/**
 * "Reframe photos" — pick what part of each product photo shows in the collage
 * BEFORE generating the cover. The server auto-crops toward the most salient
 * region (the model's face); this lets the owner drag/zoom each tile to favour
 * the hair instead. Each frame is shaped to the EXACT box the photo lands in,
 * mirroring the server's layout() geometry, so what you frame is what you get.
 *
 * Output is a focal point + zoom per component (keyed by bundle_product_id):
 *   { x, y } = focal CENTRE as a 0..1 fraction of the source, zoom ≥ 1.
 */

// ── Canvas geometry — mirrors src/services/collage.service.js ──
const W = 1080;
const H = 1350;
const PAD = 40;
const GUT = 18;

/** Tile rectangles for a given piece count (3–6). Same order/shape the server
 *  composites, so frame i corresponds to component i. */
function collageLayout(count: number): { w: number; h: number }[] {
  const cw = W - PAD * 2;
  const ch = H - PAD * 2;
  const half = (cw - GUT) / 2;
  const rects: { w: number; h: number }[] = [];
  if (count === 3) {
    const heroH = Math.round(ch * 0.58);
    const botH = ch - heroH - GUT;
    rects.push({ w: cw, h: heroH });
    rects.push({ w: half, h: botH });
    rects.push({ w: half, h: botH });
  } else if (count === 4) {
    const cellH = (ch - GUT) / 2;
    for (let i = 0; i < 4; i++) rects.push({ w: half, h: cellH });
  } else if (count === 5) {
    const heroH = Math.round(ch * 0.4);
    const cellH = (ch - heroH - GUT - GUT) / 2;
    rects.push({ w: cw, h: heroH });
    for (let i = 0; i < 4; i++) rects.push({ w: half, h: cellH });
  } else {
    const cellH = (ch - GUT * 2) / 3;
    for (let i = 0; i < 6; i++) rects.push({ w: half, h: cellH });
  }
  return rects;
}

const FRAME_H = 150; // uniform frame height; width follows the box aspect

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

/** Cover rect (zoom = 1): the largest aspect-correct rect that fits the source. */
function coverRect(nw: number, nh: number, ar: number) {
  let cw = nw;
  let ch = nw / ar;
  if (ch > nh) {
    ch = nh;
    cw = nh * ar;
  }
  return { cw, ch };
}

function CropCell({
  component,
  ar,
  value,
  onChange,
}: {
  component: BundleComponent;
  ar: number;
  value?: CollageCrop;
  onChange: (crop: CollageCrop) => void;
}) {
  const FRAME_W = Math.round(FRAME_H * ar);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(value?.zoom ?? 1);
  const [focal, setFocal] = useState({ x: value?.x ?? 0.5, y: value?.y ?? 0.5 });
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  const label = component.styled_name || component.product_name || "Product";

  // Keep the focal point in-bounds for the current zoom and emit upward.
  const commit = (next: { x: number; y: number }, z: number) => {
    if (!nat) return;
    const { cw, ch } = coverRect(nat.w, nat.h, ar);
    const halfX = cw / z / 2 / nat.w;
    const halfY = ch / z / 2 / nat.h;
    const x = clamp(next.x, halfX, 1 - halfX);
    const y = clamp(next.y, halfY, 1 - halfY);
    setFocal({ x, y });
    onChange({ x: Number(x.toFixed(4)), y: Number(y.toFixed(4)), zoom: Number(z.toFixed(3)) });
  };

  // Re-clamp when zoom changes (a tighter frame can free the focal point).
  useEffect(() => {
    if (nat) commit(focal, zoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, nat]);

  const view = () => {
    if (!nat) return null;
    const { cw } = coverRect(nat.w, nat.h, ar);
    const scale = FRAME_W / (cw / zoom);
    return {
      width: nat.w * scale,
      height: nat.h * scale,
      left: FRAME_W / 2 - focal.x * nat.w * scale,
      top: FRAME_H / 2 - focal.y * nat.h * scale,
      scale,
    };
  };

  const move = (px: number, py: number) => {
    if (!dragging.current || !nat) return;
    const v = view();
    if (!v) return;
    const dx = (px - last.current.x) / (nat.w * v.scale);
    const dy = (py - last.current.y) / (nat.h * v.scale);
    last.current = { x: px, y: py };
    commit({ x: focal.x - dx, y: focal.y - dy }, zoom);
  };

  const v = view();

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="relative overflow-hidden rounded-[12px] bg-text-primary/[0.06] border border-accent/30 cursor-grab active:cursor-grabbing"
        style={{ width: FRAME_W, height: FRAME_H }}
        onMouseDown={(e) => {
          dragging.current = true;
          last.current = { x: e.clientX, y: e.clientY };
        }}
        onMouseMove={(e) => move(e.clientX, e.clientY)}
        onMouseUp={() => (dragging.current = false)}
        onMouseLeave={() => (dragging.current = false)}
        onTouchStart={(e) => {
          dragging.current = true;
          last.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }}
        onTouchMove={(e) => {
          e.preventDefault();
          move(e.touches[0].clientX, e.touches[0].clientY);
        }}
        onTouchEnd={() => (dragging.current = false)}
      >
        {component.image_url && (
          <img
            src={component.image_url}
            alt={label}
            draggable={false}
            onLoad={(e) =>
              setNat({
                w: e.currentTarget.naturalWidth,
                h: e.currentTarget.naturalHeight,
              })
            }
            style={
              v
                ? {
                    position: "absolute",
                    width: v.width,
                    height: v.height,
                    left: v.left,
                    top: v.top,
                    userSelect: "none",
                    pointerEvents: "none",
                    maxWidth: "none",
                  }
                : { opacity: 0 }
            }
          />
        )}
      </div>

      <div
        className="flex items-center gap-1.5 w-full"
        style={{ maxWidth: Math.max(FRAME_W, 120) }}
      >
        <ZoomOut className="w-3.5 h-3.5 text-text-faint shrink-0" />
        <input
          type="range"
          min={1}
          max={4}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="flex-1 accent-[var(--accent)] min-w-0"
        />
        <ZoomIn className="w-3.5 h-3.5 text-text-faint shrink-0" />
      </div>

      <div
        className="text-[11px] text-text-faint text-center truncate w-full"
        style={{ maxWidth: Math.max(FRAME_W, 120) }}
        title={label}
      >
        {label}
      </div>
    </div>
  );
}

export function BundleCollageCropModal({
  components,
  value,
  onApply,
  onCancel,
}: {
  components: BundleComponent[];
  value: Record<string, CollageCrop>;
  onApply: (crops: Record<string, CollageCrop>) => void;
  onCancel: () => void;
}) {
  // The server takes the first 6 components (in order) as tiles. Only the ones
  // with a photo are reframeable; the rest fall back to a monogram tile.
  const tiled = components.slice(0, 6);
  const count = tiled.length;
  const rects = collageLayout(count);
  const photographed = tiled
    .map((c, i) => ({ c, ar: rects[i].w / rects[i].h }))
    .filter((t) => !!t.c.image_url);

  const [draft, setDraft] = useState<Record<string, CollageCrop>>({ ...value });

  const content = (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <button
        aria-label="Close"
        className="absolute inset-0 bg-bg/80 backdrop-blur-xl"
        onClick={onCancel}
      />
      <div className="relative w-full max-w-[680px] max-h-[90vh] overflow-y-auto dropglass rounded-[22px] p-6 shadow-glass animate-app-in">
        <button
          onClick={onCancel}
          aria-label="Close"
          className="absolute top-4 right-4 grid place-items-center w-8 h-8 rounded-full text-text-faint hover:text-text-primary hover:bg-text-primary/10"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 mb-1">
          <Crop className="w-4 h-4 text-accent-glow" />
          <h2 className="font-display text-[20px]">Reframe photos</h2>
        </div>
        <p className="text-[12.5px] text-text-faint mb-5 pr-8">
          Drag each photo to choose what shows, and zoom to taste. Each frame is
          the exact box it lands in — push down to feature the hair instead of
          the face.
        </p>

        {photographed.length === 0 ? (
          <p className="text-[13px] text-text-faint py-8 text-center">
            No product photos to reframe yet.
          </p>
        ) : (
          <div className="flex flex-wrap gap-5 justify-center">
            {photographed.map(({ c, ar }) => (
              <CropCell
                key={c.bundle_product_id}
                component={c}
                ar={ar}
                value={draft[c.bundle_product_id]}
                onChange={(crop) =>
                  setDraft((d) => ({ ...d, [c.bundle_product_id]: crop }))
                }
              />
            ))}
          </div>
        )}

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={() => setDraft({})}
            className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl border border-line/60 text-[12.5px] font-semibold text-text-muted hover:bg-text-primary/[0.05] transition-all"
            title="Clear manual framing — fall back to auto-crop"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset to auto
          </button>
          <div className="flex-1" />
          <button
            onClick={onCancel}
            className="h-10 px-4 rounded-xl border border-line/60 text-[13px] font-semibold text-text-muted hover:bg-text-primary/[0.05] transition-all"
          >
            Cancel
          </button>
          <button
            onClick={() => onApply(draft)}
            className="h-10 px-5 rounded-xl bg-accent-deep text-[#F4E9D9] text-[13px] font-semibold hover:bg-accent transition-all"
          >
            Save framing
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
