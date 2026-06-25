"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, ShoppingBag, Store } from "lucide-react";
import type { LandingConfig, LandingPayload } from "@/lib/types";
import { hexToTriplet } from "@/lib/types";
import { deriveState } from "@/lib/state-engine";

interface Props {
  payload: LandingPayload;
  brandConfig: LandingConfig;
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function splitHeadline(title: string) {
  const words = title.trim().split(/\s+/);
  if (words.length <= 1) return { head: "", accent: title };
  return { head: words.slice(0, -1).join(" "), accent: words[words.length - 1] };
}

/**
 * Scroll the visitor into the shopping body. The old CTAs targeted `#bundles`
 * only — but the bundle section unmounts entirely when a campaign has no
 * bundles, so the anchor didn't exist and the buttons did nothing ("Browse the
 * collection" failed). Resolve to whichever shop section is actually on the
 * page, newest-buyer-first: bundles → styled products → wholesale → first
 * commerce section. Falls back to a one-viewport scroll so a click is never a
 * dead end.
 */
function scrollToShop() {
  if (typeof document === "undefined") return;
  const target =
    document.getElementById("bundles") ||
    document.getElementById("shop") ||
    document.querySelector('[data-block="featured_products"]') ||
    document.querySelector('[data-block="reseller_bulk"]') ||
    document.querySelector("[data-atelier-commerce]");
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    window.scrollTo({ top: window.innerHeight, behavior: "smooth" });
  }
}

/** Jump into the wholesale view: flip the products section into Wholesale mode
 *  (via the #wholesale hash its toggle listens for) and scroll to it. */
