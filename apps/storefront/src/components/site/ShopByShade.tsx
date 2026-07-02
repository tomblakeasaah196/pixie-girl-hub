import { Link } from "@tanstack/react-router";
import { Reveal, RevealGroup, RevealItem } from "@/components/site/Reveal";
import {
  DEFAULT_HOME,
  DEMO_SHADE_ITEMS,
  type ShadeItem,
  type HeadContent,
} from "@/lib/home-content";

/**
 * Shop-by-shade tiles. `items` come live from the Hub (/shades) with their
 * cover images; falls back to the ported demo swatches.
 */
export function ShopByShade({
  head = DEFAULT_HOME.shadesHead,
  items,
}: {
  head?: HeadContent;
  items?: ShadeItem[];
}) {
  const shades = items && items.length ? items : DEMO_SHADE_ITEMS;
  return (
    <section className="bg-card/40 border-y border-taupe/15">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-10 py-28 md:py-36">
        <Reveal className="max-w-2xl mb-14">
          <p className="text-caption text-rose mb-4">{head.eyebrow}</p>
          <h2 className="text-h2">
            {head.heading}
            {head.headingAccent ? <em className="font-couture text-taupe">{head.headingAccent}</em> : null}
            {head.headingAfter}
          </h2>
          {head.body ? <p className="text-body-lg text-cream/70 mt-6">{head.body}</p> : null}
        </Reveal>

        <RevealGroup className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
          {shades.map((s) => (
            <RevealItem key={s.slug}>
              <Link
                to="/shop"
                search={{ shade: s.slug }}
                className="group relative block aspect-[3/4] overflow-hidden focus:outline-none focus:ring-2 focus:ring-rose/60"
                aria-label={`Shop ${s.name}`}
              >
                <div className="absolute inset-0" style={{ background: s.swatch ?? "var(--taupe)" }} />
                {s.image ? (
                  <img
                    src={s.image}
                    alt=""
                    loading="lazy"
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-[1.06]"
                  />
                ) : null}
                <div className="absolute inset-0 bg-gradient-to-t from-ink/85 via-ink/15 to-ink/20" />
                <div className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-cream/15 to-transparent transition-transform duration-1000 ease-out group-hover:translate-x-full" />

                <div className="absolute inset-x-0 bottom-0 p-4 md:p-5">
                  <p className="text-caption text-cream/70">Shade</p>
                  <h3 className="font-display text-lg md:text-xl mt-1 text-cream drop-shadow-[0_2px_8px_rgba(0,0,0,0.55)]">{s.name}</h3>
                </div>
                <span className="absolute top-3 right-3 w-7 h-7 rounded-full border border-cream/60 grid place-items-center text-cream/80 text-xs opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm bg-ink/20">→</span>
              </Link>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}
