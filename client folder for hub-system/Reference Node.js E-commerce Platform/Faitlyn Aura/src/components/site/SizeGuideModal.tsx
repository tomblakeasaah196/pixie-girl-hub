import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { HEAD_SIZE_CHART, SIZE_GUIDE_VIDEO_ID } from "@/lib/products";

export function SizeGuideModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="bg"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-ink/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="How to find your head size"
        >
          <motion.div
            initial={{ opacity: 0, y: 32, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-3xl my-12 bg-ink border border-taupe/25 shadow-2xl"
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-taupe text-[0.6rem] tracking-[0.3em] uppercase hover:text-cream"
              aria-label="Close"
            >
              Close ✕
            </button>

            <div className="p-8 md:p-12 space-y-10">
              <header>
                <p className="text-[0.6rem] tracking-[0.5em] uppercase text-rose">The fit guide</p>
                <h2 className="font-display text-4xl md:text-5xl mt-2">Find your head size</h2>
                <p className="mt-3 text-cream/65 text-sm leading-relaxed max-w-prose">
                  A perfect Faitlyn piece begins with a perfect measurement. Wrap a soft tape from your
                  hairline, behind your ear, around the nape, and back — keeping it snug, not tight.
                </p>
              </header>

              {/* YouTube embed */}
              <div className="relative aspect-video w-full border border-taupe/20 bg-black">
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${SIZE_GUIDE_VIDEO_ID}?rel=0&modestbranding=1`}
                  title="How to measure your head size"
                  loading="lazy"
                  allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="absolute inset-0 w-full h-full"
                />
              </div>

              {/* Size chart */}
              <div>
                <h3 className="font-display text-2xl mb-4">Our size key</h3>
                <div className="border border-taupe/20">
                  <div className="grid grid-cols-[80px_1fr_1.4fr] text-[0.6rem] tracking-[0.32em] uppercase text-taupe/80 border-b border-taupe/15">
                    <span className="p-3">Size</span>
                    <span className="p-3 border-l border-taupe/15">Circumference</span>
                    <span className="p-3 border-l border-taupe/15">Best for</span>
                  </div>
                  {HEAD_SIZE_CHART.map((row) => (
                    <div
                      key={row.size}
                      className="grid grid-cols-[80px_1fr_1.4fr] border-b border-taupe/10 last:border-b-0 text-sm"
                    >
                      <span className="p-3 font-display text-xl">{row.size}</span>
                      <span className="p-3 border-l border-taupe/10 text-cream/80">{row.circumference}</span>
                      <span className="p-3 border-l border-taupe/10 text-cream/65">{row.description}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Steps */}
              <ol className="grid sm:grid-cols-3 gap-5 text-sm">
                {[
                  ["01", "Tape ready", "Soft fabric measuring tape, mirror, hair pulled flat."],
                  ["02", "Wrap once", "From front hairline, behind one ear, across nape, behind other ear."],
                  ["03", "Read & match", "Snug, not tight. Match your number to the chart above."],
                ].map(([n, t, d]) => (
                  <li key={n} className="border-l border-taupe/30 pl-4">
                    <span className="text-[0.6rem] tracking-[0.4em] uppercase text-rose">{n}</span>
                    <p className="font-display text-lg mt-1">{t}</p>
                    <p className="text-cream/60 mt-1 leading-relaxed">{d}</p>
                  </li>
                ))}
              </ol>

              <p className="text-[0.6rem] tracking-[0.32em] uppercase text-taupe/70 border-t border-taupe/15 pt-5">
                Between sizes? Your concierge will hand-tailor the cap. Just leave a note at checkout.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
