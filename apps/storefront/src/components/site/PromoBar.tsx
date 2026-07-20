import { SmartLink } from "@/components/site/SmartLink";
import { useSiteChrome } from "@/lib/site-config";

/**
 * Scrolling promo strip. Duplicates the row for a seamless loop and pauses on
 * hover so people can read the offers. The offers are Studio-editable
 * (Pages → “Site chrome” → Promo bar); falls back to the maison defaults.
 */
export function PromoBar() {
  const { promo, dividerImage } = useSiteChrome();
  const items = promo.items;
  if (!items.length) return null;
  const loop = [...items, ...items];
  return (
    <div className="bg-ink/60 backdrop-blur-md border-b border-taupe/15 overflow-hidden group">
      <div
        className="flex whitespace-nowrap py-2 text-[0.62rem] tracking-[0.4em] uppercase text-taupe/85 group-hover:[animation-play-state:paused]"
        style={{ animation: "promo-scroll 38s linear infinite", width: "200%" }}
      >
        {loop.map((it, i) => {
          const content = (
            <span className="inline-flex items-center gap-3">
              <span className="text-taupe/90">{it.text}</span>
              {it.emphasis && (
                <span className="font-accent text-[0.7rem] tracking-[0.06em] text-rose normal-case">
                  {it.emphasis}
                </span>
              )}
            </span>
          );
          return (
            <span key={i} className="flex items-center gap-10 px-10">
              {it.url ? (
                <SmartLink to={it.url} className="hover:text-cream transition-colors">
                  {content}
                </SmartLink>
              ) : (
                content
              )}
              {dividerImage ? (
                <img
                  src={dividerImage}
                  alt=""
                  aria-hidden="true"
                  className="h-4 w-auto max-w-[2.5rem] shrink-0 object-contain opacity-80"
                />
              ) : (
                <span className="w-1 h-1 rounded-full bg-rose/60" />
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
