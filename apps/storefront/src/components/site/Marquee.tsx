import { DEFAULT_HOME } from "@/lib/home-content";

/**
 * Value-prop ribbon. `items` are the scrolling phrases; `image` (optional,
 * uploaded in Storefront Studio → Home → "Divider image") is shown between each
 * phrase like a brand mark — mirroring the flower separators on the reference
 * site. With no image we fall back to the original subtle dot, so the ribbon
 * looks intentional whether or not a logo is uploaded.
 *
 * Colours use the theme-remapped `--taupe` token (deep on the light cream bg,
 * light on the dark ink bg) so the text stays readable in BOTH modes — a fixed
 * brand-red would vanish on the dark ribbon.
 */
export function Marquee({
  items = DEFAULT_HOME.marquee,
  image,
}: {
  items?: string[];
  image?: string;
}) {
  const loop = [...items, ...items];
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
            {image ? (
              <img
                src={image}
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
