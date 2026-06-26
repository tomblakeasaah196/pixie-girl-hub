import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useMotionPrefs } from "@/hooks/use-motion-prefs";

type Props = {
  open: boolean;
  images: string[];
  index: number;
  alt: string;
  onClose: () => void;
  onIndexChange: (i: number) => void;
};

const MIN = 1;
const MAX = 4;

/**
 * Fullscreen product lightbox.
 * - Pinch zoom (two-finger touch) and Ctrl+wheel / wheel zoom
 * - Pan while zoomed
 * - Optional 3D tilt rotation (toggle) for the active media
 * - Reduced-motion / low-end devices: still works, just without spring + tilt
 */
export function ProductLightbox({ open, images, index, alt, onClose, onIndexChange }: Props) {
  const { motionOk, reduce } = useMotionPrefs();
  const [zoom, setZoom] = useState(1);
  const [rotate3d, setRotate3d] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const tiltX = useMotionValue(0);
  const tiltY = useMotionValue(0);
  const rx = useSpring(useTransform(tiltY, [-0.5, 0.5], [12, -12]), { stiffness: 120, damping: 14 });
  const ry = useSpring(useTransform(tiltX, [-0.5, 0.5], [-16, 16]), { stiffness: 120, damping: 14 });

  // Reset on image change / close
  useEffect(() => {
    setZoom(1);
    x.set(0);
    y.set(0);
  }, [index, open, x, y]);

  // Keyboard
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onIndexChange((index + 1) % images.length);
      if (e.key === "ArrowLeft") onIndexChange((index - 1 + images.length) % images.length);
      if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(MAX, z + 0.4));
      if (e.key === "-") setZoom((z) => Math.max(MIN, z - 0.4));
      if (e.key === "0") setZoom(1);
    };
    window.addEventListener("keydown", onKey);
    // Lock scroll
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, index, images.length, onClose, onIndexChange]);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.003;
    setZoom((z) => Math.min(MAX, Math.max(MIN, z + delta)));
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = { dist: Math.hypot(dx, dy), zoom };
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const next = pinchRef.current.zoom * (dist / pinchRef.current.dist);
      setZoom(Math.min(MAX, Math.max(MIN, next)));
    }
  };
  const onTouchEnd = () => { pinchRef.current = null; };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!rotate3d || !motionOk) return;
    const r = stageRef.current?.getBoundingClientRect();
    if (!r) return;
    tiltX.set((e.clientX - r.left) / r.width - 0.5);
    tiltY.set((e.clientY - r.top) / r.height - 0.5);
  };
  const resetTilt = () => { tiltX.set(0); tiltY.set(0); };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={`${alt} — fullscreen view`}
          className="fixed inset-0 z-[120] bg-ink/95 backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0.15 : 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Top bar */}
          <div className="absolute top-0 inset-x-0 z-10 flex items-center justify-between px-6 md:px-10 py-5">
            <span className="text-[0.65rem] tracking-[0.4em] uppercase text-taupe">
              {index + 1} / {images.length} · {Math.round(zoom * 100)}%
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setRotate3d((v) => !v)}
                className={`hidden md:block text-[0.6rem] tracking-[0.35em] uppercase border px-3 py-2 transition-colors ${rotate3d ? "border-taupe bg-taupe/15 text-cream" : "border-taupe/40 text-taupe hover:text-cream"}`}
              >
                3D tilt {rotate3d ? "on" : "off"}
              </button>
              <button
                onClick={() => setZoom((z) => Math.max(MIN, z - 0.4))}
                aria-label="Zoom out"
                className="w-10 h-10 border border-taupe/40 text-taupe hover:bg-taupe hover:text-ink transition-colors"
              >−</button>
              <button
                onClick={() => setZoom((z) => Math.min(MAX, z + 0.4))}
                aria-label="Zoom in"
                className="w-10 h-10 border border-taupe/40 text-taupe hover:bg-taupe hover:text-ink transition-colors"
              >+</button>
              <button
                onClick={onClose}
                aria-label="Close"
                className="w-10 h-10 border border-taupe/40 text-taupe hover:bg-cream hover:text-ink transition-colors"
              >✕</button>
            </div>
          </div>

          {/* Stage */}
          <div
            ref={stageRef}
            className="absolute inset-0 flex items-center justify-center overflow-hidden touch-none"
            onWheel={onWheel}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onMouseMove={onMouseMove}
            onMouseLeave={resetTilt}
            style={{ perspective: 1600 }}
          >
            <motion.div
              drag={zoom > 1}
              dragConstraints={{ left: -800, right: 800, top: -800, bottom: 800 }}
              dragElastic={0.15}
              style={{
                x,
                y,
                rotateX: rotate3d && motionOk ? rx : 0,
                rotateY: rotate3d && motionOk ? ry : 0,
                transformStyle: "preserve-3d",
                cursor: zoom > 1 ? "grab" : "zoom-in",
              }}
              className="relative will-change-transform"
            >
              <AnimatePresence mode="wait">
                <motion.img
                  key={images[index]}
                  src={images[index]}
                  alt={alt}
                  draggable={false}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: zoom }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: reduce ? 0.15 : 0.55, ease: [0.22, 1, 0.36, 1] }}
                  onClick={() => setZoom((z) => (z > 1 ? 1 : 2))}
                  className="max-h-[88vh] max-w-[92vw] object-contain select-none shadow-[0_40px_80px_-20px_rgba(0,0,0,0.6)]"
                />
              </AnimatePresence>
            </motion.div>
          </div>

          {/* Nav arrows */}
          {images.length > 1 && (
            <>
              <button
                onClick={() => onIndexChange((index - 1 + images.length) % images.length)}
                aria-label="Previous image"
                className="absolute left-4 md:left-8 top-1/2 -translate-y-1/2 w-12 h-12 border border-taupe/40 text-taupe hover:bg-taupe hover:text-ink transition-colors"
              >←</button>
              <button
                onClick={() => onIndexChange((index + 1) % images.length)}
                aria-label="Next image"
                className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 w-12 h-12 border border-taupe/40 text-taupe hover:bg-taupe hover:text-ink transition-colors"
              >→</button>
            </>
          )}

          {/* Bottom hint */}
          <div className="absolute bottom-5 inset-x-0 text-center text-[0.6rem] tracking-[0.4em] uppercase text-taupe/60 pointer-events-none">
            Scroll · pinch · double-click to zoom
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
