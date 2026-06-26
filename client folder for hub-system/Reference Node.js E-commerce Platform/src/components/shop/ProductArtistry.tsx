import { Reveal } from "@/components/site/Reveal";
import { DEFAULT_ARTISTRY, type ArtistryContent } from "@/lib/site-content";
import { useSiteContent } from "@/lib/use-site-content";

/**
 * "Pixie artistry done for you" — appears on every product page below the
 * detail panel. Copy is data-driven so the founder can override per-product
 * via the Product.artistry field, or sitewide / per-product via the Studio.
 */
export function ProductArtistry({
  productName,
  productSlug,
  content,
}: {
  productName: string;
  productSlug?: string;
  content?: Partial<ArtistryContent>;
}) {
  const fallback: ArtistryContent = { ...DEFAULT_ARTISTRY, ...(content ?? {}) };
  // Studio override key: per-product if slug is known, else global.
  const key = productSlug ? `artistry:product:${productSlug}` : "artistry:global";
  const c = useSiteContent<ArtistryContent>(key, fallback);
  const body = c.body.replace(/\{name\}/g, productName);

  return (
    <section className="bg-card/40 border-y border-taupe/15 mt-32">
      <div className="mx-auto max-w-[1100px] px-6 lg:px-10 py-24 md:py-32">
        <Reveal>
          <p className="text-caption text-rose mb-4">{c.eyebrow}</p>
          <h2 className="text-h2 max-w-3xl">
            {c.title}
            {c.emphasis ? <em className="font-couture text-taupe"> {c.emphasis}</em> : null}
            {c.emphasis ? " and move." : ""}
          </h2>
          <p className="text-body-lg text-cream/75 mt-8 max-w-3xl">{body}</p>

          <ul className="mt-10 grid sm:grid-cols-2 gap-x-10 gap-y-4 max-w-3xl">
            {c.bullets.map((d) => (
              <li key={d} className="flex gap-3 text-body text-cream/80">
                <span className="text-rose">—</span>
                <span>{d}</span>
              </li>
            ))}
          </ul>

          <p className="mt-12 text-body text-cream/65 max-w-3xl border-l-2 border-rose/60 pl-5 italic font-couture">
            {c.footnote}
          </p>
        </Reveal>
      </div>
    </section>
  );
}
