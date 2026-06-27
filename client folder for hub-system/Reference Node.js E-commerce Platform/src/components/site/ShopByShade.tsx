import { Link } from "@tanstack/react-router";
import { Reveal, RevealGroup, RevealItem } from "@/components/site/Reveal";
import { SHADES } from "@/lib/site-content";
import shadeBlacky from "@/assets/shade-blacky.jpg.asset.json";
import shadeBrown from "@/assets/shade-brown.jpg.asset.json";
import shadePlum from "@/assets/shade-plum.jpg.asset.json";
import shadeBlondeMary from "@/assets/shade-blonde-mary.jpg.asset.json";
import shadeKhaleesi from "@/assets/shade-khaleesi.jpg.asset.json";
import shadeIcy from "@/assets/shade-icy.jpg.asset.json";

const SHADE_IMG: Record<string, string> = {
  "blacky-by-nature": shadeBlacky.url,
  "brown-jolie": shadeBrown.url,
  "plum-cherry": shadePlum.url,
  "blonde-mary": shadeBlondeMary.url,
  "khaleesi-blonde": shadeKhaleesi.url,
  "icy-grey": shadeIcy.url,
};

export function ShopByShade() {
  return (
    <section className="bg-card/40 border-y border-taupe/15">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-10 py-28 md:py-36">
        <Reveal className="max-w-2xl mb-14">
          <p className="text-caption text-rose mb-4">Shop by shade</p>
          <h2 className="text-h2">
            Find the tone that <em className="font-couture text-taupe">speaks</em> to you
          </h2>
          <p className="text-body-lg text-cream/70 mt-6">
            Explore our shade catalogue. Every tone is hand-mixed in the studio and
            colour-matched to your skin.
          </p>
        </Reveal>

        <RevealGroup className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
          {SHADES.map((s) => {
            const img = SHADE_IMG[s.slug];
            return (
              <RevealItem key={s.slug}>
                <Link
                  to="/shop"
                  search={{ shade: s.slug }}
                  className="group relative block aspect-[3/4] overflow-hidden focus:outline-none focus:ring-2 focus:ring-rose/60"
                  aria-label={`Shop ${s.name}`}
                >
                  {/* Tinted base — preserves the brand swatch as a fallback while the image loads */}
                  <div className="absolute inset-0" style={{ background: s.swatch }} />
                  {/* Macro hair-strand texture */}
                  {img && (
                    <img
                      src={img}
                      alt=""
                      loading="lazy"
                      width={768}
                      height={1024}
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-[1.06]"
                    />
                  )}
                  {/* Editorial vignette so the type stays legible */}
                  <div className="absolute inset-0 bg-gradient-to-t from-ink/85 via-ink/15 to-ink/20" />
                  {/* Sheen on hover — luxe shimmer pass */}
                  <div className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-cream/15 to-transparent transition-transform duration-1000 ease-out group-hover:translate-x-full" />

                  <div className="absolute inset-x-0 bottom-0 p-4 md:p-5">
                    <p className="text-caption text-cream/70">Shade</p>
                    <h3 className="font-display text-lg md:text-xl mt-1 text-cream drop-shadow-[0_2px_8px_rgba(0,0,0,0.55)]">{s.name}</h3>
                  </div>
                  <span className="absolute top-3 right-3 w-7 h-7 rounded-full border border-cream/60 grid place-items-center text-cream/80 text-xs opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm bg-ink/20">→</span>
                </Link>
              </RevealItem>
            );
          })}
        </RevealGroup>
      </div>
    </section>
  );
}
