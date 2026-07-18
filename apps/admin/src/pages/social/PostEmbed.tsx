import { useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import type { PlatformLook } from "@/lib/social-api";

/**
 * The live embed of a posted link inside a calendar day.
 *
 * Every canonical platform renders through its OWN iframe endpoint — a plain
 * sandboxed cross-origin frame, no third-party <script> widget ever enters our
 * page, so the admin's strict script-src CSP is untouched (frame-src
 * allow-lists these hosts in src/middleware/index.js):
 *
 *   instagram — instagram.com/{p|reel|tv}/{code}/embed/captioned/  (the exact
 *               endpoint the storefront journal already ships in production —
 *               apps/storefront content-blocks.ts#instagramEmbedSrc — showing
 *               the media, caption and public like count)
 *   facebook  — facebook.com/plugins/post.php | video.php (public posts)
 *   tiktok    — tiktok.com/player/v1/{videoId} (official player)
 *   youtube   — youtube.com/embed/{id}
 *
 * Anything unparseable — a short link, a photo TikTok, a registry-added
 * platform like Pinterest — falls back to a rich card built from the oEmbed
 * thumbnail + author, which always renders and links out to the live post.
 */

function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (/(^|\.)youtu\.be$/i.test(u.hostname)) return u.pathname.slice(1) || null;
    if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2] || null;
    if (u.pathname.startsWith("/embed/")) return u.pathname.split("/")[2] || null;
    return u.searchParams.get("v");
  } catch {
    return null;
  }
}

/** Mirrors apps/storefront content-blocks.ts — Instagram's own iframe embed,
 *  preserving the pasted path type (p / reel / tv). */
function instagramEmbedSrc(url: string): string | null {
  const m = /instagram\.com\/(reel|p|tv)\/([a-zA-Z0-9_-]+)/.exec(url || "");
  return m ? `https://www.instagram.com/${m[1]}/${m[2]}/embed/captioned/` : null;
}

function tiktokVideoId(url: string): string | null {
  const m = /tiktok\.com\/(?:@[^/]+\/)?video\/(\d+)/.exec(url || "");
  return m ? m[1] : null;
}

function facebookEmbedSrc(url: string): { src: string; video: boolean } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)(facebook\.com|fb\.watch)$/i.test(u.hostname)) return null;
  const video =
    /(^|\.)fb\.watch$/i.test(u.hostname) ||
    /\/(videos?|watch|reel)(\/|$)/.test(u.pathname);
  const kind = video ? "video" : "post";
  return {
    src: `https://www.facebook.com/plugins/${kind}.php?href=${encodeURIComponent(url)}&show_text=true&width=500`,
    video,
  };
}

/** Slim footer under every embed: platform badge + open-on-platform link —
 *  consistent structure no matter which platform is above it. */
function EmbedFooter({ look, url }: { look: PlatformLook; url: string }) {
  return (
    <div className="mt-1.5 flex items-center justify-between gap-2 px-0.5">
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-text-muted">
        <span
          className="grid h-[18px] w-[18px] place-items-center rounded-[5px] font-display text-[8.5px] font-semibold text-white"
          style={{ background: look.color }}
        >
          {look.glyph}
        </span>
        {look.label}
      </span>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent-glow hover:underline"
      >
        Open <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

function FrameShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[540px] overflow-hidden rounded-[14px] border border-line bg-white">
      {children}
    </div>
  );
}

/** Instagram's embed iframe reports its rendered height via a MEASURE
 *  postMessage (the same signal embed.js listens for) — resize to it so the
 *  card never clips the caption or leaves a dead gap. */
