import { Link } from "@tanstack/react-router";
import type { Currency, ProductCard } from "@/lib/storefront";
import { ProductCardLink, Section } from "./parts";

/**
 * Studio-driven page rendering (guide §8.4, B-lite). A published page carries a
 * template_key + slots.sections[]; we render a fixed library of section types
 * from that slot data. Unknown/empty pages return null so the route can fall
 * back to its built-in layout. No free-form canvas — a guided, typed section set.
 */

export interface PageSection {
  type: string;
  heading?: string;
  subheading?: string;
  body?: string;
  image_url?: string;
  cta_label?: string;
  cta_href?: string;
  text?: string;
}

export interface StudioPage {
  page_key?: string;
  template_key?: string;
  url_path?: string;
  meta_title?: string;
  meta_description?: string;
  slots?: { sections?: PageSection[] } & Record<string, unknown>;
}

export function hasSections(page?: StudioPage | null): boolean {
  return !!page?.slots?.sections && page.slots.sections.length > 0;
}

function Hero({ s }: { s: PageSection }) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      {s.subheading ? <p className="text-caption">{s.subheading}</p> : null}
      {s.heading ? <h1 className="mt-4 text-h1 font-display">{s.heading}</h1> : null}
      {s.body ? (
        <p className="mt-6 max-w-xl text-body-lg text-muted-foreground">{s.body}</p>
      ) : null}
      {s.cta_label && s.cta_href ? (
        <Link
          to={s.cta_href}
          className="mt-8 inline-block rounded-full bg-primary px-7 py-3 text-body text-primary-foreground"
        >
          {s.cta_label}
        </Link>
      ) : null}
    </section>
  );
}

function Editorial({ s }: { s: PageSection }) {
  return (
    <Section className="grid items-center gap-8 md:grid-cols-2">
      {s.image_url ? (
        <div className="aspect-[4/3] overflow-hidden rounded-md bg-secondary">
          <img src={s.image_url} alt={s.heading || ""} className="h-full w-full object-cover" />
        </div>
      ) : null}
      <div>
        {s.heading ? <h2 className="text-h3 font-display">{s.heading}</h2> : null}
        {s.body ? (
          <p className="mt-4 text-body text-muted-foreground">{s.body}</p>
        ) : null}
        {s.cta_label && s.cta_href ? (
          <Link to={s.cta_href} className="mt-6 inline-block underline">
            {s.cta_label}
          </Link>
        ) : null}
      </div>
    </Section>
  );
}

function Banner({ s }: { s: PageSection }) {
  if (!s.text) return null;
  return (
    <div className="bg-burgundy py-2 text-center text-body-sm text-cream">
      {s.text}
    </div>
  );
}

function ProductGrid({
  s,
  products,
  currency,
}: {
  s: PageSection;
  products: ProductCard[];
  currency: Currency;
}) {
  if (!products.length) return null;
  return (
    <Section>
      <div className="flex items-end justify-between">
        <h2 className="text-h3 font-display">{s.heading || "Featured"}</h2>
        <Link to="/shop" className="text-body-sm text-muted-foreground hover:text-foreground">
          View all
        </Link>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-6 md:grid-cols-4">
        {products.map((p) => (
          <ProductCardLink key={p.styled_id} p={p} currency={currency} />
        ))}
      </div>
    </Section>
  );
}

export function PageTemplate({
  page,
  products,
  currency,
}: {
  page: StudioPage;
  products: ProductCard[];
  currency: Currency;
}) {
  const sections = page.slots?.sections ?? [];
  return (
    <main>
      {sections.map((s, i) => {
        switch (s.type) {
          case "hero":
            return <Hero key={i} s={s} />;
          case "editorial":
            return <Editorial key={i} s={s} />;
          case "banner":
            return <Banner key={i} s={s} />;
          case "product_grid":
            return <ProductGrid key={i} s={s} products={products} currency={currency} />;
          default:
            return null;
        }
      })}
    </main>
  );
}
