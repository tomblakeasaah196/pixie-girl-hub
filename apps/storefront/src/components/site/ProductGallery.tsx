import { useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { ExternalLink, Maximize2, Play } from "lucide-react";
import {
  YouTubeFacade,
  InstagramEmbed,
  TikTokEmbed,
} from "@/components/site/VideoEmbed";
import { ImageLightbox } from "@/components/site/ImageLightbox";
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

  // Reset the hero to the first shot whenever the image set changes (i.e. the
  // shopper picked a different colour) so they see that colour, not a stale
  // index carried over from the previous swatch.
  const imageSig = images.map((g) => g.url).join("|");
  const lastSig = useRef(imageSig);
  if (lastSig.current !== imageSig) {
    lastSig.current = imageSig;
    if (active !== 0) setActive(0);
  }

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
          <ImageLightbox
            images={imageMedia.map((m) => ({ url: m.url, alt: m.alt }))}
            startAt={Math.max(0, activeImagePos)}
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
  // Instagram Reels and TikTok now play INLINE via their first-party embed
  // iframes (facade → iframe on click) rather than bouncing the shopper out to
  // the app.
  if (video.source === "instagram_reel") {
    return <InstagramEmbed url={video.embed_url} title={label} />;
  }
  if (video.source === "tiktok" && /^\d+$/.test(video.external_ref)) {
    return <TikTokEmbed videoId={video.external_ref} url={video.embed_url} title={label} />;
  }
  // Fallback ONLY for links we can't embed (e.g. a TikTok short link with no
  // numeric id, or an unrecognised source): open the live post.
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
        {/* Only reachable for a TikTok short-link (no numeric id to embed);
            Instagram/YouTube/direct/embeddable-TikTok all return above. */}
        Watch video
        <ExternalLink className="h-3 w-3" />
      </span>
    </a>
  );
}
