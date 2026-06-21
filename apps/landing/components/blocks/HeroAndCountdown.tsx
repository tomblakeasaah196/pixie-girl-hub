"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Bell, CalendarPlus, ChevronDown, Sparkles } from "lucide-react";
import type { LandingPayload } from "@/lib/types";
import type { DerivedState } from "@/lib/state-engine";
import { cn } from "@/lib/cn";
import { useCart } from "@/lib/cart-store";
import { buildIcs, googleCalendarUrl } from "@/lib/ics";

const EASE = [0.16, 1, 0.3, 1] as const;

interface HeroProps {
  payload: LandingPayload;
  derived: DerivedState;
  msToEnd: number;
}

/**
 * The cinematic, full-screen hero — built to read as one continuous chapter
 * with the brand's "between drops" page: full-bleed editorial photograph, a
 * drifting brand monogram, champagne eyebrow, serif headline with an italic
 * accent word, and a live countdown to the hour (Before → start, Live → end).
 */
export function Hero({ payload, derived, msToEnd }: HeroProps) {
  const isLive = derived.startsWith("live");
  const isBefore = derived.startsWith("before");
  const isEnded = derived.startsWith("ended");
  const lastCall = derived === "live_last_call";
  const surgePulse = lastCall && msToEnd < 5 * 60_000;
  const openCart = useCart((s) => s.openCart);

  const brandName = payload.brand?.display_name || "Pixie Girl Global";
  const monogram = (brandName.trim().charAt(0) || "P").toUpperCase();
  const domain = payload.brand?.sales_subdomain;
  const storefront = payload.brand?.storefront_domain
    ? `https://${payload.brand.storefront_domain}`
    : "#";

  const countdownTarget = isBefore
    ? payload.starts_at
    : isLive
      ? payload.ends_at
      : null;
  const countdownLabel = isBefore
    ? payload.countdown_message || "Doors open in"
    : lastCall
      ? "Final hour — last call"
      : "Sale ends in";

  return (
    <section className="hero-screen relative flex flex-col overflow-hidden">
      {/* Full-bleed photograph (or a tasteful gradient when none is set). */}
      <div
        className="absolute inset-0 -z-20"
        style={
          payload.hero.image_url
            ? {
                backgroundImage: `url(${payload.hero.image_url})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : {
                background:
                  "radial-gradient(120% 90% at 70% 10%, rgb(var(--accent-deep)/0.5), transparent 55%), rgb(var(--panel))",
              }
        }
      />
      <div className="absolute inset-0 -z-10 hero-veil" />

      {/* Ambient brand monogram, drifting slowly behind the copy. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 grid place-items-center overflow-hidden pointer-events-none"
      >
        <span
          className="hero-monogram"
          style={{ fontSize: "clamp(18rem, 40vw, 40rem)" }}
        >
          {monogram}
        </span>
      </div>

      {/* Top bar — wordmark + sales domain. */}
      <div className="relative z-10 mx-auto w-full max-w-[1180px] px-6 md:px-10 pt-6 md:pt-8 flex items-center justify-between gap-4">
        <a
          href={storefront}
          className="font-display text-[19px] md:text-[23px] leading-none tracking-[0.01em] text-[rgb(var(--text))] hover:text-[rgb(var(--gold))] transition-colors"
        >
          {brandName}
        </a>
        {domain && (
          <span className="hidden md:block text-[10px] tracking-[0.34em] uppercase text-[rgb(var(--text-faint))]">
            {domain}
          </span>
        )}
      </div>

      {/* Hero copy — bottom-weighted, like the reference. */}
      <div className="relative z-10 flex-1 flex items-end md:items-center">
        <div className="mx-auto w-full max-w-[1180px] px-6 md:px-10 py-[clamp(36px,8vh,96px)]">
          <motion.div
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: EASE }}
            className="max-w-[720px]"
          >
            <StateBadge
              isLive={isLive}
              isBefore={isBefore}
              lastCall={lastCall}
              vipWindow={derived === "before_vip_window"}
            />

            <h1 className="font-display leading-[1.0] text-[clamp(42px,7.5vw,88px)] tracking-[-0.01em] text-[rgb(var(--text))] drop-shadow-[0_2px_30px_rgb(0_0_0/0.45)]">
              {renderHeadline(payload.hero.title || payload.name)}
            </h1>

            {payload.hero.subtitle && (
              <p className="mt-5 max-w-[560px] text-[rgb(var(--text-muted))] text-lg md:text-xl leading-relaxed font-light">
                {payload.hero.subtitle}
              </p>
            )}

            {countdownTarget && (
              <HeroCountdown
                target={countdownTarget}
                label={countdownLabel}
                surge={surgePulse}
              />
            )}

            <div className="mt-9 flex flex-wrap items-center gap-3">
              {isLive && (
                <button
                  type="button"
                  onClick={() => {
                    document
                      .getElementById("bundles")
                      ?.scrollIntoView({ behavior: "smooth" });
                    openCart();
                  }}
                  className={cn(
                    "inline-flex items-center justify-center h-[52px] px-7 rounded-full font-semibold text-[15px] text-[rgb(var(--text))] cta-sheen shadow-cta",
                    surgePulse
                      ? "bg-[rgb(var(--accent))] animate-cta-breathe"
                      : "bg-[rgb(var(--accent-deep))]",
                  )}
                >
                  {payload.hero.cta_text || "Shop the drop"}
                </button>
              )}
              {isBefore && (
                <a
                  href="#signup"
                  className="inline-flex items-center gap-2 justify-center h-[52px] px-7 rounded-full font-semibold text-[15px] text-[rgb(var(--text))] bg-[rgb(var(--accent-deep))] cta-sheen shadow-cta"
                >
                  <Bell className="w-4 h-4" /> {payload.hero.cta_text || "Get on the list"}
                </a>
              )}
              {isEnded && (
                <Link
                  href={payload.ended?.redirect_to || storefront}
                  className="inline-flex items-center justify-center h-[52px] px-7 rounded-full font-semibold text-[15px] text-[rgb(var(--text))] bg-[rgb(var(--accent-deep))] cta-sheen shadow-cta"
                >
                  Shop our full collection →
                </Link>
              )}
              <button
                type="button"
                onClick={() =>
                  window.scrollTo({
                    top: window.innerHeight - 8,
                    behavior: "smooth",
                  })
                }
                className="inline-flex items-center gap-1.5 h-[52px] px-2 text-[13px] tracking-[0.06em] text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text))] transition-colors"
              >
                <span className="border-b border-[rgb(var(--gold)/0.4)] pb-1">
                  Explore the drop
                </span>
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Quiet scroll cue. */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.1, duration: 1 }}
        className="relative z-10 pb-6 flex justify-center"
        aria-hidden
      >
        <ChevronDown className="w-5 h-5 text-[rgb(var(--text-faint))] animate-bounce" />
      </motion.div>
    </section>
  );
}

function StateBadge({
  isLive,
  isBefore,
  lastCall,
  vipWindow,
}: {
  isLive: boolean;
  isBefore: boolean;
  lastCall: boolean;
  vipWindow: boolean;
}) {
  const label = isLive
    ? lastCall
      ? "Last call"
      : "Live now"
    : isBefore
      ? "Coming soon"
      : "Sale ended";
  return (
    <div className="flex items-center gap-2 mb-6">
      <span className="inline-flex items-center gap-2 rounded-full border border-[rgb(var(--gold)/0.4)] bg-[rgb(0_0_0/0.28)] backdrop-blur-sm px-3.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.3em] text-[rgb(var(--text))]">
        {isLive ? (
          <span className="relative w-1.5 h-1.5 rounded-full bg-[rgb(var(--success))]">
            <span className="absolute inset-0 rounded-full bg-[rgb(var(--success))] animate-ping" />
          </span>
        ) : (
          <Sparkles className="w-3 h-3 text-gold" />
        )}
        {label}
      </span>
      {vipWindow && (
        <span className="inline-flex items-center gap-1 rounded-full border border-[rgb(var(--gold)/0.4)] px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.3em] text-gold">
          <Sparkles className="w-3 h-3" /> VIP open
        </span>
      )}
    </div>
  );
}

/**
 * Italicise the final word of the headline in champagne — the editorial voice
 * shared with the reference page.
 */
function renderHeadline(title: string) {
  const words = title.trim().split(/\s+/);
  if (words.length <= 1)
    return <span className="italic text-gold">{title}</span>;
  const last = words[words.length - 1];
  const head = words.slice(0, -1).join(" ");
  return (
    <>
      {head} <em className="italic text-gold font-medium">{last}</em>
    </>
  );
}

/* ── The live hero countdown (days · hours · mins · secs, to the hour) ── */
function HeroCountdown({
  target,
  label,
  surge,
}: {
  target: string;
  label: string;
  surge?: boolean;
}) {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const ms = Math.max(0, new Date(target).getTime() - now);
  const units: [number, string][] = [
    [Math.floor(ms / 86_400_000), "Days"],
    [Math.floor((ms % 86_400_000) / 3_600_000), "Hrs"],
    [Math.floor((ms % 3_600_000) / 60_000), "Min"],
    [Math.floor((ms % 60_000) / 1000), "Sec"],
  ];
  return (
    <div className="mt-8">
      <div className="eyebrow mb-3">{label}</div>
      <div className={cn("flex gap-2.5 md:gap-3.5", surge && "animate-cta-breathe")}>
        {units.map(([value, unit]) => (
          <div
            key={unit}
            className="glass rounded-[16px] px-3.5 md:px-5 py-3 md:py-4 text-center min-w-[60px] md:min-w-[78px]"
          >
            <div className="countdown-digit text-[28px] md:text-[44px] leading-none text-[rgb(var(--text))]">
              {String(value).padStart(2, "0")}
            </div>
            <div className="mt-1.5 text-[9px] tracking-[0.22em] uppercase text-[rgb(var(--text-faint))]">
              {unit}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Countdown block (separately addressable from the campaign builder) ── */
export function Countdown({
  payload,
  derived,
}: {
  payload: LandingPayload;
  derived: DerivedState;
}) {
  if (derived.startsWith("ended")) return null;
  const target = derived.startsWith("before")
    ? payload.starts_at
    : payload.ends_at;
  const isSurge = derived === "live_last_call";
  const label =
    payload.countdown_message ||
    (derived.startsWith("before")
      ? "Doors open in"
      : isSurge
        ? "Final hour — last call"
        : "Time remaining");
  return (
    <section className="section-tight">
      <div className="mx-auto max-w-[820px] glass rounded-[var(--radius)] p-7 md:p-9">
        <div className="text-center">
          <HeroCountdownStatic target={target} label={label} surge={isSurge} />
        </div>
      </div>
    </section>
  );
}

/** Centered variant of the countdown for the standalone block. */
function HeroCountdownStatic({
  target,
  label,
  surge,
}: {
  target: string;
  label: string;
  surge?: boolean;
}) {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const ms = Math.max(0, new Date(target).getTime() - now);
  const units: [number, string][] = [
    [Math.floor(ms / 86_400_000), "Days"],
    [Math.floor((ms % 86_400_000) / 3_600_000), "Hours"],
    [Math.floor((ms % 3_600_000) / 60_000), "Mins"],
    [Math.floor((ms % 60_000) / 1000), "Secs"],
  ];
  return (
    <>
      <div className="eyebrow mb-4">{label}</div>
      <div
        className={cn(
          "flex justify-center gap-5 md:gap-9 text-[rgb(var(--text))]",
          surge && "animate-cta-breathe",
        )}
      >
        {units.map(([value, unit]) => (
          <div key={unit} className="text-center min-w-[58px]">
            <div className="countdown-digit text-[40px] md:text-[58px] leading-none">
              {String(value).padStart(2, "0")}
            </div>
            <div className="mt-1.5 text-[9px] tracking-[0.22em] uppercase text-[rgb(var(--text-faint))]">
              {unit}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ── Before-state save-the-date (calendar add) ─────────────────────── */
export function BeforeReveal({ payload }: { payload: LandingPayload }) {
  const [icsHref, setIcsHref] = useState<string | null>(null);
  useEffect(() => {
    const ics = buildIcs({
      uid: `${payload.slug}@${payload.brand?.business_key || "pixiegirl"}`,
      title: `${payload.brand?.display_name || ""} — ${payload.name}`,
      description: payload.hero.subtitle || "A time-bound sale.",
      starts_at: new Date(payload.starts_at),
      ends_at: new Date(payload.ends_at),
      url: `https://${payload.brand?.sales_subdomain || "sales.pixiegirlglobal.com"}/sale/${payload.slug}`,
    });
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    setIcsHref(url);
    return () => URL.revokeObjectURL(url);
  }, [payload]);

  const gcal = googleCalendarUrl({
    uid: payload.slug,
    title: `${payload.brand?.display_name || ""} — ${payload.name}`,
    description: payload.hero.subtitle || "",
    starts_at: new Date(payload.starts_at),
    ends_at: new Date(payload.ends_at),
    url: `https://${payload.brand?.sales_subdomain || "sales.pixiegirlglobal.com"}/sale/${payload.slug}`,
  });

  return (
    <section className="section-tight">
      <div className="mx-auto max-w-[820px] text-center">
        <div className="lux-rule mb-7 max-w-[120px] mx-auto" />
        <p className="text-[rgb(var(--text-muted))] mb-4">
          Save the date so you don&apos;t miss the moment it opens.
        </p>
        <div className="inline-flex flex-wrap gap-2 justify-center">
          {icsHref && (
            <a
              href={icsHref}
              download={`${payload.slug}.ics`}
              className="inline-flex items-center gap-2 h-11 px-4 rounded-full border border-[rgb(var(--gold)/0.3)] text-[rgb(var(--text))] hover:bg-[rgb(var(--gold)/0.08)] transition-colors"
            >
              <CalendarPlus className="w-4 h-4 text-gold" /> Add to calendar
              (.ics)
            </a>
          )}
          <a
            href={gcal}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 h-11 px-4 rounded-full border border-[rgb(var(--gold)/0.3)] text-[rgb(var(--text))] hover:bg-[rgb(var(--gold)/0.08)] transition-colors"
          >
            <CalendarPlus className="w-4 h-4 text-gold" /> Google Calendar
          </a>
        </div>
      </div>
    </section>
  );
}

