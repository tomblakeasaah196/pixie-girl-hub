/**
 * LandingRender — the storefront render of a sales-campaign landing page.
 *
 * One renderer, two homes:
 *   1. the full-screen Studio preview (live, from in-progress edits)
 *   2. the public /sale/:slug page (from the public landing payload)
 *
 * When brandConfig is provided, the renderer paints in the brand's Atelier
 * palette (light background, brand fonts/colors) so the preview matches the
 * live page's BrandThemeProvider treatment. Without it, the original
 * Maroon-Noir dark render is used as a fallback.
 */

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import type { LandingBlock, PublicState } from "@/lib/campaigns";
import type { LandingConfig } from "@landing-kit";
import { hexToTriplet, fontStack } from "@landing-kit";
import {
  formatPrice,
  isUsdEnabled,
  useCurrencyStore,
  useGeoCurrencyInit,
} from "@/lib/currency";
import { CurrencyFloater } from "@/components/campaign/CurrencyFloater";

export interface LandingProduct {
  product_id?: string | null;
  styled_id?: string | null;
  category_id?: string | null;
  name?: string | null;
  short_description?: string | null;
  long_description?: string | null;
  campaign_price_ngn?: number | string | null;
  campaign_price_usd?: number | string | null;
  regular_price_ngn?: number | string | null;
  regular_price_usd?: number | string | null;
  is_featured?: boolean;
  stock_remaining?: number | null;
  // The public payload sends `image_url`; `hero_image_url` is kept as a legacy
  // fallback so older saved models still render their picture.
  image_url?: string | null;
  hero_image_url?: string | null;
}

export interface LandingModel {
  slug: string;
  name: string;
  state: PublicState;
  hero: {
    title?: string | null;
    subtitle?: string | null;
    image_url?: string | null;
    cta_text?: string | null;
  };
  countdown_to?: string | null;
  countdown_message?: string | null;
  signup_for_notifications?: boolean;
  /** Static NGN-per-USD rate for the customer-facing currency toggle. NULL =
   *  NGN-only, toggle hidden. Customer display only — order settlement uses
   *  the LIVE FX rate captured at payment. */
  ngn_per_usd_rate?: number | null;
  blocks: LandingBlock[];
  products?: LandingProduct[];
  ended?: { message?: string | null; redirect_to?: string | null } | null;
  gallery?: string[];
}

/** Hook returning a `priceLabel(ngnValue)` formatter bound to the visitor's
 *  active currency (toggle store) and the campaign's static FX rate. USD
 *  prices are ceiling-rounded to whole dollars per owner directive (10.29 → 11).
 *  When the campaign has no rate set the toggle is hidden and labels stay NGN. */
function usePriceLabel(fxRate: number | null) {
  const currency = useCurrencyStore((s) => s.currency);
  return useMemo(() => {
    return (v: number | string | null | undefined): string => {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n) || n <= 0) return "—";
      const formatted = formatPrice(n, currency, fxRate);
      return formatted ?? "—";
    };
  }, [currency, fxRate]);
}

/** A deterministic tasteful gradient when an image is missing — never a grey box. */
export function placeholderBg(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return `linear-gradient(150deg, rgb(var(--accent-deep)/0.55), rgb(var(--panel)/0.92)), conic-gradient(from ${h}deg at 70% 20%, rgb(var(--accent)/0.35), transparent 40%)`;
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
              <div className="text-[11px] tracking-[0.3em] uppercase text-accent-glow/90 font-semibold mb-3">
                {eyebrow}
              </div>
            )}
            {title && (
              <h2 className="font-display text-[28px] md:text-[42px] leading-[1.05]">
                {title}
              </h2>
            )}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