function goWholesale() {
  if (typeof window === "undefined") return;
  window.location.hash = "wholesale";
  const el =
    document.getElementById("shop") ||
    document.querySelector('[data-block="featured_products"]') ||
    document.querySelector('[data-block="reseller_bulk"]');
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Live-updating diff to ends_at, recomputed every second. */
function useEndCountdown(endsAtMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = Math.max(0, endsAtMs - now);
  const s = Math.floor(diff / 1000);
  return {
    diff,
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    mins: Math.floor((s % 3600) / 60),
    secs: s % 60,
  };
}

export function LiveHero({ payload, brandConfig }: Props) {
  const { derived, msToEnd } = useMemo(() => deriveState(payload), [payload]);
  const isLastCall = derived === "live_last_call";
  const isSoldOut = derived === "live_sold_out_hold";
  const hasWholesale =
    Array.isArray(payload.bulk_tiers) &&
    payload.bulk_tiers.some(
      (t) => t.min_qty > 0 && t.discount_per_item_ngn > 0,
    );

  const startsMs = useMemo(
    () => new Date(payload.starts_at).getTime(),
    [payload.starts_at],
  );
  const endsMs = useMemo(
    () => new Date(payload.ends_at).getTime(),
    [payload.ends_at],
  );
  const { diff, days, hours, mins, secs } = useEndCountdown(endsMs);

  // When the clock hits zero, route through the state router so the visitor
  // lands on /ended without needing to refresh manually.
  useEffect(() => {
    if (diff > 0) return;
    const t = setTimeout(() => {
      window.location.assign(`/sale/${payload.slug}`);
    }, 1200);
    return () => clearTimeout(t);
  }, [diff, payload.slug]);

  const surge = isLastCall || msToEnd < 60 * 60_000;

  const brandVars = useMemo(
    () =>
      ({
        "--brand-ink": hexToTriplet(brandConfig.theme.ink),
        "--brand-paper": hexToTriplet(brandConfig.theme.paper),
        "--brand-primary": hexToTriplet(brandConfig.theme.primary),
        "--brand-primary-deep": hexToTriplet(brandConfig.theme.primaryDeep),
        "--brand-accent": hexToTriplet(brandConfig.theme.accent),
        "--brand-muted": hexToTriplet(brandConfig.theme.muted),
        "--brand-glow": hexToTriplet(brandConfig.theme.glow),
        // Urgency red — universal "closing" signal, intensified in last call.
        "--urgent": surge ? "239 68 68" : "229 84 78",
      }) as React.CSSProperties,
    [brandConfig.theme, surge],
  );

  const headlineSrc = payload.hero.title || brandConfig.hero.headline;
  const { head, accent } = payload.hero.title
    ? splitHeadline(payload.hero.title)
    : { head: brandConfig.hero.headline, accent: brandConfig.hero.headlineAccent || "Step inside." };
  const subtitle =
    payload.hero.subtitle ||
    "The doors are open. The list is in. When the clock runs out, we close.";

  const monogram = brandConfig.brandName.charAt(0).toUpperCase();
  const elapsedPct =
    endsMs > startsMs
      ? Math.min(100, Math.max(0, ((Date.now() - startsMs) / (endsMs - startsMs)) * 100))
      : 0;

  const endLabel = useMemo(() => {
    const d = new Date(endsMs);
    const day = d.toLocaleDateString("en-US", { weekday: "long" });
    const time = d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    return `Closes ${day} · ${time}`;
  }, [endsMs]);

  const primaryLabel = isSoldOut
    ? "Preorder now"
    : payload.hero.cta_text || "Shop the drop";

  const pill = isSoldOut
    ? { text: "SOLD OUT — PREORDER OPEN", urgent: true }
    : isLastCall
      ? { text: "FINAL HOUR", urgent: true }
      : { text: "LIVE NOW", urgent: false };

  const announce =
    days > 0
      ? `${days} days ${hours} hours ${mins} minutes remaining`
      : `${hours} hours ${mins} minutes ${secs} seconds remaining`;

  return (
    <section
      style={{
        ...brandVars,
        background:
          "radial-gradient(ellipse at 50% 80%, rgb(var(--brand-primary-deep)) 0%, rgb(var(--brand-ink)) 48%, #050302 100%)",
      }}
      className="relative isolate flex min-h-[100svh] w-full flex-col overflow-hidden text-[rgb(var(--brand-paper))]"
      data-derived={derived}
    >
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {payload.name} is live — {announce}
      </span>

      {/* Hero backdrop image + monogram */}
      {payload.hero.image_url && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            backgroundImage: `linear-gradient(180deg, rgb(0 0 0 / 0.45) 0%, rgb(var(--brand-ink) / 0.92) 92%), url(${payload.hero.image_url})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
      )}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        style={{
          fontFamily:
            "var(--font-atelier-display, 'Fraunces', 'Playfair Display', serif)",
          fontStyle: "italic",
          fontWeight: 500,
          fontSize: "min(110vh, 130vw)",
          color: brandConfig.theme.glow,
          opacity: 0.05,
          lineHeight: 1,
          letterSpacing: "-0.08em",
        }}
      >
        {monogram}
      </div>

      {/* Top bar */}
      <header className="relative z-20 flex items-center justify-between gap-4 px-5 py-5 sm:px-8 sm:py-6 md:px-12">
        <a
          href={brandConfig.storefront}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3 min-w-0"
        >
          {brandConfig.logo.url ? (
            <img
              src={brandConfig.logo.url}
              alt={brandConfig.brandName}
              className="h-7 md:h-8 object-contain"
            />
          ) : (
            <span
              className="text-[11px] tracking-[0.35em] sm:text-sm sm:tracking-[0.4em]"
              style={{
                fontFamily: "var(--font-atelier-display, 'Fraunces', serif)",
              }}
            >
              {brandConfig.brandName.toUpperCase()}
            </span>
          )}
        </a>
        <div className="text-[10px] tracking-[0.4em] uppercase text-[rgb(var(--brand-paper)/0.55)] hidden md:block shrink-0">
          {brandConfig.domain}
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-4 pb-16 text-center sm:px-6 sm:pb-20">
        {/* State pill */}
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="mb-5 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-semibold tracking-[0.3em] uppercase sm:px-4 sm:py-1.5 sm:text-[11px]"
          style={
            pill.urgent
              ? {
                  background: "rgb(var(--urgent) / 0.16)",
                  color: "rgb(var(--urgent))",
                  border: "1px solid rgb(var(--urgent) / 0.5)",
                }
              : {
                  background: "rgb(var(--brand-glow) / 0.14)",
                  color: "rgb(var(--brand-glow))",
                  border: "1px solid rgb(var(--brand-glow) / 0.4)",
                }
          }
        >
          {!pill.urgent && (
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[rgb(var(--brand-glow))]">
              <span className="absolute inset-0 animate-ping rounded-full bg-[rgb(var(--brand-glow))]" />
            </span>
          )}
          {pill.text}
        </motion.div>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 1, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-3xl text-balance text-[clamp(2rem,7vw,4.25rem)] leading-[1.02]"
          style={{
            fontFamily:
              "var(--font-atelier-display, 'Fraunces', 'Playfair Display', serif)",
            fontWeight: 400,
            letterSpacing: "-0.015em",
            fontVariationSettings: '"opsz" 144, "SOFT" 30',
          }}
        >
          {head}
          {head && " "}
          <em className="italic font-light" style={{ color: "rgb(var(--brand-glow))" }}>
            {accent}
          </em>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 1 }}
          className="mt-4 max-w-xl text-sm leading-relaxed text-[rgb(var(--brand-paper)/0.75)] sm:text-base"
        >
          {subtitle}
        </motion.p>

        {/* ── The red end-countdown — the psychological centrepiece ── */}
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4, duration: 0.8 }}
          className="mt-9 w-full max-w-lg"
        >
          <div
            className="mb-3 text-[10px] font-semibold tracking-[0.45em] uppercase sm:text-[11px]"
            style={{ color: "rgb(var(--urgent))" }}
          >
            {isLastCall ? "Final hour — closing" : "Closes in"}
          </div>
          <motion.div
            className="flex items-stretch justify-center gap-2 sm:gap-3"
            animate={surge ? { scale: [1, 1.015, 1] } : undefined}
            transition={
              surge
                ? { repeat: Infinity, duration: 2, ease: "easeInOut" }
                : undefined
            }
          >
            {days > 0 && <RedCell label="Days" value={days} />}
            <RedCell label="Hrs" value={hours} />
            <RedColon />
            <RedCell label="Min" value={mins} />
            <RedColon />
            <RedCell label="Sec" value={secs} pulse />
          </motion.div>
          <div className="mt-3 text-[10px] tracking-[0.35em] uppercase text-[rgb(var(--brand-paper)/0.45)]">
            ◦ {endLabel}
          </div>
        </motion.div>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.55, duration: 1 }}
          className="mt-9 flex flex-wrap items-center justify-center gap-3"
        >
          <button
            type="button"
            onClick={scrollToShop}
            className="inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-[11px] font-semibold tracking-[0.25em] uppercase shadow-[0_8px_24px_rgb(0_0_0/0.35)] transition hover:brightness-110 hover:-translate-y-0.5 active:translate-y-0"
            style={{
              background: "rgb(var(--brand-glow))",
              color: "rgb(var(--brand-ink))",
            }}
          >
            <ShoppingBag className="h-3.5 w-3.5" />
            {primaryLabel}
          </button>
          <button
            type="button"
            onClick={scrollToShop}
            className="inline-flex items-center gap-2 rounded-full border px-7 py-3.5 text-[11px] tracking-[0.25em] uppercase transition hover:bg-[rgb(var(--brand-paper)/0.08)]"
            style={{
              borderColor: "rgb(var(--brand-paper) / 0.45)",
              color: "rgb(var(--brand-paper) / 0.92)",
            }}
          >
            Browse the collection
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </motion.div>

        {hasWholesale && (
          <motion.button
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7, duration: 1 }}
            onClick={goWholesale}
            className="mt-4 inline-flex items-center gap-1.5 text-[11px] tracking-[0.18em] uppercase text-[rgb(var(--brand-paper)/0.6)] underline-offset-4 transition hover:text-[rgb(var(--brand-paper)/0.95)] hover:underline"
          >
            <Store className="h-3 w-3" /> Buying in bulk? Shop wholesale →
          </motion.button>
        )}
      </main>

      {/* Ambient elapsed hairline pinned to the bottom of the hero */}
      <div
        aria-hidden
        className="relative z-10 mx-auto w-full max-w-3xl px-6 pb-6"
      >
        <div
          className="h-px w-full overflow-hidden"
          style={{ background: "rgb(var(--brand-paper) / 0.12)" }}
        >
          <div
            className="h-full"
            style={{
              width: `${elapsedPct}%`,
              background: surge
                ? "rgb(var(--urgent))"
                : "rgb(var(--brand-glow))",
              boxShadow: surge
                ? "0 0 12px rgb(var(--urgent) / 0.6)"
                : "0 0 12px rgb(var(--brand-glow) / 0.5)",
              transition: "width 1s linear",
            }}
          />
        </div>
        <div className="mt-2 text-center text-[9px] tracking-[0.4em] uppercase text-[rgb(var(--brand-paper)/0.35)]">
          {Math.round(elapsedPct)}% elapsed
        </div>
      </div>
    </section>
  );
}

function RedCell({
  label,
  value,
  pulse = false,
}: {
  label: string;
  value: number;
  pulse?: boolean;
}) {
  return (
    <div
      className="min-w-[58px] rounded-2xl px-2 py-3 sm:min-w-[72px] sm:px-3 sm:py-4"
      style={{
        background: "rgb(var(--urgent) / 0.08)",
        border: "1px solid rgb(var(--urgent) / 0.25)",
      }}
    >
      <motion.div
        key={pulse ? value : undefined}
        initial={pulse ? { opacity: 0.5, y: -2 } : false}
        animate={pulse ? { opacity: 1, y: 0 } : undefined}
        transition={{ duration: 0.4 }}
        className="font-display text-[40px] leading-none tabular-nums sm:text-[56px]"
        style={{
          fontFamily:
            "var(--font-atelier-display, 'Fraunces', 'Playfair Display', serif)",
          color: "rgb(var(--urgent))",
          textShadow: "0 0 22px rgb(var(--urgent) / 0.4)",
        }}
      >
        {pad(value)}
      </motion.div>
      <div className="mt-1.5 text-[9px] tracking-[0.3em] uppercase text-[rgb(var(--brand-paper)/0.5)]">
        {label}
      </div>
    </div>
  );
}

function RedColon() {
  return (
    <div
      className="self-center text-[32px] leading-none sm:text-[44px]"
      style={{ color: "rgb(var(--urgent) / 0.55)" }}
    >
      :
    </div>
  );
}
