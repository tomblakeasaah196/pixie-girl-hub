import { ExternalLink } from "lucide-react";
import { PLATFORM_UI, type SocialPlatform } from "@/lib/social-api";

/**
 * The visual "extract" of a posted link inside a calendar day.
 *
 * YouTube renders a real interactive player — youtube.com is allow-listed in
 * the app CSP (`frame-src`/`script-src`), so its oEmbed iframe just works.
 *
 * Instagram / Facebook / TikTok can't render their live JS embeds here: their
 * embed scripts (instagram.com/embed.js, tiktok embed.js, Facebook SDK) are
 * blocked by our strict `script-src` — and that block is a deliberate XSS
 * control, not a bug to work around. So they get a rich card built from the
 * public oEmbed thumbnail + author, which is safe, always renders, and is the
 * "extract from the post" the brief asked for. The card links straight out to
 * the live post for the full thing.
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

function PlatformBadge({ platform }: { platform: SocialPlatform }) {
  const ui = PLATFORM_UI[platform];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide text-white"
      style={{ background: ui.color }}
    >
      <span className="font-display">{ui.glyph}</span>
      {ui.label}
    </span>
  );
}

export function PostEmbed({
  platform,
  url,
  thumbnailUrl,
  authorHandle,
}: {
  platform: SocialPlatform;
  url: string;
  thumbnailUrl?: string | null;
  authorHandle?: string | null;
}) {
  if (platform === "youtube") {
    const id = youtubeId(url);
    if (id) {
      return (
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
      );
    }
  }

  // Rich card for IG / FB / TikTok (and YouTube links we couldn't parse).
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
            alt={`Post on ${PLATFORM_UI[platform].label}`}
            className="max-h-[340px] w-full object-cover"
            loading="lazy"
          />
          <div className="absolute left-2.5 top-2.5">
            <PlatformBadge platform={platform} />
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      ) : (
        <div
          className="grid h-[132px] place-items-center"
          style={{
            background: `linear-gradient(135deg, ${PLATFORM_UI[platform].color}26, transparent)`,
          }}
        >
          <span
            className="grid h-12 w-12 place-items-center rounded-2xl font-display text-lg font-semibold text-white"
            style={{ background: PLATFORM_UI[platform].color }}
          >
            {PLATFORM_UI[platform].glyph}
          </span>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-semibold">
            {authorHandle ? `@${authorHandle}` : PLATFORM_UI[platform].label}
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
