"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import dynamic from "next/dynamic";
import { Bell, CalendarPlus, ChevronDown, Sparkles } from "lucide-react";
import type { LandingPayload } from "@/lib/types";
import type { DerivedState } from "@/lib/state-engine";
import { cn } from "@/lib/cn";
import { useCart } from "@/lib/cart-store";
import { buildIcs, googleCalendarUrl } from "@/lib/ics";

// The 2.5D hero pieces pull in the entire three.js + @react-three/fiber stack
// (~500KB). They render only in the built-in Before/Live hero and never on the
// live sales page (which uses its own DOM hero via LiveHero). Loading them
// lazily with ssr:false keeps three.js out of the initial bundle entirely — the
// chunk is fetched only when a state that actually shows 3D mounts it. WebGL
// can't server-render anyway, so there's no SSR loss.
const CountdownRing = dynamic(
  () => import("./3d/CountdownRing").then((m) => m.CountdownRing),
  { ssr: false },
);
const HeroCenterpiece = dynamic(
  () => import("./3d/HeroCenterpiece").then((m) => m.HeroCenterpiece),
  { ssr: false },
);

interface HeroProps {
  payload: LandingPayload;
  derived: DerivedState;
  msToEnd: number;
}

export function Hero({ payload, derived, msToEnd }: HeroProps) {
  const isLive = derived.startsWith("live");
  const isBefore = derived.startsWith("before");
  const isEnded = derived.startsWith("ended");
  const lastCall = derived === "live_last_call";
  const openCart = useCart((s) => s.openCart);
  const surgePulse = lastCall && msToEnd < 5 * 60_000;

  return (
    <section className="relative overflow-hidden">
      <div
        className="absolute inset-0 -z-10"
        style={
          payload.hero.image_url
            ? {
                backgroundImage: `linear-gradient(180deg, rgb(0 0 0 / 0.35) 0%, rgb(var(--bg)/0.88) 92%), url(${payload.hero.image_url})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : undefined
        }
      />
      <div className="absolute inset-0 -z-10 pointer-events-none">
        {/* 2.5D centrepiece: countdown ring (Before) or floating hero (Live). */}
        <div className="hidden md:block absolute inset-0 opacity-90">
          {isBefore && <CountdownRing target={payload.starts_at} />}
          {isLive && (
            <HeroCenterpiece
              imageUrl={payload.hero.image_url}
              surge={surgePulse}
            />
          )}
        </div>
      </div>

      <div className="mx-auto max-w-[1180px] px-6 md:px-10 pt-[clamp(60px,12vh,140px)] pb-[clamp(40px,8vh,80px)] relative">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-[680px]"
        >
          <div className="flex items-center gap-2 mb-5">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-bold uppercase tracking-[0.18em]",
                isLive
                  ? "bg-[rgb(var(--success)/0.18)] text-[rgb(var(--success))]"
                  : isBefore
                    ? "bg-[rgb(var(--warn)/0.18)] text-[rgb(var(--warn))]"
                    : "bg-[rgb(var(--text)/0.06)] text-[rgb(var(--text-faint))]",
              )}
            >
              {isLive && (
                <span className="relative w-1.5 h-1.5 rounded-full bg-[rgb(var(--success))]">
                  <span className="absolute inset-0 rounded-full bg-[rgb(var(--success))] animate-ping" />
                </span>
              )}
              {isLive
                ? lastCall
                  ? "Last call"
                  : "Live now"
                : isBefore
                  ? "Coming soon"
                  : "Sale ended"}
            </span>
            {derived === "before_vip_window" && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10.5px] font-bold uppercase tracking-[0.18em] bg-[rgb(var(--accent)/0.15)] text-[rgb(var(--accent-glow))]">
                <Sparkles className="w-3 h-3" /> VIP early access open
              </span>
            )}
          </div>

          <h1 className="font-display leading-[1.02] text-[clamp(40px,7vw,84px)] tracking-tight">
            {renderHeadline(payload.hero.title || payload.name)}
          </h1>
          {payload.hero.subtitle && (
            <p className="mt-5 text-[rgb(var(--text-muted))] text-lg md:text-xl leading-relaxed max-w-[560px]">
              {payload.hero.subtitle}
            </p>
          )}

          <div className="mt-8 flex flex-wrap gap-3">
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
                  "inline-flex items-center justify-center h-12 px-6 rounded-xl font-semibold text-[rgb(var(--text))] cta-sheen",
                  surgePulse
                    ? "bg-[rgb(var(--accent))] animate-cta-breathe"
                    : "bg-[rgb(var(--accent-deep))]",
                )}
              >
                {payload.hero.cta_text || "Shop the drop"}
              </button>
            )}
            {isBefore && <BeforeCTA payload={payload} />}
            {isEnded && (
              <Link
                href={
                  payload.ended?.redirect_to || "https://pixiegirlglobal.com"
                }
                className="inline-flex items-center justify-center h-12 px-6 rounded-xl font-semibold text-[rgb(var(--text))] bg-[rgb(var(--accent-deep))] cta-sheen"
              >
                Shop our full collection →
              </Link>
            )}
            <a
              href="#bundles"
              className="inline-flex items-center justify-center h-12 px-5 rounded-xl border border-[rgb(var(--border-c)/0.15)] text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text))] transition-colors"
            >
              Learn more <ChevronDown className="w-4 h-4 ml-1" />
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/**
 * Renders the headline serif with a single italic accent word at the
 * end (matches the canon demo's editorial voice). We italicise the last
 * word of the headline in --accent-glow.
 */
function renderHeadline(title: string) {
  const words = title.trim().split(/\s+/);
  if (words.length <= 1) return title;
  const last = words[words.length - 1];
  const head = words.slice(0, -1).join(" ");
  return (
    <>
      {head}{" "}
      <em className="not-italic md:italic text-[rgb(var(--accent-glow))] font-medium">
        {last}
      </em>
    </>
  );
}

function BeforeCTA({ payload }: { payload: LandingPayload }) {
  return (
    <a
      href="#signup"
      className="inline-flex items-center gap-2 justify-center h-12 px-6 rounded-xl font-semibold text-[rgb(var(--text))] bg-[rgb(var(--accent-deep))] cta-sheen"
    >
      <Bell className="w-4 h-4" /> Get on the list
    </a>
  );
}

/* ── Countdown block (separately addressable from the campaign builder) */
export function Countdown({
  payload,
  derived,
}: {
  payload: LandingPayload;
  derived: DerivedState;
}) {
  const target = derived.startsWith("before")
    ? new Date(payload.starts_at)
    : new Date(payload.ends_at);
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const ms = target.getTime() - now;
  const isSurge = derived === "live_last_call";
  if (derived.startsWith("ended")) return null;
  const days = Math.max(0, Math.floor(ms / 86_400_000));
  const hours = Math.max(0, Math.floor((ms % 86_400_000) / 3_600_000));
  const mins = Math.max(0, Math.floor((ms % 3_600_000) / 60_000));
  const secs = Math.max(0, Math.floor((ms % 60_000) / 1000));

  return (
    <section className="section-tight">
      <div className="mx-auto max-w-[820px] glass rounded-[var(--radius)] p-7 md:p-8">
        <div className="micro mb-3 text-center">
          {payload.countdown_message ||
            (derived.startsWith("before")
              ? "Doors open in"
              : isSurge
                ? "Final hour — last call"
                : "Time remaining")}
        </div>
        <div
          className={cn(
            "flex justify-center gap-4 md:gap-7 text-[rgb(var(--text))]",
            isSurge && "animate-cta-breathe",
          )}
        >
          <Cell label="Days" value={days} />
          <Cell label="Hours" value={hours} />
          <Cell label="Mins" value={mins} />
          <Cell label="Secs" value={secs} />
        </div>
      </div>
    </section>
  );
}

function Cell({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center min-w-[64px]">
      <div className="font-display countdown-digit text-[44px] md:text-[60px] leading-none">
        {String(value).padStart(2, "0")}
      </div>
      <div className="micro mt-1">{label}</div>
    </div>
  );
}

/* ── Before-state reveal slot: optional save-the-date block ────────── */
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
        <p className="text-[rgb(var(--text-muted))] mb-4">
          Save the date so you don&apos;t miss the moment.
        </p>
        <div className="inline-flex flex-wrap gap-2 justify-center">
          {icsHref && (
            <a
              href={icsHref}
              download={`${payload.slug}.ics`}
              className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-[rgb(var(--border-c)/0.15)] text-[rgb(var(--text))] hover:bg-[rgb(var(--text)/0.04)]"
            >
              <CalendarPlus className="w-4 h-4" /> Add to calendar (.ics)
            </a>
          )}
          <a
            href={gcal}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-[rgb(var(--border-c)/0.15)] text-[rgb(var(--text))] hover:bg-[rgb(var(--text)/0.04)]"
          >
            <CalendarPlus className="w-4 h-4" /> Google Calendar
          </a>
        </div>
      </div>
    </section>
  );
}

/* ── Ended-state farewell ──────────────────────────────────────────── */
export function EndedFarewell({ payload }: { payload: LandingPayload }) {
  return (
    <section className="section text-center">
      <div className="mx-auto max-w-[640px]">
        {payload.next_campaign ? (
          <>
            <div className="micro mb-3">Next drop scheduled</div>
            <h2 className="font-display text-[clamp(34px,5vw,52px)] leading-[1.05]">
              {payload.next_campaign.name}{" "}
              <em className="not-italic md:italic text-[rgb(var(--accent-glow))]">
                soon
              </em>
              .
            </h2>
            <p className="mt-3 text-[rgb(var(--text-muted))]">
              {new Date(payload.next_campaign.starts_at).toLocaleDateString(
                undefined,
                {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                },
              )}
              . Get on the list to be first in.
            </p>
            <Link
              href={`/sale/${payload.next_campaign.slug}`}
              className="mt-6 inline-flex items-center h-12 px-6 rounded-xl bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))] font-semibold cta-sheen"
            >
              Get on the list →
            </Link>
          </>
        ) : (
          <>
            <h2 className="font-display text-[clamp(34px,5vw,52px)] leading-[1.05]">
              {payload.ended?.message || (
                <>
                  Thank you for being{" "}
                  <em className="not-italic md:italic text-[rgb(var(--accent-glow))]">
                    here
                  </em>
                  .
                </>
              )}
            </h2>
            <p className="mt-3 text-[rgb(var(--text-muted))]">
              Our full collection is alive and well on the main storefront.
            </p>
            <Link
              href={payload.ended?.redirect_to || "https://pixiegirlglobal.com"}
              className="mt-6 inline-flex items-center h-12 px-6 rounded-xl bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))] font-semibold cta-sheen"
            >
              Shop the collection →
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
