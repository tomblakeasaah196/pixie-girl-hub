import { useRef, useState } from "react";
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion, AnimatePresence } from "motion/react";
import { ProductLightbox } from "./ProductLightbox";

export function LuxuryGallery({ images, alt }: { images: string[]; alt: string }) {
  const [active, setActive] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);

  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-0.5, 0.5], [10, -10]), { stiffness: 120, damping: 14 });
  const ry = useSpring(useTransform(mx, [-0.5, 0.5], [-14, 14]), { stiffness: 120, damping: 14 });
  const glareX = useTransform(mx, [-0.5, 0.5], ["10%", "90%"]);
  const glareY = useTransform(my, [-0.5, 0.5], ["10%", "90%"]);

  const onMove = (e: React.MouseEvent) => {
    if (reduce) return;
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    mx.set((e.clientX - r.left) / r.width - 0.5);
    my.set((e.clientY - r.top) / r.height - 0.5);
  };
  const reset = () => { mx.set(0); my.set(0); };

  return (
    <div className="space-y-3">
      <ProductLightbox
        open={lightbox}
        images={images}
        index={active}
        alt={alt}
        onClose={() => setLightbox(false)}
        onIndexChange={setActive}
      />
      <motion.div
        ref={ref}
        onMouseMove={onMove}
        onMouseLeave={reset}
        onClick={() => setLightbox(true)}
        style={{ perspective: 1400 }}
        className="relative aspect-[4/5] bg-card overflow-hidden cursor-zoom-in select-none"
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
      >
        <motion.div
          style={reduce ? undefined : { rotateX: rx, rotateY: ry, transformStyle: "preserve-3d" }}
          className="absolute inset-0"
        >
          <AnimatePresence mode="wait">
            <motion.img
              key={active}
              src={images[active]}
              alt={alt}
              initial={{ opacity: 0, scale: 1.08, filter: "blur(12px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, scale: 1.04, filter: "blur(8px)" }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-0 w-full h-full object-cover"
              draggable={false}
            />
          </AnimatePresence>

          {/* Specular gold glare */}
          {!reduce && (
            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-0 mix-blend-soft-light opacity-70"
              style={{
                background: `radial-gradient(220px circle at ${glareX as unknown as string} ${glareY as unknown as string}, rgba(212,181,158,0.55), transparent 60%)`,
              }}
            />
          )}

          {/* Vignette */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(14,12,10,0.55)_100%)]" />

          {/* Hairline frame */}
          <div className="pointer-events-none absolute inset-3 border border-taupe/20" />
        </motion.div>

        {/* Slow ken-burns drift for stillness */}
        {!reduce && (
          <motion.div
            aria-hidden
            initial={{ scale: 1 }}
            animate={{ scale: [1, 1.03, 1] }}
            transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
            className="absolute inset-0 pointer-events-none"
          />
        )}
      </motion.div>

      {/* Thumbnails */}
      <motion.div
        className="grid grid-cols-4 gap-3"
        initial="hidden"
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.08, delayChildren: 0.2 } } }}
      >
        {images.map((src, i) => (
          <motion.button
            key={i}
            onClick={() => setActive(i)}
            variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }}
            whileHover={{ y: -3 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className={`relative aspect-square overflow-hidden bg-card border ${i === active ? "border-taupe" : "border-transparent hover:border-taupe/40"}`}
          >
            <img src={src} alt="" className="w-full h-full object-cover" />
            {i === active && (
              <motion.span
                layoutId="thumb-active"
                className="absolute inset-0 ring-1 ring-taupe"
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              />
            )}
          </motion.button>
        ))}
      </motion.div>
    </div>
  );
}
