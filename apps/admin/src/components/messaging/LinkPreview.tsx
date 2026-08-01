import { useState } from "react";
import { Link2 } from "lucide-react";
import { useLinkPreview } from "@/hooks/useSmartcomm";
import { toHref } from "@/lib/linkify";
import { cn } from "@/lib/cn";

/**
 * WhatsApp-style link preview card. Fetches OG/Twitter metadata for `url`
 * (server-side unfurl, SSRF-guarded + cached) and renders a tappable card —
 * banner image on top when present, then site name / title / description.
 *
 * Fails invisibly: while loading it renders nothing (the clickable link in the
 * message text already stands on its own), and if the link has no preview it
 * renders nothing too. So a bare/private/unreachable link just stays a link.
 */
export function LinkPreview({ url }: { url: string }) {
  const { data } = useLinkPreview(url);
  const [imgError, setImgError] = useState(false);

  const preview = data?.ok ? data.preview : undefined;
  if (!preview) return null;

  const { title, description, image, site_name, favicon } = preview;
  // Nothing worth a card — the linkified text already covers it.
  if (!title && !description && !image) return null;

  const showImage = !!image && !imgError;
  const host = site_name || safeHost(url);

  return (
    <a
      href={toHref(preview.url || url)}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "mt-1.5 block max-w-[300px] overflow-hidden rounded-xl border hairline",
        "bg-panel/60 backdrop-blur-sm no-underline transition-colors hover:bg-panel",
      )}
      title={preview.url || url}
    >
      {showImage && (
        <img
          src={image}
          alt=""
          loading="lazy"
          onError={() => setImgError(true)}
          className="max-h-[150px] w-full object-cover"
        />
      )}
      <div className="px-2.5 py-2">
        <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wide text-text-faint">
          {favicon && !imgError ? (
            <img
              src={favicon}
              alt=""
              className="h-3 w-3 rounded-sm object-contain"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <Link2 className="h-3 w-3" />
          )}
          <span className="truncate">{host}</span>
        </div>
        {title && (
          <div className="mt-0.5 line-clamp-2 text-[12.5px] font-medium leading-snug text-text-primary">
            {title}
          </div>
        )}
        {description && (
          <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-text-muted">
            {description}
          </div>
        )}
      </div>
    </a>
  );
}

/**
 * Render preview cards for a set of URLs (deduped + capped upstream by
 * extractUrls). One card per link, WhatsApp-style, stacked under the message.
 */
export function LinkPreviews({ urls }: { urls: string[] }) {
  if (!urls.length) return null;
  return (
    <div className="space-y-1.5">
      {urls.map((u) => (
        <LinkPreview key={u} url={u} />
      ))}
    </div>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(toHref(url)).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
