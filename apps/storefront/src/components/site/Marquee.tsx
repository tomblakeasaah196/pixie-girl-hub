import { DEFAULT_HOME } from "@/lib/home-content";
import { useSiteChrome } from "@/lib/site-config";

/**
 * Value-prop ribbon below the hero. `items` are the scrolling phrases; the
 * divider mark shown between each phrase is the SAME shared image the top promo
 * bar uses (Studio → Site chrome → "Divider image", with a fallback to the
 * legacy Home upload) — so both announcement bars carry one consistent brand
 * mark. With no image we fall back to the original subtle dot, so the ribbon
 * looks intentional whether or not a mark is uploaded.
 *
 * Colours use the theme-remapped `--taupe` token (deep on the light cream bg,
 * light on the dark ink bg) so the text stays readable in BOTH modes — a fixed
 * brand-red would vanish on the dark ribbon.
 */
export function Marquee({ items = DEFAULT_HOME.marquee }: { items?: string[] }) {
  const { dividerImage } = useSiteChrome();
  // Guard against an empty published array so the ribbon is never a blank strip.
  const phrases = items.length ? items : DEFAULT_HOME.marquee;
  const loop = [...phrases, ...phrases];
  return (
    <section className="border-y border-taupe/15 bg-ink py-5 overflow-hidden">
      <div
        className="flex whitespace-nowrap"
        style={{ animation: "marquee-scroll 32s linear infinite", width: "200%" }}
      >
        {loop.map((t, i) => (
          <span
            key={i}
            className="text-[0.7rem] tracking-[0.4em] uppercase text-taupe flex items-center gap-16 px-8"
          >
            {t}
            {dividerImage ? (
              <img
                src={dividerImage}
                alt=""
                aria-hidden="true"
                className="h-5 w-auto max-w-[3rem] shrink-0 object-contain"
              />
            ) : (
              <span className="w-1 h-1 rounded-full bg-taupe/50" />
            )}
          </span>
        ))}
      </div>
    </section>
  );
}