export function LandingRender({
  model,
  className,
  scrollable = true,
  brandConfig,
}: {
  model: LandingModel;
  className?: string;
  scrollable?: boolean;
  brandConfig?: LandingConfig | null;
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

  // Customer-facing currency toggle. Geo init runs once: NG → NGN, anywhere
  // else (with the campaign's FX rate set) → USD. The visitor can override
  // with the floating ₦/$ pill, which then persists in localStorage.
  const fxRate = model.ngn_per_usd_rate ?? null;
  useGeoCurrencyInit(isUsdEnabled(fxRate));
  const priceLabel = usePriceLabel(fxRate);

  const atelierVars = useMemo(() => {
    if (!brandConfig) return undefined;
    const t = brandConfig.theme;
    const typ = brandConfig.typography;
    return {
      "--bg": hexToTriplet(t.paper),
      "--panel": hexToTriplet(t.primaryDeep),
      "--panel-2": hexToTriplet(t.primary),
      "--text-primary": hexToTriplet(t.ink),
      "--text-muted": hexToTriplet(t.muted),
      "--text-faint": hexToTriplet(t.muted),
      "--line": `${hexToTriplet(t.primary)} / 0.12`,
      "--accent": hexToTriplet(t.primary),
      "--accent-deep": hexToTriplet(t.primaryDeep),
      "--accent-glow": hexToTriplet(t.glow),
      "--font-display": fontStack(typ?.display, "serif"),
      "--font-body": fontStack(typ?.body, "sans"),
      background: `rgb(${hexToTriplet(t.paper)})`,
      color: `rgb(${hexToTriplet(t.ink)})`,
      fontFamily: fontStack(typ?.body, "sans"),
    } as React.CSSProperties;
  }, [brandConfig]);

  return (
    <div
      className={cn(
        !brandConfig && "bg-bg text-text-primary",
        "antialiased",
        scrollable && "h-full overflow-y-auto",
        className,
      )}
      style={{ scrollBehavior: "smooth", ...atelierVars }}
    >
      {/* Announcement bar */}
      <div className="bg-accent-deep text-[#F4E9D9] text-center text-[11.5px] tracking-[0.2em] uppercase py-2.5 font-semibold">
        {model.state === "live"
          ? "The sale is live — complimentary delivery on orders over ₦150,000"
          : model.state === "ended"
            ? "This drop has closed — join the list for the next one"
            : "Doors open soon — secure your early access"}
      </div>

      {/* ── HERO ───────────────────────────────────────────── */}
      <header className="relative min-h-[78vh] md:min-h-[88vh] flex items-end overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: model.hero.image_url
              ? `linear-gradient(180deg, rgb(0 0 0/0.15) 0%, rgb(0 0 0/0.35) 45%, rgb(var(--bg)/0.96) 100%), url("${model.hero.image_url}")`
              : placeholderBg(model.slug || model.name || "hero"),
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div className="relative w-full px-6 md:px-12 pb-14 md:pb-20">
          <div className="max-w-[1140px] mx-auto">
            <div className="max-w-[680px]">
              <div className="inline-flex items-center gap-2 text-[11px] tracking-[0.32em] uppercase text-[#F4E9D9]/90 mb-5 px-3 py-1.5 rounded-full border border-[#F4E9D9]/25 backdrop-blur-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-glow animate-pulse" />
                {model.name}
              </div>
              <h1 className="font-display text-[clamp(40px,7vw,84px)] leading-[0.98] text-white drop-shadow-[0_2px_30px_rgb(0_0_0/0.5)]">
                {model.hero.title || model.name}
              </h1>
              {model.hero.subtitle && (
                <p className="mt-5 text-[15px] md:text-[18px] text-white/85 max-w-[560px] leading-relaxed">
                  {model.hero.subtitle}
                </p>
              )}

              {/* Countdown */}
              {cd && model.state !== "ended" && (
                <div className="mt-8 flex items-center gap-3 md:gap-4">
                  {[
                    { v: cd.days, l: "Days" },
                    { v: cd.hours, l: "Hrs" },
                    { v: cd.mins, l: "Min" },
                    { v: cd.secs, l: "Sec" },
                  ].map((u) => (
                    <div
                      key={u.l}
                      className="min-w-[58px] md:min-w-[72px] rounded-[14px] bg-black/35 backdrop-blur-md border border-white/15 px-3 py-2.5 text-center"
                    >
                      <div className="font-mono text-[24px] md:text-[32px] tabular-nums text-white leading-none">
                        {String(u.v).padStart(2, "0")}
                      </div>
                      <div className="text-[9px] tracking-[0.22em] uppercase text-white/55 mt-1.5">
                        {u.l}
                      </div>
                    </div>
                  ))}
                  {model.countdown_message && (
                    <span className="hidden md:block text-white/70 text-[13px] ml-2">
                      {model.countdown_message}
                    </span>
                  )}
                </div>
              )}

              <div className="mt-9 flex flex-wrap items-center gap-3">
                <button className="h-[52px] px-8 rounded-full bg-accent text-[#F4E9D9] font-semibold text-[15px] tracking-wide hover:brightness-110 transition shadow-[0_12px_40px_rgb(var(--accent)/0.45)]">
                  {model.state === "ended"
                    ? "Join the list"
                    : model.state === "before"
                      ? "Notify me"
                      : model.hero.cta_text || "Shop the drop"}
                </button>
                <button className="h-[52px] px-7 rounded-full border border-white/25 text-white font-semibold text-[14px] hover:bg-white/10 transition backdrop-blur-sm">
                  Explore the look book
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ── ENDED state takes over the body ─────────────────── */}
      {model.state === "ended" ? (
        <Section className="text-center">
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
              className="h-[50px] inline-flex items-center px-8 rounded-full bg-accent text-[#F4E9D9] font-semibold"
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
              priceLabel={priceLabel}
            />
          ))}
          {enabled.length === 0 && <DefaultBody model={model} />}
        </>
      )}

      {/* Footer */}
      <footer className="border-t border-line/60 px-6 md:px-12 py-12 mt-6">
        <div className="max-w-[1140px] mx-auto flex flex-col md:flex-row gap-6 md:items-center justify-between">
          <div className="font-display text-[22px]">{model.name}</div>
          <div className="flex gap-6 text-[12.5px] text-text-muted">
            <span>Instagram</span>
            <span>WhatsApp</span>
            <span>Shipping & returns</span>
            <span>Contact</span>
          </div>
          <div className="text-[11px] text-text-faint">/sale/{model.slug}</div>
        </div>
      </footer>

      {/* Brand-tinted floating currency toggle — hidden when the campaign
          has no static FX rate set. Swaps every amount on the page; falls
          back to NGN automatically when the rate is removed. */}
      <CurrencyFloater fxRate={fxRate} />
    </div>
  );
}

