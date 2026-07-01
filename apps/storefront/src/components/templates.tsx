import type { Currency, ProductCard } from "@/lib/storefront";
import { ProductCardLink, Section } from "./parts";

/**
 * Studio-driven page rendering (guide §8.4).
 *
 * A published Storefront-Studio page carries a `template_key` + `slots.sections[]`.
 * Each section has a typed `type` that maps to one renderer in the library below.
 * This is the SAME path the built-in home uses via `defaultHomePage()` — so the
 * default maison design and any Studio-published design render identically, and
 * Studio can reorder / re-copy / recolour every section without code changes.
 *
 * The section set mirrors the full Faitlyn reference so NOTHING is lost:
 *   announcement (chrome) · hero · marquee · category_grid · shade_grid ·
 *   product_carousel · product_grid · feature_list · editorial · press_bar ·
 *   testimonials · instagram_grid · founder_note · banner.
 */

export interface SectionItem {
  label?: string;
  sublabel?: string;
  body?: string;
  href?: string;
  image_url?: string;
  swatch?: string; // hex for shade chips
  badge?: string; // eyebrow/number e.g. "01"
  author?: string;
  meta?: string; // author location / role
}

export interface PageSection {
  type: string;
  eyebrow?: string; // small uppercase caption
  heading?: string;
  accent?: string; // italic couture flourish inside the heading
  heading_suffix?: string;
  subheading?: string;
  body?: string;
  image_url?: string;
  cta_label?: string;
  cta_href?: string;
  cta2_label?: string;
  cta2_href?: string;
  link_label?: string; // top-right "View all →"
  link_href?: string;
  text?: string; // ribbon / banner copy
  items?: SectionItem[];
  variant?: string;
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

/* ── shared bits ─────────────────────────────────────────────── */

function HeadingLine({
  s,
  className = "",
}: {
  s: PageSection;
  className?: string;
}) {
  if (!s.heading && !s.accent) return null;
  return (
    <span className={className}>
      {s.heading}
      {s.accent ? <em className="font-couture">{s.accent}</em> : null}
      {s.heading_suffix}
    </span>
  );
}

function Eyebrow({ children }: { children?: string }) {
  if (!children) return null;
  return (
    <p className="text-caption text-accent">{children}</p>
  );
}

/* ── hero ────────────────────────────────────────────────────── */

function Hero({ s }: { s: PageSection }) {
  const hasImage = !!s.image_url;
  return (
    <section
      className={`relative isolate flex min-h-[86vh] flex-col justify-end overflow-hidden ${
        hasImage ? "" : "bg-gradient-to-b from-secondary/40 to-background"
      }`}
    >
      {hasImage ? (
        <>
          <img
            src={s.image_url}
            alt=""
            className="absolute inset-0 -z-10 h-full w-full object-cover"
          />
          <div
            aria-hidden
            className="absolute inset-0 -z-10"
            style={{
              background:
                "linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.05) 32%, rgba(0,0,0,0.15) 60%, rgba(0,0,0,0.82) 100%)",
            }}
          />
        </>
      ) : (
        <div
          aria-hidden
          className="absolute inset-0 -z-10 flex items-center justify-center"
        >
          <span className="select-none font-couture text-[40vw] leading-none text-foreground/[0.04]">
            F
          </span>
        </div>
      )}

      <div className="mx-auto w-full max-w-6xl px-5 pb-[12vh] pt-40 md:px-8">
        {s.eyebrow ? (
          <p
            className={`text-caption ${hasImage ? "text-white/70" : "text-accent"}`}
          >
            {s.eyebrow}
          </p>
        ) : null}
        <h1
          className={`mt-5 max-w-4xl text-h1 ${hasImage ? "text-white" : "text-foreground"}`}
        >
          <HeadingLine s={s} />
        </h1>
        {s.body ? (
          <p
            className={`mt-6 max-w-xl text-body-lg ${
              hasImage ? "text-white/85" : "text-muted-foreground"
            }`}
          >
            {s.body}
          </p>
        ) : null}
        <div className="mt-9 flex flex-wrap items-center gap-3">
          {s.cta_label && s.cta_href ? (
            <a
              href={s.cta_href}
              className="rounded-full bg-primary px-8 py-3.5 text-caption text-primary-foreground transition-transform hover:-translate-y-0.5"
            >
              {s.cta_label}
            </a>
          ) : null}
          {s.cta2_label && s.cta2_href ? (
            <a
              href={s.cta2_href}
              className={`rounded-full border px-8 py-3.5 text-caption transition-colors ${
                hasImage
                  ? "border-white/40 text-white hover:bg-white/10"
                  : "border-border text-foreground hover:bg-secondary"
              }`}
            >
              {s.cta2_label}
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/* ── marquee value-prop ribbon ───────────────────────────────── */

function Marquee({ s }: { s: PageSection }) {
  const items = s.items?.length
    ? s.items.map((i) => i.label ?? "")
    : (s.text ?? "").split("·").map((t) => t.trim());
  if (!items.length) return null;
  const loop = [...items, ...items];
  return (
    <div className="border-y border-border/60 bg-secondary/30 py-4">
      <div className="group relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_6%,black_94%,transparent)]">
        <div className="flex w-max animate-marquee gap-10 group-hover:[animation-play-state:paused]">
          {loop.map((t, i) => (
            <span
              key={i}
              className="flex shrink-0 items-center gap-10 text-caption text-muted-foreground"
            >
              {t}
              <span aria-hidden className="text-accent">
                ✦
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── category grid (Four silhouettes) ────────────────────────── */

function CategoryGrid({ s }: { s: PageSection }) {
  const items = s.items ?? [];
  return (
    <Section className="py-16 md:py-24">
      <SectionHead s={s} />
      <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
        {items.map((it, i) => (
          <a
            key={i}
            href={it.href ?? "/shop"}
            className="group relative flex aspect-[3/4] items-end overflow-hidden rounded-md bg-secondary"
          >
            {it.image_url ? (
              <img
                src={it.image_url}
                alt={it.label ?? ""}
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                loading="lazy"
              />
            ) : (
              <span
                aria-hidden
                className="absolute inset-0 flex items-center justify-center font-couture text-6xl text-foreground/10"
              >
                {(it.label ?? "").charAt(0)}
              </span>
            )}
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"
            />
            <div className="relative w-full p-5">
              <h3 className="text-h5 text-white">{it.label}</h3>
              <span className="mt-1 inline-block text-caption text-white/75">
                Shop →
              </span>
            </div>
          </a>
        ))}
      </div>
    </Section>
  );
}

/* ── shade grid (Shop by shade) ──────────────────────────────── */

function ShadeGrid({ s }: { s: PageSection }) {
  const items = s.items ?? [];
  return (
    <Section className="py-16 md:py-24">
      <SectionHead s={s} />
      {s.body ? (
        <p className="mt-4 max-w-xl text-body text-muted-foreground">{s.body}</p>
      ) : null}
      <div className="mt-10 flex flex-wrap gap-3">
        {items.map((it, i) => (
          <a
            key={i}
            href={it.href ?? "/shop"}
            className="group flex items-center gap-3 rounded-full border border-border py-2 pl-2 pr-5 transition-colors hover:border-accent hover:bg-secondary"
          >
            <span
              aria-hidden
              className="h-7 w-7 rounded-full border border-border/60"
              style={{ background: it.swatch ?? "var(--taupe)" }}
            />
            <span className="text-body-sm">{it.label}</span>
            <span className="text-accent opacity-0 transition-opacity group-hover:opacity-100">
              →
            </span>
          </a>
        ))}
      </div>
    </Section>
  );
}

/* ── product carousel (signature collection) ─────────────────── */

function ProductCarousel({
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
    <Section className="py-16 md:py-24">
      <SectionHead s={s} />
      <div className="mt-10 -mx-4 flex snap-x gap-5 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {products.map((p) => (
          <div
            key={p.styled_id}
            className="w-[62vw] shrink-0 snap-start sm:w-[42vw] md:w-[23rem]"
          >
            <ProductCardLink p={p} currency={currency} />
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ── product grid (New in) ───────────────────────────────────── */

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
    <Section className="py-16 md:py-24">
      <SectionHead s={s} />
      <div className="mt-10 grid grid-cols-2 gap-5 md:grid-cols-4 md:gap-6">
        {products.map((p) => (
          <ProductCardLink key={p.styled_id} p={p} currency={currency} />
        ))}
      </div>
    </Section>
  );
}

/* ── feature list (Why choose, numbered) ─────────────────────── */

function FeatureList({ s }: { s: PageSection }) {
  const items = s.items ?? [];
  return (
    <Section className="py-16 md:py-24">
      <div className="max-w-2xl">
        <Eyebrow>{s.eyebrow}</Eyebrow>
        <h2 className="mt-4 text-h2">
          <HeadingLine s={s} />
        </h2>
        {s.body ? (
          <p className="mt-5 text-body-lg text-muted-foreground">{s.body}</p>
        ) : null}
      </div>
      <div className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it, i) => (
          <div key={i} className="border-t border-accent/30 pt-5">
            <div className="font-mono text-body-sm text-accent">
              {it.badge ?? String(i + 1).padStart(2, "0")}
            </div>
            <h3 className="mt-3 text-h5">{it.label}</h3>
            {it.body ? (
              <p className="mt-3 text-body text-muted-foreground">{it.body}</p>
            ) : null}
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ── editorial (The Atelier) ─────────────────────────────────── */

function Editorial({ s }: { s: PageSection }) {
  return (
    <Section className="grid items-center gap-10 py-16 md:grid-cols-2 md:py-24">
      <div className="aspect-[4/5] overflow-hidden rounded-md bg-secondary">
        {s.image_url ? (
          <img
            src={s.image_url}
            alt={s.heading ?? ""}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <span
            aria-hidden
            className="flex h-full items-center justify-center font-couture text-7xl text-foreground/10"
          >
            atelier
          </span>
        )}
      </div>
      <div>
        <Eyebrow>{s.eyebrow}</Eyebrow>
        <h2 className="mt-4 text-h3">
          <HeadingLine s={s} />
        </h2>
        {s.body ? (
          <p className="mt-5 text-body-lg text-muted-foreground">{s.body}</p>
        ) : null}
        {s.cta_label && s.cta_href ? (
          <a
            href={s.cta_href}
            className="mt-7 inline-flex items-center gap-2 text-caption text-foreground"
          >
            <span className="border-b border-accent/50 pb-1 transition-colors hover:border-accent">
              {s.cta_label}
            </span>
            <span aria-hidden>→</span>
          </a>
        ) : null}
      </div>
    </Section>
  );
}

/* ── press bar (As seen in) ──────────────────────────────────── */

function PressBar({ s }: { s: PageSection }) {
  const names = s.items?.length
    ? s.items.map((i) => i.label ?? "")
    : (s.text ?? "").split("·").map((t) => t.trim());
  if (!names.length) return null;
  return (
    <Section className="py-14">
      {s.eyebrow ? (
        <p className="text-center text-caption text-muted-foreground">
          {s.eyebrow}
        </p>
      ) : null}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
        {names.map((n, i) => (
          <span
            key={i}
            className="font-display text-xl tracking-[0.2em] text-muted-foreground/70"
          >
            {n}
          </span>
        ))}
      </div>
    </Section>
  );
}

/* ── testimonials ────────────────────────────────────────────── */

function Testimonials({ s }: { s: PageSection }) {
  const items = s.items ?? [];
  return (
    <Section className="py-16 md:py-24">
      <SectionHead s={s} />
      <div className="mt-12 grid gap-8 md:grid-cols-3">
        {items.map((it, i) => (
          <figure key={i} className="border-t border-accent/30 pt-6">
            <div aria-hidden className="font-couture text-5xl leading-none text-accent">
              &ldquo;
            </div>
            <blockquote className="mt-3 font-display text-h5 leading-snug text-foreground">
              {it.body}
            </blockquote>
            <figcaption className="mt-5 text-caption text-muted-foreground">
              {it.author}
              {it.meta ? <span className="block normal-case tracking-normal text-body-sm opacity-70">{it.meta}</span> : null}
            </figcaption>
          </figure>
        ))}
      </div>
    </Section>
  );
}

/* ── instagram grid ──────────────────────────────────────────── */

function InstagramGrid({ s }: { s: PageSection }) {
  const items = s.items ?? [];
  return (
    <Section className="py-16 md:py-24">
      <div className="flex items-end justify-between gap-6">
        <div>
          <Eyebrow>{s.eyebrow}</Eyebrow>
          <h2 className="mt-3 text-h3">
            <HeadingLine s={s} />
          </h2>
        </div>
        {s.link_href ? (
          <a
            href={s.link_href}
            className="shrink-0 text-body-sm text-muted-foreground hover:text-foreground"
          >
            {s.link_label ?? "Follow →"}
          </a>
        ) : null}
      </div>
      <div className="mt-10 grid grid-cols-3 gap-2 md:grid-cols-6">
        {items.map((it, i) => (
          <a
            key={i}
            href={it.href ?? s.link_href ?? "#"}
            className="group relative aspect-square overflow-hidden rounded-sm bg-secondary"
          >
            {it.image_url ? (
              <img
                src={it.image_url}
                alt=""
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                loading="lazy"
              />
            ) : (
              <span
                aria-hidden
                className="flex h-full items-center justify-center text-caption text-muted-foreground/50"
              >
                ✦
              </span>
            )}
          </a>
        ))}
      </div>
    </Section>
  );
}

/* ── founder note ────────────────────────────────────────────── */

function FounderNote({ s }: { s: PageSection }) {
  return (
    <Section className="py-20 md:py-28">
      <div className="mx-auto max-w-3xl text-center">
        <Eyebrow>{s.eyebrow}</Eyebrow>
        {s.body ? (
          <p className="mt-6 font-display text-h4 leading-relaxed text-foreground">
            {s.body}
          </p>
        ) : null}
        {s.link_label ? (
          <p className="mt-8 text-caption text-accent">{s.link_label}</p>
        ) : null}
      </div>
    </Section>
  );
}

/* ── thin promo banner ───────────────────────────────────────── */

function Banner({ s }: { s: PageSection }) {
  if (!s.text) return null;
  return (
    <div className="bg-primary py-2 text-center text-caption text-primary-foreground">
      {s.text}
    </div>
  );
}

/* ── shared section header (heading + optional view-all) ──────── */

function SectionHead({ s }: { s: PageSection }) {
  if (!s.eyebrow && !s.heading && !s.accent) return null;
  return (
    <div className="flex items-end justify-between gap-6">
      <div>
        <Eyebrow>{s.eyebrow}</Eyebrow>
        <h2 className="mt-3 text-h3">
          <HeadingLine s={s} />
        </h2>
      </div>
      {s.link_href ? (
        <a
          href={s.link_href}
          className="shrink-0 text-body-sm text-muted-foreground hover:text-foreground"
        >
          {s.link_label ?? "View all →"}
        </a>
      ) : null}
    </div>
  );
}

/* ── renderer ────────────────────────────────────────────────── */

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
          case "marquee":
            return <Marquee key={i} s={s} />;
          case "category_grid":
            return <CategoryGrid key={i} s={s} />;
          case "shade_grid":
            return <ShadeGrid key={i} s={s} />;
          case "product_carousel":
            return (
              <ProductCarousel key={i} s={s} products={products} currency={currency} />
            );
          case "product_grid":
            return (
              <ProductGrid key={i} s={s} products={products} currency={currency} />
            );
          case "feature_list":
            return <FeatureList key={i} s={s} />;
          case "editorial":
            return <Editorial key={i} s={s} />;
          case "press_bar":
            return <PressBar key={i} s={s} />;
          case "testimonials":
            return <Testimonials key={i} s={s} />;
          case "instagram_grid":
            return <InstagramGrid key={i} s={s} />;
          case "founder_note":
            return <FounderNote key={i} s={s} />;
          case "banner":
            return <Banner key={i} s={s} />;
          default:
            return null;
        }
      })}
    </main>
  );
}

/* ── baked default home (the maison design, Studio-shaped) ────────
 * Rendered when Studio has not published a `home` page yet. It is the exact
 * same section contract Studio emits, so the reference design is preserved and
 * fully editable later — nothing is hard-coded outside this typed structure.
 * Faitlyn copy verbatim from the reference; Pixie Girl gets a light variant. */

export function defaultHomePage(brandName: string): StudioPage {
  const isFaitlyn = /faitlyn/i.test(brandName);
  return {
    page_key: "home",
    template_key: "maison_home_v1",
    url_path: "/",
    slots: {
      sections: [
        {
          type: "hero",
          eyebrow: isFaitlyn
            ? "The Autumn Edit · 2026 · nouveauté"
            : "The Signature Edit · 2026",
          heading: "Hair, ",
          accent: "sculptée",
          heading_suffix: " like couture.",
          body: isFaitlyn
            ? "A Lagos studio crafting the world's most coveted pixies, bobs and curls. Hand-finished. Lace-perfect. Fait avec amour — worn by the women who set the standard."
            : `${brandName} — hand-finished, shade-matched luxury wigs, shipped worldwide to the women who set the standard.`,
          cta_label: "Shop the Catalogue",
          cta_href: "/shop",
          cta2_label: "Our Story",
          cta2_href: "/about",
        },
        {
          type: "marquee",
          items: [
            { label: "Hand-finished in Lagos" },
            { label: "Single-donor virgin hair" },
            { label: "HD melt lace" },
            { label: "Complimentary worldwide shipping" },
            { label: "1-year atelier guarantee" },
            { label: "Reusable for 18 months+" },
          ],
        },
        {
          type: "category_grid",
          eyebrow: "Shop the edit",
          heading: "Four silhouettes. ",
          accent: "Infinite",
          heading_suffix: " ways to wear them.",
          link_label: "View all →",
          link_href: "/shop",
          items: [
            { label: "Pixies", href: "/shop/pixies" },
            { label: "Bobs", href: "/shop/bobs" },
            { label: "Bone Straight", href: "/shop/straight" },
            { label: "Curls", href: "/shop/curls" },
          ],
        },
        {
          type: "shade_grid",
          eyebrow: "Shop by shade",
          heading: "Find the tone that ",
          accent: "speaks",
          heading_suffix: " to you",
          body: "Explore our shade catalogue. Every tone is hand-mixed in the studio and colour-matched to your skin.",
          items: [
            { label: "Blacky by Nature", href: "/shop?shade=blacky-by-nature", swatch: "#1a1512" },
            { label: "Brown Jolie", href: "/shop?shade=brown-jolie", swatch: "#6b4a32" },
            { label: "Plum Cherry", href: "/shop?shade=plum-cherry", swatch: "#5a2333" },
            { label: "Blonde Mary", href: "/shop?shade=blonde-mary", swatch: "#c9a56b" },
            { label: "Khaleesi Blonde", href: "/shop?shade=khaleesi-blonde", swatch: "#e6d3a8" },
            { label: "Icy Grey", href: "/shop?shade=icy-grey", swatch: "#b9bcc0" },
          ],
        },
        {
          type: "product_carousel",
          eyebrow: "Signature collection",
          heading: "The house ",
          accent: "edit",
          link_label: "View all →",
          link_href: "/shop",
        },
        {
          type: "feature_list",
          eyebrow: "Why choose",
          heading: isFaitlyn ? "Faitlyn " : `${brandName} `,
          accent: isFaitlyn ? "Hair" : "",
          body: "Each wig is handcrafted by artisans in our Lagos studio — made with precision, passion, and with women of colour in mind. Fait à la main.",
          items: [
            {
              badge: "01",
              label: "100% Human Hair",
              body: "Single-donor, cuticle-aligned, ethically sourced. Never blended, never synthetic.",
            },
            {
              badge: "02",
              label: "Expertly Ventilated & Styled",
              body: "Each cap is hand-ventilated and finished by master stylists before it leaves the studio.",
            },
            {
              badge: "03",
              label: "Made For Every Woman",
              body: "Designed with women of colour in mind — every silhouette, every skin tone, every crown.",
            },
            {
              badge: "04",
              label: "B2B & B2C, Globally",
              body: "Stylists, salons, and individual clients in 30+ countries. Trade pricing on request.",
            },
            {
              badge: "05",
              label: "Worldwide Fast Shipping",
              body: "Express dispatch from Lagos within 48 hours. Complimentary over $2000 (or $1000 in Nigeria).",
            },
          ],
        },
        {
          type: "editorial",
          eyebrow: "The Atelier",
          heading: "Every piece passes through ",
          accent: "eleven pairs",
          heading_suffix: " of hands before it reaches yours.",
          body: "From the sourcing of single-donor cuticle-aligned hair, to the hand-tying of every HD lace knot, to the final steam-set on the head of a Lagos master stylist — we refuse a single shortcut. The result is hair that wears like the dress code of the women who set the standard.",
          cta_label: "Read the story",
          cta_href: "/about",
        },
        {
          type: "press_bar",
          eyebrow: "As seen in",
          items: [
            { label: "VOGUE" },
            { label: "ELLE" },
            { label: "HARPER'S BAZAAR" },
            { label: "ESSENCE" },
            { label: "BAZAAR ARABIA" },
            { label: "GQ" },
          ],
        },
        {
          type: "testimonials",
          eyebrow: "From the women who wear it",
          heading: "Worn by the ones who ",
          accent: "set the standard",
          items: [
            {
              body: "I've worn every house. Faitlyn is the only one that makes me feel like I'm not wearing anything at all.",
              author: "Adaeze O.",
              meta: "Lagos · Stylist",
            },
            {
              body: "The lace melts. The cut frames. I get stopped in every room I walk into.",
              author: "Imani T.",
              meta: "New York · Editor",
            },
            {
              body: "Three units in. Each one outlasts the last. This is what luxury hair should have always been.",
              author: "Sophie L.",
              meta: "London · Founder",
            },
          ],
        },
        {
          type: "instagram_grid",
          eyebrow: isFaitlyn ? "@faitlynhair" : `@${brandName.replace(/\s+/g, "").toLowerCase()}`,
          heading: "Tagged on ",
          accent: "Instagram",
          link_label: "Follow →",
          link_href: isFaitlyn
            ? "https://www.instagram.com/faitlynhair/"
            : "#",
          items: Array.from({ length: 6 }, () => ({})),
        },
        {
          type: "founder_note",
          eyebrow: `A note from ${isFaitlyn ? "Faitlyn" : brandName}`,
          body: "I started this house because the hair I wanted didn't exist. So I built it — slowly, by hand, with women who care about the craft as much as I do. Everything you see here is the version of luxury I always wished I could buy.",
          link_label: isFaitlyn ? "— Faitlyn, Founder" : "— Founder",
        },
      ],
    },
  };
}
