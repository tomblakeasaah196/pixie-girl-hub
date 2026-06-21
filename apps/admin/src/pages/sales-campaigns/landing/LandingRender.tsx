/**
 * LandingRender — the storefront render of a sales-campaign landing page.
 *
 * One renderer, two homes:
 *   1. the full-screen Studio preview (live, from in-progress edits)
 *   2. the public /sale/:slug page (from the public landing payload)
 *
 * It is intentionally self-contained and token-driven (Maroon Noir + a per-brand
 * champagne accent) so it reads as a real luxury storefront — and so the admin
 * preview matches the production landing app (apps/landing) one-to-one: the same
 * cinematic hero, the same always-on countdown to the hour, the same editorial
 * champagne language. Blocks render in the order the builder set; unknown/empty
 * blocks degrade to an elegant editorial section rather than a broken placeholder.
 */

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import type { LandingBlock, PublicState } from "@/lib/campaigns";

export interface LandingProduct {
  product_id?: string | null;
  category_id?: string | null;
  name?: string | null;
  campaign_price_ngn?: number | string | null;
  is_featured?: boolean;
  stock_remaining?: number | null;
  hero_image_url?: string | null;
}

export interface LandingModel {
  slug: string;
  name: string;
  state: PublicState;
  /** Brand key — drives the champagne tint + wordmark. Optional; defaults to PXG. */
  brand?: string | null;
  hero: {
    title?: string | null;
    subtitle?: string | null;
    image_url?: string | null;
    cta_text?: string | null;
  };
  countdown_to?: string | null;
  countdown_message?: string | null;
  signup_for_notifications?: boolean;
  blocks: LandingBlock[];
  products?: LandingProduct[];
  ended?: { message?: string | null; redirect_to?: string | null } | null;
  gallery?: string[];
}

/** Champagne accent per brand — mirrors apps/landing globals (--gold). */
const GOLD_BY_BRAND: Record<string, string> = {
  pixiegirl: "212 175 122", // #D4AF7A champagne
  faitlynhair: "217 191 168", // #D9BFA8 warm taupe
};
const BRAND_LABEL: Record<string, string> = {
  pixiegirl: "Pixie Girl Global",
  faitlynhair: "Faitlyn Hair",
};

const NGN = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});
function ngn(v: number | string | null | undefined): string {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? NGN.format(n) : "₦—";
}

/** A deterministic tasteful gradient when an image is missing — never a grey box. */
export function placeholderBg(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return `linear-gradient(150deg, rgb(var(--accent-deep)/0.55), rgb(var(--panel)/0.92)), conic-gradient(from ${h}deg at 70% 20%, rgb(var(--gold)/0.35), transparent 40%)`;
}

/** Pull editable body copy from a block (stored under props.body). */
function blockBody(b: LandingBlock): string | undefined {
  const fromProps =
    b.props && typeof b.props.body === "string"
      ? (b.props.body as string)
      : undefined;
  const legacy = (b as { body?: unknown }).body;
  return fromProps ?? (typeof legacy === "string" ? legacy : undefined);
}

function useCountdown(target?: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [target]);
  if (!target) return null;
  const remaining = Math.max(0, new Date(target).getTime() - now);
  return {
    days: Math.floor(remaining / 86_400_000),
    hours: Math.floor((remaining % 86_400_000) / 3_600_000),
    mins: Math.floor((remaining % 3_600_000) / 60_000),
    secs: Math.floor((remaining % 60_000) / 1000),
    done: remaining === 0,
  };
}

const BLOCK_TITLE: Record<
  string,
  { eyebrow: string; title: string; body?: string }