function InstagramFrame({ src }: { src: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(620);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== "https://www.instagram.com") return;
      if (!ref.current || e.source !== ref.current.contentWindow) return;
      try {
        const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (data?.type === "MEASURE") {
          const h = Number(data?.details?.height);
          if (Number.isFinite(h) && h > 100) setHeight(Math.min(h, 1400));
        }
      } catch {
        /* not an embed message */
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return (
    <FrameShell>
      <iframe
        ref={ref}
        src={src}
        title="Instagram post"
        loading="lazy"
        allow="clipboard-write; encrypted-media"
        className="w-full border-0"
        style={{ height }}
      />
    </FrameShell>
  );
}

export function PostEmbed({
  platform,
  url,
  thumbnailUrl,
  authorHandle,
  look,
}: {
  platform: string;
  url: string;
  thumbnailUrl?: string | null;
  authorHandle?: string | null;
  look: PlatformLook;
}) {
  if (platform === "youtube") {
    const id = youtubeId(url);
    if (id) {
      return (
        <div>
          <div className="relative w-full overflow-hidden rounded-[14px] border border-line bg-black">
            <div className="aspect-video w-full">
              <iframe
                src={`https://www.youtube.com/embed/${id}`}
                title="YouTube post"
                className="h-full w-full"
                loading="lazy"
                allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>
          <EmbedFooter look={look} url={url} />
        </div>
      );
    }
  }

  if (platform === "instagram") {
    const src = instagramEmbedSrc(url);
    if (src) {
      return (
        <div>
          <InstagramFrame src={src} />
          <EmbedFooter look={look} url={url} />
        </div>
      );
    }
  }

  if (platform === "tiktok") {
    const id = tiktokVideoId(url);
    if (id) {
      return (
        <div>
          <div className="mx-auto aspect-[9/16] w-full max-w-[360px] overflow-hidden rounded-[14px] border border-line bg-black">
            <iframe
              src={`https://www.tiktok.com/player/v1/${id}?rel=0&description=1`}
              title="TikTok post"
              loading="lazy"
              allow="encrypted-media; picture-in-picture; fullscreen"
              className="h-full w-full border-0"
            />
          </div>
          <EmbedFooter look={look} url={url} />
        </div>
      );
    }
  }

  if (platform === "facebook") {
    const fb = facebookEmbedSrc(url);
    if (fb) {
      return (
        <div>
          <FrameShell>
            <iframe
              src={fb.src}
              title="Facebook post"
              loading="lazy"
              allow="clipboard-write; encrypted-media; picture-in-picture"
              className="w-full border-0"
              style={{ height: fb.video ? 500 : 640 }}
            />
          </FrameShell>
          <EmbedFooter look={look} url={url} />
        </div>
      );
    }
  }

  // Fallback: rich card from the oEmbed thumbnail — for short links we can't
  // parse, photo TikToks, and registry-added platforms with no iframe endpoint.
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="group block overflow-hidden rounded-[14px] border border-line bg-text-primary/[0.02] transition-colors hover:border-accent/40"
    >
      {thumbnailUrl ? (
        <div className="relative">
          <img
            src={thumbnailUrl}
            alt={`Post on ${look.label}`}
            className="max-h-[340px] w-full object-cover"
            loading="lazy"
          />
          <div className="absolute left-2.5 top-2.5">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide text-white"
              style={{ background: look.color }}
            >
              <span className="font-display">{look.glyph}</span>
              {look.label}
            </span>
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      ) : (
        <div
          className="grid h-[132px] place-items-center"
          style={{
            background: `linear-gradient(135deg, ${look.color}26, transparent)`,
          }}
        >
          <span
            className="grid h-12 w-12 place-items-center rounded-2xl font-display text-lg font-semibold text-white"
            style={{ background: look.color }}
          >
            {look.glyph}
          </span>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-semibold">
            {authorHandle ? `@${authorHandle}` : look.label}
          </div>
          <div className="truncate font-mono text-[10.5px] text-text-faint">
            {url.replace(/^https?:\/\/(www\.)?/, "")}
          </div>
        </div>
        <span className="inline-flex flex-none items-center gap-1 text-[11.5px] font-semibold text-accent-glow">
          Open <ExternalLink className="h-3.5 w-3.5" />
        </span>
      </div>
    </a>
  );
}