/* ── Ended-state farewell ──────────────────────────────────────────── */
export function EndedFarewell({ payload }: { payload: LandingPayload }) {
  const storefront = payload.brand?.storefront_domain
    ? `https://${payload.brand.storefront_domain}`
    : "https://pixiegirlglobal.com";
  return (
    <section className="section text-center">
      <div className="mx-auto max-w-[640px]">
        <div className="lux-rule mb-8 max-w-[120px] mx-auto" />
        {payload.next_campaign ? (
          <>
            <div className="eyebrow mb-3">Next drop scheduled</div>
            <h2 className="font-display text-[clamp(34px,5vw,52px)] leading-[1.05]">
              {payload.next_campaign.name}{" "}
              <em className="italic text-gold">soon</em>.
            </h2>
            <p className="mt-3 text-[rgb(var(--text-muted))]">
              {new Date(payload.next_campaign.starts_at).toLocaleDateString(
                undefined,
                { weekday: "long", month: "long", day: "numeric" },
              )}
              . Get on the list to be first in.
            </p>
            <Link
              href={`/sale/${payload.next_campaign.slug}`}
              className="mt-6 inline-flex items-center h-12 px-6 rounded-full bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))] font-semibold cta-sheen shadow-cta"
            >
              Get on the list →
            </Link>
          </>
        ) : (
          <>
            <div className="eyebrow mb-3">Until the next chapter</div>
            <h2 className="font-display text-[clamp(34px,5vw,52px)] leading-[1.05]">
              {payload.ended?.message || (
                <>
                  Thank you for being{" "}
                  <em className="italic text-gold">here</em>.
                </>
              )}
            </h2>
            <p className="mt-3 text-[rgb(var(--text-muted))]">
              Our full collection is alive and well on the main storefront.
            </p>
            <Link
              href={payload.ended?.redirect_to || storefront}
              className="mt-6 inline-flex items-center h-12 px-6 rounded-full bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))] font-semibold cta-sheen shadow-cta"
            >
              Shop the collection →
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