> = {
  bundle_showcase: { eyebrow: "Curated sets", title: "The collections" },
  quantity_tier_visualiser: {
    eyebrow: "Buy more, save more",
    title: "The more you take home",
  },
  featured_products: { eyebrow: "Hand-picked", title: "Pieces we're loving" },
  lookbook_carousel: { eyebrow: "The look book", title: "Worn, not just sold" },
  stock_counter: { eyebrow: "Moving fast", title: "What's still in" },
  brand_story: { eyebrow: "The house", title: "Why this drop" },
  founder_quote: { eyebrow: "From the founder", title: "" },
  why_buy: { eyebrow: "The promise", title: "Why she keeps coming back" },
  testimonials: { eyebrow: "In her words", title: "Loved by thousands" },
  ugc_carousel: { eyebrow: "On the street", title: "Tagged #yourbrand" },
  faq: { eyebrow: "Good to know", title: "Questions, answered" },
  wig_care: { eyebrow: "Aftercare", title: "Make it last" },
  stylist_spotlight: { eyebrow: "Spotlight", title: "Styled by the best" },
  shipping_returns: { eyebrow: "Logistics", title: "Shipping & returns" },
  newsletter_capture: { eyebrow: "Stay close", title: "Be first, always" },
  vip_signup: { eyebrow: "The list", title: "Join the inner circle" },
};

/** Editorial heading — italicises the final word in champagne. */
function GoldHeadline({ title }: { title: string }) {
  const words = title.trim().split(/\s+/);
  if (words.length <= 1)
    return <em className="italic text-[rgb(var(--gold))]">{title}</em>;
  const last = words[words.length - 1];
  const head = words.slice(0, -1).join(" ");
  return (
    <>
      {head} <em className="italic text-[rgb(var(--gold))]">{last}</em>
    </>
  );
}

