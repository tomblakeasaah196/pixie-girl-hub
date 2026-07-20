import { useMemo, useState } from "react";
import { Play } from "lucide-react";

/**
 * Pulls the YouTube video id out of whatever the owner pasted into the
 * catalogue's "Head-size video" box: a share link (youtu.be/ID), a watch URL
 * (youtube.com/watch?v=ID), an embed URL (youtube.com/embed/ID), a Shorts URL,
 * OR a full `<iframe …>` embed snippet (we just read the src inside it).
 * Returns null for non-YouTube URLs so the caller falls back to a native
 * <video> player.
 *
 * Ported verbatim from the live sales landing (apps/landing) so a product's
 * head-size video looks and behaves identically across both surfaces.
 */
export function youtubeId(url: string): string | null {
  const m =
    url.match(
      /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/,
    ) || url.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}

/**
 * Lazy "facade" YouTube player. We render a branded poster + play button and
 * only mount the real YouTube iframe AFTER the first click. Benefits:
 *  - The page paints instantly (no heavy player on load).
 *  - We build the embed URL with `origin` set to the live page, which fixes
 *    the intermittent "Error 153 — video player configuration error" YouTube
 *    throws when it can't verify the embedding origin.
 *  - `youtube-nocookie.com` + `modestbranding` + `rel=0` keep it on-brand with
 *    minimal YouTube chrome; the view still counts on YouTube.
 *  - If the player ever fails, a quiet "Watch on YouTube" link is the escape
 *    hatch instead of a dead black box.
 *
 * Styling uses the storefront's own design tokens (primary / border /
 * secondary) so it inherits the active brand skin rather than the landing's
 * palette.
 */
/**
 * Shared "facade" play tile — a branded poster + play button that mounts the
 * real embed iframe only after the first click. Keeps the page light and avoids
 * every gallery video hammering Instagram/TikTok on load.
 */
function PlayFacade({
  onPlay,
  label,
  poster,
}: {
  onPlay: () => void;
  label: string;
  poster?: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onPlay}
      aria-label={`Play ${label} video`}
      className="group relative block h-full w-full overflow-hidden bg-ink"
    >
      {poster ? (
        <img
          src={poster}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
      <span className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-black/20" />
      <span className="absolute inset-0 grid place-items-center">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-primary shadow-[0_8px_30px_rgba(0,0,0,0.45)] transition-transform duration-300 group-hover:scale-110">
          <Play
            className="h-6 w-6 translate-x-0.5 text-primary-foreground"
            fill="currentColor"
          />
        </span>
      </span>
      <span className="absolute bottom-3 right-3 rounded-full bg-background/80 px-3 py-1 text-caption backdrop-blur">
        {label}
      </span>
    </button>
  );
}

/**
 * Instagram Reel/post, embedded inline. We derive the first-party `/embed`
 * iframe URL from the pasted link (stripping tracking params and preserving the
 * reel/p/tv path), so the clip plays IN the page instead of bouncing the shopper
 * out to instagram.com. A quiet "Watch on Instagram" link is the escape hatch.
 */
export function InstagramEmbed({ url, title }: { url: string; title: string }) {
  const [playing, setPlaying] = useState(false);
  const embedSrc = useMemo(() => {
    const clean = url.split(/[?#]/)[0].replace(/\/+$/, "");
    return `${clean}/embed`;
  }, [url]);

  if (!playing) return <PlayFacade onPlay={() => setPlaying(true)} label="Instagram" />;
  return (
    <div className="relative h-full w-full bg-white">
      <iframe
        src={embedSrc}
        title={title}
        loading="lazy"
        scrolling="no"
        allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
        allowFullScreen
        className="absolute inset-0 h-full w-full"
      />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-2 right-2 rounded-full bg-background/80 px-3 py-1 text-caption backdrop-blur transition-opacity hover:opacity-90"
      >
        Watch on Instagram ↗
      </a>
    </div>
  );
}

/**
 * TikTok video, embedded inline via the first-party `/embed/v2/{id}` player.
 * `videoId` must be the numeric id; short-link forms that don't expose it fall
 * back to a plain link upstream in the gallery.
 */
export function TikTokEmbed({
  videoId,
  url,
  title,
}: {
  videoId: string;
  url: string;
  title: string;
}) {
  const [playing, setPlaying] = useState(false);
  if (!playing) return <PlayFacade onPlay={() => setPlaying(true)} label="TikTok" />;
  return (
    <div className="relative h-full w-full bg-ink">
      <iframe
        src={`https://www.tiktok.com/embed/v2/${videoId}`}
        title={title}
        loading="lazy"
        scrolling="no"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
        className="absolute inset-0 h-full w-full"
      />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-2 right-2 rounded-full bg-background/80 px-3 py-1 text-caption backdrop-blur transition-opacity hover:opacity-90"
      >
        Watch on TikTok ↗
      </a>
    </div>
  );
}

export function YouTubeFacade({
  videoId,
  title,
}: {
  videoId: string;
  title: string;
}) {
  const [playing, setPlaying] = useState(false);

  // Built on demand so `origin` reflects the actual live domain (SSR-safe).
  const embedSrc = useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const params = new URLSearchParams({
      autoplay: "1",
      rel: "0",
      modestbranding: "1",
      playsinline: "1",
      iv_load_policy: "3",
      ...(origin ? { origin } : {}),
    });
    return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
  }, [videoId]);

  // hqdefault always exists (unlike maxresdefault, which 404s to a grey card).
  const poster = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

  if (playing) {
    return (
      <div>
        <div className="relative aspect-video w-full overflow-hidden rounded-md border border-border bg-secondary">
          <iframe
            src={embedSrc}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="absolute inset-0 h-full w-full"
          />
        </div>
        <a
          href={watchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-block text-caption opacity-60 transition-opacity hover:opacity-90"
        >
          Trouble playing? Watch on YouTube ↗
        </a>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      aria-label="Play video"
      className="group relative block aspect-video w-full overflow-hidden rounded-md border border-border bg-secondary"
    >
      <img
        src={poster}
        alt={title}
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <span className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/10" />
      <span className="absolute inset-0 grid place-items-center">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-primary shadow-[0_8px_30px_rgba(0,0,0,0.45)] transition-transform duration-300 group-hover:scale-110">
          <Play
            className="h-6 w-6 translate-x-0.5 text-primary-foreground"
            fill="currentColor"
          />
        </span>
      </span>
    </button>
  );
}