/** Render one builder block as a beautiful editorial section. */
function BlockSection({
  block,
  model,
  featured,
  priceLabel,
}: {
  block: LandingBlock;
  model: LandingModel;
  featured: LandingProduct[];
  priceLabel: (v: number | string | null | undefined) => string;
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
                    <span className="font-mono text-[20px] text-accent-glow">
                      {priceLabel(180000 - n * 20000)}
                    </span>
                    <span className="text-text-faint text-[13px] line-through">
                      {priceLabel(240000 - n * 20000)}
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
                className="rounded-[18px] border border-accent/30 bg-accent/[0.06] p-6 text-center"
              >
                <div className="font-display text-[40px] leading-none">
                  {t.q}+
                </div>
                <div className="text-text-muted text-[13px] mt-2">
                  bundles in one order
                </div>
                <div className="mt-4 font-mono text-accent-glow text-[18px]">
                  save {priceLabel(t.s)}
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
              const img = prod.image_url || prod.hero_image_url;
              // Real price: the campaign override if set, else the snapshotted
              // regular price. No more fabricated "95000 + n*10000" placeholder.
              // Price is always NGN base — the toggle/floater converts on
              // display via the campaign's static FX rate (USD ceiling-rounded
              // to whole dollars per owner directive).
              const priceNgn =
                prod.campaign_price_ngn ?? prod.regular_price_ngn ?? null;
              const hasPrice =
                priceNgn != null && Number.isFinite(Number(priceNgn));
              return (
                <article key={n} className="group">
                  <div
                    className="aspect-[3/4] rounded-[16px] overflow-hidden mb-3"
                    style={{
                      backgroundImage: img ? `url("${img}")` : undefined,
                      background: img
                        ? undefined
                        : placeholderBg(`prod-${model.slug}-${n}`),
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  />
                  <div className="font-medium text-[13.5px] truncate">
                    {prod.name || "Styled piece"}
                  </div>
                  {prod.short_description && (
                    <div className="text-[11.5px] opacity-70 line-clamp-2 mt-0.5">
                      {prod.short_description}
                    </div>
                  )}
                  {hasPrice && (
                    <div className="font-mono text-accent-glow text-[13px] mt-1">
                      {priceLabel(priceNgn)}
                    </div>
                  )}
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
              <div className="text-[11px] tracking-[0.3em] uppercase text-accent-glow/90 font-semibold mb-3">
                {meta?.eyebrow}
              </div>
              <h2 className="font-display text-[30px] md:text-[40px] leading-[1.05]">
                {meta?.title}
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
          <div className="mt-6 text-[12px] tracking-[0.25em] uppercase text-text-muted">
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
              <div key={t} className="rounded-[18px] border border-line/70 p-6">
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
                <div className="text-accent-glow text-[15px] mb-3">★★★★★</div>
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
                  <span className="text-accent-glow text-[20px] transition-transform group-open:rotate-45">
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
          <div className="max-w-[620px] mx-auto rounded-[24px] border border-accent/30 bg-accent/[0.05] p-8 md:p-12">
            <div className="text-[11px] tracking-[0.3em] uppercase text-accent-glow/90 font-semibold mb-3">
              {meta?.eyebrow}
            </div>
            <h2 className="font-display text-[28px] md:text-[36px]">
              {meta?.title}
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
                className="flex-1 h-[52px] px-5 rounded-full bg-bg/60 border border-line outline-none focus:border-accent/60 text-[14px]"
              />
              <button className="h-[52px] px-7 rounded-full bg-accent text-[#F4E9D9] font-semibold whitespace-nowrap">
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
