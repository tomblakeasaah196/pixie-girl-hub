import { SmartLink } from "@/components/site/SmartLink";

const ITEMS: { text: string; emphasis?: string; to?: string }[] = [
  { text: "Complimentary worldwide shipping on orders over $800" },
  { text: "Bulk savings — 2 pieces $40 off · 3 pieces $90 off", emphasis: "auto-applied" },
  { text: "First order? Take 10% off with code", emphasis: "FAITLYN10" },
  { text: "Refer & earn up to $50 atelier credit", to: "/account" },
];

/**
 * Scrolling promo strip. Duplicates the row for a seamless loop and pauses on
 * hover so people can read the offers.
 */
export function PromoBar() {
  const loop = [...ITEMS, ...ITEMS];
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
              {it.to ? (
                <SmartLink to={it.to} className="hover:text-cream transition-colors">
                  {content}
                </SmartLink>
              ) : (
                content
              )}
              <span className="w-1 h-1 rounded-full bg-rose/60" />
            </span>
          );
        })}
      </div>
    </div>
  );
}