/** Section shell — consistent rhythm + editorial heading. */
function Section({
  eyebrow,
  title,
  children,
  className,
  bleed,
}: {
  eyebrow?: string;
  title?: string;
  children?: React.ReactNode;
  className?: string;
  bleed?: boolean;
}) {
  return (
    <section
      className={cn(
        "px-6 md:px-12",
        bleed ? "py-0" : "py-14 md:py-20",
        className,
      )}
    >
      <div className="max-w-[1140px] mx-auto">
        {(eyebrow || title) && (
          <div className="mb-8 md:mb-12 text-center">
            {eyebrow && (
              <div className="text-[10.5px] tracking-[0.34em] uppercase text-[rgb(var(--gold))] font-bold mb-3">
                {eyebrow}
              </div>
            )}
            {title && (
              <h2 className="font-display text-[28px] md:text-[42px] leading-[1.05]">
                <GoldHeadline title={title} />
              </h2>
            )}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

/** Countdown cells, glassy — the always-on hero timer (Before → start, Live → end). */
function CountdownCells({
  cd,
  label,
}: {
  cd: NonNullable<ReturnType<typeof useCountdown>>;
  label?: string | null;
}) {
  const units: [number, string][] = [
    [cd.days, "Days"],
    [cd.hours, "Hrs"],
    [cd.mins, "Min"],
    [cd.secs, "Sec"],
  ];
  return (
    <div className="mt-8">
      {label && (
        <div className="text-[10.5px] tracking-[0.34em] uppercase text-[rgb(var(--gold))] font-bold mb-3">
          {label}
        </div>
      )}
      <div className="flex gap-2.5 md:gap-3.5">
        {units.map(([value, unit]) => (
          <div
            key={unit}
            className="min-w-[60px] md:min-w-[78px] rounded-[16px] bg-black/35 backdrop-blur-md border border-white/15 px-3.5 md:px-5 py-3 md:py-4 text-center"
          >
            <div className="font-mono tabular-nums text-[28px] md:text-[44px] leading-none text-white">
              {String(value).padStart(2, "0")}
            </div>
            <div className="mt-1.5 text-[9px] tracking-[0.22em] uppercase text-white/55">
              {unit}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LandingRender({
  model,
  className,
  scrollable = true,
}: {
  model: LandingModel;
  className?: string;
  scrollable?: boolean;
}) {
  const cd = useCountdown(model.countdown_to);
  const enabled = useMemo(
    () =>
      (model.blocks || []).filter(
        (b) => b.enabled !== false && (b.key || b.type),
      ),
    [model.blocks],
  );
  const featured = (model.products || []).filter((p) => p.name);

  const brandKey = model.brand || "pixiegirl";
  const gold = GOLD_BY_BRAND[brandKey] || GOLD_BY_BRAND.pixiegirl;
  const brandLabel = BRAND_LABEL[brandKey] || "Pixie Girl Global";
  const monogram = brandLabel.trim().charAt(0).toUpperCase();

  const stateBadge =
    model.state === "live"
      ? "Live now"
      : model.state === "ended"
        ? "Sale ended"
        : "Coming soon";

  return (
    <div
      className={cn(
        "bg-bg text-text-primary antialiased",
        scrollable && "h-full overflow-y-auto",
        className,
      )}
      style={
        { "--gold": gold, scrollBehavior: "smooth" } as React.CSSProperties
      }
    >
      {/* ── HERO ─────────────────────────────────────────────── */}
      <header className="relative min-h-[86vh] flex flex-col overflow-hidden">
        {/* Full-bleed photograph (or a tasteful gradient). */}
        <div
          className="absolute inset-0 -z-20"
          style={
            model.hero.image_url
              ? {
                  backgroundImage: `url("${model.hero.image_url}")`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : { background: placeholderBg(model.slug || model.name || "hero") }
          }
        />
        {/* Layered veil melting into the page background. */}
        <div
          className="absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(120% 80% at 50% 0%, transparent 0%, rgb(var(--bg)/0.3) 58%, rgb(var(--bg)/0.72) 100%), linear-gradient(180deg, rgb(0 0 0/0.5) 0%, rgb(0 0 0/0.12) 32%, rgb(0 0 0/0.25) 62%, rgb(var(--bg)) 100%)",
          }}
        />
        {/* Ambient brand monogram. */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10 grid place-items-center overflow-hidden pointer-events-none"
        >
          <span
            className="font-display italic leading-[0.8] tracking-[-0.04em] select-none"
            style={{
              fontSize: "clamp(16rem, 38vw, 36rem)",
              color: "rgb(var(--text)/0.05)",
            }}
          >
            {monogram}
          </span>
        </div>

        {/* Top bar — wordmark + sales domain. */}
        <div className="relative z-10 w-full max-w-[1140px] mx-auto px-6 md:px-12 pt-6 md:pt-8 flex items-center justify-between gap-4">
          <span className="font-display text-[19px] md:text-[23px] leading-none text-white">
            {brandLabel}
          </span>
          <span className="hidden md:block text-[10px] tracking-[0.34em] uppercase text-white/45">
            /sale/{model.slug}
          </span>
        </div>

        {/* Hero copy — bottom-weighted. */}
        <div className="relative z-10 flex-1 flex items-end md:items-center">
          <div className="w-full px-6 md:px-12 py-[clamp(32px,7vh,80px)]">
            <div className="max-w-[1140px] mx-auto">
              <div className="max-w-[700px]">
                <div className="inline-flex items-center gap-2 mb-6 rounded-full border border-[rgb(var(--gold)/0.4)] bg-black/30 backdrop-blur-sm px-3.5 py-1.5">
                  {model.state === "live" ? (
                    <span className="relative w-1.5 h-1.5 rounded-full bg-success">
                      <span className="absolute inset-0 rounded-full bg-success animate-ping" />
                    </span>
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-[rgb(var(--gold))]" />
                  )}
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.3em] text-white">
                    {stateBadge}
                  </span>
                </div>

                <h1 className="font-display text-[clamp(42px,7.5vw,88px)] leading-[1.0] tracking-[-0.01em] text-white drop-shadow-[0_2px_30px_rgb(0_0_0/0.45)]">
                  <GoldHeadline title={model.hero.title || model.name} />
                </h1>

                {model.hero.subtitle && (
                  <p className="mt-5 max-w-[560px] text-[15px] md:text-[19px] text-white/85 leading-relaxed font-light">
                    {model.hero.subtitle}
                  </p>
                )}

                {/* Always-on countdown for Before / Live. */}
                {cd && model.state !== "ended" && (
                  <CountdownCells
                    cd={cd}
                    label={
                      model.countdown_message ||
                      (model.state === "before"
                        ? "Doors open in"
                        : "Sale ends in")
                    }
                  />
                )}

                <div className="mt-9 flex flex-wrap items-center gap-3">
                  <button className="h-[52px] px-7 rounded-full bg-accent-deep text-[#F4E9D9] font-semibold text-[15px] tracking-wide hover:brightness-110 transition shadow-[0_12px_40px_rgb(var(--accent-deep)/0.5)]">
                    {model.state === "ended"
                      ? "Shop our collection"
                      : model.state === "before"
                        ? model.hero.cta_text || "Notify me"
                        : model.hero.cta_text || "Shop the drop"}
                  </button>
                  <button className="inline-flex items-center gap-1.5 h-[52px] px-2 text-[13px] text-white/70 hover:text-white transition-colors">
                    <span className="border-b border-[rgb(var(--gold)/0.4)] pb-1">
                      Explore the drop
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ── ENDED state takes over the body ─────────────────── */}
      {model.state === "ended" ? (
        <Section className="text-center">
          <div
            className="h-px w-[120px] mx-auto mb-8"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgb(var(--gold)/0.45) 50%, transparent)",
            }}
          />
          <h2 className="font-display text-[32px] md:text-[48px] leading-tight max-w-[760px] mx-auto">
            {model.ended?.message ||
              "The drop has ended — but our shelves are full of beautiful things."}
          </h2>
          <p className="text-text-muted mt-5 max-w-[520px] mx-auto">
            Join the list and you'll be the first to know when the next one
            opens — plus first pick before it goes public.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <a
              href={model.ended?.redirect_to || "#"}
              className="h-[50px] inline-flex items-center px-8 rounded-full bg-accent-deep text-[#F4E9D9] font-semibold"
            >
              Shop our collection
            </a>
          </div>
        </Section>
      ) : (
        <>
          {/* Featured products fall through here if the block is present */}
          {enabled.map((b, i) => (
            <BlockSection
              key={(b.key || b.type || "blk") + i}
              block={b}
              model={model}
              featured={featured}
            />
          ))}
          {enabled.length === 0 && <DefaultBody model={model} />}
        </>
      )}

      {/* Footer */}
      <footer className="border-t border-[rgb(var(--gold)/0.16)] px-6 md:px-12 py-12 mt-6">
        <div className="max-w-[1140px] mx-auto flex flex-col md:flex-row gap-6 md:items-center justify-between">
          <div className="font-display text-[22px]">{brandLabel}</div>
          <div className="flex gap-6 text-[12.5px] text-text-muted">
            <span>Instagram</span>
            <span>WhatsApp</span>
            <span>Shipping &amp; returns</span>
            <span>Contact</span>
          </div>
          <div className="text-[11px] text-text-faint">/sale/{model.slug}</div>
        </div>
      </footer>
    </div>
  );
}

/** Render one builder block as a beautiful editorial section. */
function BlockSection({
  block,
  model,
  featured,
}: {
  block: LandingBlock;
  model: LandingModel;
  featured: LandingProduct[];
}) {
  const key = block.key || block.type || "";
  const meta = BLOCK_TITLE[key];

  switch (key) {
    case "hero":
    case "countdown":
      return null; // already rendered in the header

    case "bundle_showcase":
      return (
        <Section eyebrow={meta?.eyebrow} title={meta?.title}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[0, 1, 2].map((n) => (
              <article
                key={n}
                className="group rounded-[20px] overflow-hidden border border-line/70 bg-panel/40 hover:-translate-y-1 transition-transform"
              >
                <div
                  className="h-56"
                  style={{
                    background: placeholderBg(`bundle-${model.slug}-${n}`),
                  }}
                />
                <div className="p-5">
                  <div className="font-display text-[20px]">
                    The Signature Set {n + 1}
                  </div>
                  <p className="text-text-muted text-[13px] mt-1.5">
                    A fixed, curated composition — styled to wear together.
                  </p>
                  <div className="mt-4 flex items-baseline gap-2">
                    <span className="font-mono text-[20px] text-[rgb(var(--gold))]">
                      {ngn(180000 - n * 20000)}
                    </span>
                    <span className="text-text-faint text-[13px] line-through">
                      {ngn(240000 - n * 20000)}
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </Section>
      );

    case "quantity_tier_visualiser":
      return (
        <Section eyebrow={meta?.eyebrow} title={meta?.title}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { q: 2, s: 15000 },
              { q: 3, s: 30000 },
              { q: 4, s: 55000 },
            ].map((t) => (
              <div
                key={t.q}
                className="rounded-[18px] border border-[rgb(var(--gold)/0.3)] bg-[rgb(var(--gold)/0.06)] p-6 text-center"
              >
                <div className="font-display text-[40px] leading-none">
                  {t.q}+
                </div>
                <div className="text-text-muted text-[13px] mt-2">
                  bundles in one order
                </div>
                <div className="mt-4 font-mono text-[rgb(var(--gold))] text-[18px]">
                  save {ngn(t.s)}
                </div>
              </div>
            ))}
          </div>
        </Section>
      );

    case "featured_products":
      return (
        <Section eyebrow={meta?.eyebrow} title={meta?.title}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {(featured.length
              ? featured.slice(0, 8)
              : Array.from({ length: 4 })
            ).map((p, n) => {
              const prod = (p || {}) as LandingProduct;
              return (
                <article key={n} className="group">
                  <div
                    className="aspect-[3/4] rounded-[16px] overflow-hidden mb-3"
                    style={{
                      backgroundImage: prod.hero_image_url
                        ? `url("${prod.hero_image_url}")`
                        : undefined,
                      background: prod.hero_image_url
                        ? undefined
                        : placeholderBg(`prod-${model.slug}-${n}`),
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  />
                  <div className="font-medium text-[13.5px] truncate">
                    {prod.name || "Styled piece"}
                  </div>
                  <div className="font-mono text-[rgb(var(--gold))] text-[13px]">
                    {ngn(prod.campaign_price_ngn ?? 95000 + n * 10000)}
                  </div>
                </article>
              );
            })}
          </div>
        </Section>
      );

    case "lookbook_carousel":
    case "ugc_carousel":
      return (
        <Section eyebrow={meta?.eyebrow} title={meta?.title}>
          <div className="flex gap-4 overflow-x-auto pb-4 -mx-6 px-6 md:mx-0 md:px-0 snap-x">
            {(model.gallery?.length
              ? model.gallery
              : Array.from({ length: 6 })
            ).map((g, n) => (
              <div
                key={n}
                className="snap-start shrink-0 w-[230px] md:w-[280px] aspect-[3/4] rounded-[18px] overflow-hidden"
                style={{
                  backgroundImage:
                    typeof g === "string" ? `url("${g}")` : undefined,
                  background:
                    typeof g === "string"
                      ? undefined
                      : placeholderBg(`look-${model.slug}-${n}`),
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}
              />
            ))}
          </div>
        </Section>
      );

    case "brand_story":
      return (
        <Section>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
            <div
              className="aspect-[4/5] rounded-[22px]"
              style={{ background: placeholderBg(`story-${model.slug}`) }}
            />
            <div>
              <div className="text-[10.5px] tracking-[0.34em] uppercase text-[rgb(var(--gold))] font-bold mb-3">
                {meta?.eyebrow}
              </div>
              <h2 className="font-display text-[30px] md:text-[40px] leading-[1.05]">
                <GoldHeadline title={meta?.title || "Why this drop"} />
              </h2>
              <p className="text-text-muted mt-5 leading-relaxed">
                {blockBody(block) ||
                  "Every drop begins with a single idea: that a woman should never have to choose between quality and the price she pays for it. This collection is our answer — limited, intentional, and made to be worn."}
              </p>
            </div>
          </div>
        </Section>
      );

    case "founder_quote":
      return (
        <Section className="text-center">
          <blockquote className="font-display italic text-[26px] md:text-[40px] leading-[1.25] max-w-[860px] mx-auto">
            “
            {blockBody(block) ||
              "We don't do ordinary. We do the piece she remembers."}
            ”
          </blockquote>
          <div className="mt-6 text-[11px] tracking-[0.3em] uppercase text-[rgb(var(--gold))] font-bold">
            — The Founder
          </div>
        </Section>
      );

    case "why_buy":
      return (
        <Section eyebrow={meta?.eyebrow} title={meta?.title}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              [
                "Ethically sourced",
                "Full-density, raw hair — traceable to the bundle.",
              ],
              ["Made to last", "Wears, washes and styles like your own."],
              ["Loved by thousands", "A community of women who don't settle."],
            ].map(([t, d]) => (
              <div
                key={t}
                className="rounded-[18px] border border-line/70 p-6"
              >
                <div className="font-display text-[20px]">{t}</div>
                <p className="text-text-muted text-[13.5px] mt-2 leading-relaxed">
                  {d}
                </p>
              </div>
            ))}
          </div>
        </Section>
      );

    case "testimonials":
      return (
        <Section eyebrow={meta?.eyebrow} title={meta?.title}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[0, 1, 2].map((n) => (
              <figure
                key={n}
                className="rounded-[18px] bg-panel/40 border border-line/70 p-6"
              >
                <div className="text-[rgb(var(--gold))] text-[15px] mb-3">
                  ★★★★★
                </div>
                <blockquote className="text-[14px] leading-relaxed text-text-primary/90">
                  “Easily the best I've ordered. The quality speaks before I
                  do.”
                </blockquote>
                <figcaption className="mt-4 text-[12px] text-text-muted">
                  — Verified customer
                </figcaption>
              </figure>
            ))}
          </div>
        </Section>
      );

    case "faq":
      return (
        <Section eyebrow={meta?.eyebrow} title={meta?.title}>
          <div className="max-w-[760px] mx-auto divide-y divide-line/60">
            {[
              [
                "How long does delivery take?",
                "Lagos: 1–2 days. Nationwide: 2–4 days via DHL.",
              ],
              [
                "Can I return an item?",
                "Unworn pieces can be returned within 7 days of delivery.",
              ],
              [
                "Are prices in this drop final?",
                "Yes — these are limited-time prices, only while the drop is live.",
              ],
            ].map(([q, a]) => (
              <details key={q} className="group py-5">
                <summary className="flex items-center justify-between cursor-pointer list-none font-medium text-[15px]">
                  {q}
                  <span className="text-[rgb(var(--gold))] text-[20px] transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="text-text-muted text-[13.5px] mt-3 leading-relaxed">
                  {a}
                </p>
              </details>
            ))}
          </div>
        </Section>
      );

    case "newsletter_capture":
    case "vip_signup":
      return (
        <Section className="text-center">
          <div className="max-w-[620px] mx-auto rounded-[24px] border border-[rgb(var(--gold)/0.3)] bg-[rgb(var(--gold)/0.05)] p-8 md:p-12">
            <div className="text-[10.5px] tracking-[0.34em] uppercase text-[rgb(var(--gold))] font-bold mb-3">
              {meta?.eyebrow}
            </div>
            <h2 className="font-display text-[28px] md:text-[36px]">
              <GoldHeadline title={meta?.title || "Be first, always"} />
            </h2>
            <p className="text-text-muted mt-3 text-[14px]">
              First access to every drop, private prices and the occasional
              gift. No noise.
            </p>
            <form
              className="mt-6 flex flex-col sm:flex-row gap-3"
              onSubmit={(e) => e.preventDefault()}
            >
              <input
                placeholder="you@email.com"
                className="flex-1 h-[52px] px-5 rounded-full bg-bg/60 border border-line outline-none focus:border-[rgb(var(--gold)/0.6)] text-[14px]"
              />
              <button className="h-[52px] px-7 rounded-full bg-accent-deep text-[#F4E9D9] font-semibold whitespace-nowrap">
                Join the list
              </button>
            </form>
          </div>
        </Section>
      );

    case "shipping_returns":
    case "wig_care":
    case "stylist_spotlight":
    case "stock_counter":
    default:
      return (
        <Section
          eyebrow={meta?.eyebrow || "More"}
          title={meta?.title || prettyKey(key)}
        >
          <p className="text-text-muted text-center max-w-[640px] mx-auto leading-relaxed">
            {blockBody(block) ||
              "Beautifully presented details go here — this section is part of your landing and will fill in with real content as you build."}
          </p>
        </Section>
      );
  }
}

function DefaultBody({ model }: { model: LandingModel }) {
  return (
    <Section eyebrow="The collection" title="Curated for this drop">
      <p className="text-center text-text-muted max-w-[600px] mx-auto">
        Add blocks in the Studio — bundles, a look book, testimonials and more —
        and they'll appear here, exactly as your customers will see them on{" "}
        {model.slug}.
      </p>
    </Section>
  );
}

function prettyKey(k: string): string {
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
