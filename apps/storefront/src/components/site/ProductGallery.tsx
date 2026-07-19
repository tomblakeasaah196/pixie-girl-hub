import { useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { AnimatePresence, motion } from "motion/react";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Maximize2,
  Play,
  X,
} from "lucide-react";
import { YouTubeFacade } from "@/components/site/VideoEmbed";
import type { ProductDetail } from "@/lib/storefront";

type GalleryImage = { url: string; alt_text?: string | null };
type GalleryVideo = ProductDetail["videos"][number];
type Media =
  | { kind: "image"; url: string; alt: string }
  | { kind: "video"; video: GalleryVideo };

/**
 * Product media gallery: photos + merchandised video clips in one rail.
 * Photos open a full-screen lightbox (swipe/arrow nav, double-tap zoom);
 * videos play inline in the hero slot instead — they already have their own
 * fullscreen controls, so the lightbox only ever browses images.
 */
export function ProductGallery({
  images,
  videos,
  productName,
}: {
  images: GalleryImage[];
  videos: GalleryVideo[];
  productName: string;
}) {
  const media: Media[] = [
    ...images.map((g) => ({
      kind: "image" as const,
      url: g.url,
      alt: g.alt_text || productName,
    })),
    ...videos.map((v) => ({ kind: "video" as const, video: v })),
  ];
  const [active, setActive] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const current = media[Math.min(active, media.length - 1)];

  const imageMedia = media.filter(
    (m): m is Extract<Media, { kind: "image" }> => m.kind === "image",
  );
  const activeImagePos =
    current?.kind === "image"
      ? media.slice(0, active + 1).filter((m) => m.kind === "image").length - 1
      : 0;

  if (media.length === 0) {
    return <div className="aspect-[3/4] rounded-md bg-secondary" />;
  }

  return (
    <div>
      <div className="group relative aspect-[3/4] overflow-hidden rounded-md bg-secondary">
        {current.kind === "image" ? (
          <>
            <img
              src={current.url}
              alt={current.alt}
              className="h-full w-full object-cover"
            />
            <button
              type="button"
              onClick={() => setLightboxOpen(true)}
              aria-label="View full size"
              className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-background/70 text-foreground opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </>
        ) : (
          <InlineVideo video={current.video} title={productName} />
        )}
      </div>

      {media.length > 1 ? (
        <div className="mt-3 grid grid-cols-5 gap-2">
          {media.slice(0, 10).map((m, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActive(i)}
              aria-label={m.kind === "image" ? "Show image" : "Show video"}
              className={`relative aspect-square overflow-hidden rounded bg-secondary p-0 ring-1 transition ${
                i === active ? "ring-2 ring-primary" : "ring-border hover:ring-primary/60"
              }`}
            >
              {m.kind === "image" ? (
                <img src={m.url} alt="" className="h-full w-full object-cover" />
              ) : (
                <VideoThumb video={m.video} alt={m.video.title || productName} />
              )}
            </button>
          ))}
        </div>
      ) : null}

      <AnimatePresence>
        {lightboxOpen ? (
          <Lightbox
            images={imageMedia.map((m) => ({ url: m.url, alt: m.alt }))}
            startAt={Math.max(0, activeImagePos)}
            title={productName}
            onClose={() => setLightboxOpen(false)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function VideoThumb({ video, alt }: { video: GalleryVideo; alt: string }) {
  const poster =
    video.thumbnail_url ||
    (video.source === "youtube"
      ? `https://i.ytimg.com/vi/${video.external_ref}/hqdefault.jpg`
      : undefined);
  return (
    <div className="relative h-full w-full">
      {poster ? (
        <img src={poster} alt={alt} className="h-full w-full object-cover" loading="lazy" />
      ) : null}
      <span className="absolute inset-0 grid place-items-center bg-black/25">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground">
          <Play className="h-3 w-3 translate-x-px" fill="currentColor" />
        </span>
      </span>
    </div>
  );
}

function InlineVideo({ video, title }: { video: GalleryVideo; title: string }) {
  const label = video.title || title;
  if (video.source === "youtube") {
    return <YouTubeFacade videoId={video.external_ref} title={label} />;
  }
  if (video.source === "direct_upload") {
    return (
      <video
        src={video.embed_url}
        poster={video.thumbnail_url || undefined}
        controls
        className="h-full w-full object-cover"
      />
    );
  }
  // Instagram Reel / TikTok have no first-party inline embed here — open the
  // live post, same treatment as the "As seen on" social-proof badge.
  return (
    <a
      href={video.embed_url}
      target="_blank"
      rel="noreferrer"
      className="group relative block h-full w-full"
    >
      {video.thumbnail_url ? (
        <img src={video.thumbnail_url} alt={label} className="h-full w-full object-cover" />
      ) : null}
      <span className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/10" />
      <span className="absolute inset-0 grid place-items-center">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-primary shadow-[0_8px_30px_rgba(0,0,0,0.45)] transition-transform duration-300 group-hover:scale-110">
          <Play className="h-6 w-6 translate-x-0.5 text-primary-foreground" fill="currentColor" />
        </span>
      </span>
      <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full bg-background/80 px-3 py-1 text-caption backdrop-blur">
        {video.source === "instagram_reel" ? "Instagram" : "TikTok"}
        <ExternalLink className="h-3 w-3" />
      </span>
    </a>
  );
}

function Lightbox({
  images,
  startAt,
  title,
  onClose,
}: {
  images: { url: string; alt: string }[];
  startAt: number;
  title: string;
  onClose: () => void;
}) {
  const [ref, embla] = useEmblaCarousel({
    loop: images.length > 1,
    startIndex: Math.max(0, startAt),
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
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 z-10 grid h-10 w-10 place-items-center rounded-full border border-border bg-background/80"
      >
        <X className="h-5 w-5" />
      </button>
      {images.length > 1 ? (
        <span className="absolute left-4 top-4 z-10 rounded-full border border-border bg-background/80 px-3 py-1 text-caption">
          {index + 1} / {images.length}
        </span>
      ) : null}

      <div className="flex h-full items-center">
        {images.length > 1 ? (
          <button
            type="button"
            onClick={() => embla?.scrollPrev()}
            aria-label="Previous image"
            className="absolute left-2 md:left-6 z-10 grid h-10 w-10 place-items-center rounded-full border border-border bg-background/80"
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
                  alt={img.alt || title}
                  onDoubleClick={() => setZoomed((z) => !z)}
                  className={`max-h-[85vh] max-w-full select-none object-contain transition-transform duration-300 ${
                    zoomed && i === index ? "scale-[1.8] cursor-zoom-out" : "cursor-zoom-in"
                  }`}
                />
              </div>
            ))}
          </div>
        </div>

        {images.length > 1 ? (
          <button
            type="button"
            onClick={() => embla?.scrollNext()}
            aria-label="Next image"
            className="absolute right-2 md:right-6 z-10 grid h-10 w-10 place-items-center rounded-full border border-border bg-background/80"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        ) : null}
      </div>
    </motion.div>
  );
}
