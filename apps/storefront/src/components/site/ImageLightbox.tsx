import { useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { motion } from "motion/react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

export interface LightboxImage {
  url: string;
  alt?: string;
}

/**
 * Full-screen image viewer shared by the product gallery and customer-review
 * photos: swipe / arrow-key navigation, double-tap (or double-click) to zoom,
 * Escape to close, and body-scroll lock while open. Render it inside an
 * <AnimatePresence> and unmount to close.
 */
export function ImageLightbox({
  images,
  startAt = 0,
  onClose,
}: {
  images: LightboxImage[];
  startAt?: number;
  onClose: () => void;
}) {
  const multi = images.length > 1;
  const [ref, embla] = useEmblaCarousel({
    loop: multi,
    startIndex: Math.max(0, Math.min(startAt, images.length - 1)),
  });
  const [index, setIndex] = useState(Math.max(0, startAt));
  const [zoomed, setZoomed] = useState(false);

  const onSelect = useCallback(() => {
    if (embla) setIndex(embla.selectedScrollSnap());
  }, [embla]);

  useEffect(() => {
    if (!embla) return;
    embla.on("select", onSelect);
    return () => {
      embla.off("select", onSelect);
    };
  }, [embla, onSelect]);

  useEffect(() => setZoomed(false), [index]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") embla?.scrollPrev();
      if (e.key === "ArrowRight") embla?.scrollNext();
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [embla, onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[110] bg-background/95 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 z-10 grid h-10 w-10 place-items-center rounded-full border border-border bg-background/80"
      >
        <X className="h-5 w-5" />
      </button>
      {multi ? (
        <span className="absolute left-4 top-4 z-10 rounded-full border border-border bg-background/80 px-3 py-1 text-caption">
          {index + 1} / {images.length}
        </span>
      ) : null}

      <div className="flex h-full items-center">
        {multi ? (
          <button
            type="button"
            onClick={() => embla?.scrollPrev()}
            aria-label="Previous image"
            className="absolute left-2 z-10 grid h-10 w-10 place-items-center rounded-full border border-border bg-background/80 md:left-6"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        ) : null}

        <div ref={ref} className="h-full w-full overflow-hidden">
          <div className="flex h-full">
            {images.map((img, i) => (
              <div
                key={i}
                className="relative flex h-full flex-[0_0_100%] items-center justify-center px-10"
              >
                <img
                  src={img.url}
                  alt={img.alt || ""}
                  onDoubleClick={() => setZoomed((z) => !z)}
                  className={`max-h-[85vh] max-w-full select-none object-contain transition-transform duration-300 ${
                    zoomed && i === index ? "scale-[1.8] cursor-zoom-out" : "cursor-zoom-in"
                  }`}
                />
              </div>
            ))}
          </div>
        </div>

        {multi ? (
          <button
            type="button"
            onClick={() => embla?.scrollNext()}
            aria-label="Next image"
            className="absolute right-2 z-10 grid h-10 w-10 place-items-center rounded-full border border-border bg-background/80 md:right-6"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        ) : null}
      </div>
    </motion.div>
  );
}
