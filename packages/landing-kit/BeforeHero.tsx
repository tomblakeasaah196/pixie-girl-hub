// @ts-nocheck
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CalendarPlus, ChevronDown, Sparkles } from "lucide-react";
import type { LandingConfig, LandingPayload } from "./types";
import { hexToTriplet } from "./types";
import { buildIcs, googleCalendarUrl } from "./ics";
import {
  AtelierHourglass,
  type HourglassTier,
} from "./blocks/3d/AtelierHourglass";

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function tierFor(diffMs: number): HourglassTier {
  const m = diffMs / 60_000;
  if (m <= 1) return 5;
  if (m <= 5) return 4;
  if (m <= 60) return 3;
  if (m <= 60 * 24) return 2;
  return 1;
}

function topFractionFor(diffMs: number): number {
  const TWELVE_HOURS = 12 * 3600_000;
  const TWO_DAYS = 2 * 24 * 3600_000;
  const WINDOW = 14 * 24 * 3600_000;
  if (diffMs <= 0) return 0;
  if (diffMs <= TWELVE_HOURS) return (diffMs / TWELVE_HOURS) * 0.25;
  if (diffMs <= TWO_DAYS) {
    const t = (diffMs - TWELVE_HOURS) / (TWO_DAYS - TWELVE_HOURS);
    return 0.25 + t * 0.45;
  }
  const t = Math.min(1, (diffMs - TWO_DAYS) / (WINDOW - TWO_DAYS));
  return 0.7 + t * 0.3;
}

function useCountdown(targetMs: number, tickMs: number = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  const diff = Math.max(0, targetMs - now);
  const s = Math.floor(diff / 1000);
  return {
    diff,
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    mins: Math.floor((s % 3600) / 60),
    secs: s % 60,
  };
}

function splitHeadline(title: string) {
  const words = title.trim().split(/\s+/);
  if (words.length <= 1) return { head: "", accent: title };
  return { head: words.slice(0, -1).join(" "), accent: words[words.length - 1] };
}

export interface BeforeHeroProps {
  payload: LandingPayload;
  brandConfig: LandingConfig;
}

export function BeforeHero({ payload, brandConfig }: BeforeHeroProps) {
  const reduceMotion = useReducedMotion();
  const targetMs = useMemo(
    () => new Date(payload.starts_at).getTime(),
    [payload.starts_at],
  );
  const { diff, days, hours, mins, secs } = useCountdown(targetMs);
  const tier = tierFor(diff);
  const topFraction = topFractionFor(diff);

  const palette = useMemo(
    () => ({
      sandRest: brandConfig.theme.accent,
      sandUrgent: brandConfig.theme.glow,
      glow: brandConfig.theme.glow,
      glassTint: brandConfig.theme.paper,
    }),
    [brandConfig.theme],
  );

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
      }) as React.CSSProperties,
    [brandConfig.theme],
  );

  const vipMinutes = payload.vip_early_access_minutes ?? 0;
  const inVipWindow =
    vipMinutes > 0 && diff > 0 && diff <= vipMinutes * 60_000;

  const heroTitle = payload.hero.title || brandConfig.hero.headline;
  const heroAccent =
    payload.hero.title
      ? splitHeadline(payload.hero.title).accent
      : brandConfig.hero.headlineAccent;
  const heroHead =
    payload.hero.title ? splitHeadline(payload.hero.title).head : brandConfig.hero.headline;
  const heroBody = payload.hero.subtitle || brandConfig.hero.body;

  const eyebrow =
    tier === 5
      ? "MOMENTS AWAY"
      : tier === 4
        ? "DOORS OPENING"
        : tier === 3
          ? "THE HOUR HAS COME"
          : tier === 2
            ? "FINAL HOURS"
            : payload.countdown_message?.toUpperCase() || "DOORS OPEN IN";

  const faces = useMemo(() => {
    if (tier === 5) return [pad(secs), pad(secs), pad(secs), pad(secs)];
    if (tier === 4) return [pad(mins), pad(secs), pad(mins), pad(secs)];
    return [pad(days), pad(hours), pad(mins), pad(secs)];
  }, [tier, days, hours, mins, secs]);

  const labels = useMemo(() => {
    if (tier === 5) return ["SECONDS", "SECONDS", "SECONDS", "SECONDS"];
    if (tier === 4) return ["MINS", "SECS", "MINS", "SECS"];
    return ["DAYS", "HOURS", "MINS", "SECS"];
  }, [tier]);

  // Hand-built ICS for the save-the-date button. Only relevant tier ≤ 2.
  const icsHrefRef = useRef<string | null>(null);
  const [icsReady, setIcsReady] = useState(false);
  useEffect(() => {
    if (tier > 2) return;
    const ics = buildIcs({
      uid: `${payload.slug}@${payload.brand?.business_key || "pixiegirl"}`,
      title: `${payload.brand?.display_name || brandConfig.brandName} — ${payload.name}`,
      description: heroBody,
      starts_at: new Date(payload.starts_at),
      ends_at: new Date(payload.ends_at),
      url: `https://${payload.brand?.sales_subdomain || brandConfig.domain}/sale/${payload.slug}`,
    });
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    icsHrefRef.current = URL.createObjectURL(blob);
    setIcsReady(true);
    return () => {
      if (icsHrefRef.current) URL.revokeObjectURL(icsHrefRef.current);
      icsHrefRef.current = null;
      setIcsReady(false);
    };
  }, [
    tier,
    payload.slug,
    payload.brand?.business_key,
    payload.brand?.display_name,
    payload.brand?.sales_subdomain,
    payload.name,
    payload.starts_at,
    payload.ends_at,
    brandConfig.brandName,
    brandConfig.domain,
    heroBody,
  ]);

  const gcalHref = useMemo(
    () =>
      googleCalendarUrl({
        uid: payload.slug,
        title: `${payload.brand?.display_name || brandConfig.brandName} — ${payload.name}`,
        description: heroBody,
        starts_at: new Date(payload.starts_at),
        ends_at: new Date(payload.ends_at),
        url: `https://${payload.brand?.sales_subdomain || brandConfig.domain}/sale/${payload.slug}`,
      }),
    [
      payload.slug,
      payload.brand?.display_name,
      payload.brand?.sales_subdomain,
      payload.name,
      payload.starts_at,
      payload.ends_at,
      brandConfig.brandName,
      brandConfig.domain,
      heroBody,
    ],
  );

  const monogram = brandConfig.brandName.charAt(0).toUpperCase();
  const desat = tier >= 2 ? "saturate(0.92)" : "none";

  // The screen-reader-friendly live countdown — visually hidden but
  // announced as the digits change.
  const announce = useMemo(() => {
    if (tier === 5) return `${secs} seconds`;
    if (tier === 4) return `${mins} minutes ${secs} seconds`;
    return `${days} days, ${hours} hours, ${mins} minutes`;
  }, [tier, days, hours, mins, secs]);

  return (
    <section
      style={{
        ...brandVars,
        background:
          "radial-gradient(ellipse at 50% 75%, rgb(var(--brand-primary-deep)) 0%, rgb(var(--brand-ink)) 45%, #060403 100%)",
        filter: desat,
        transition: "filter 1.2s ease",
      }}
      className="relative isolate flex min-h-[100svh] w-full flex-col overflow-hidden text-[rgb(var(--brand-paper))]"
      data-tier={tier}
    >
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {announce} until {payload.name} opens
      </span>

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
          opacity: tier >= 2 ? 0.08 : 0.045,
          lineHeight: 1,
          transition: "opacity 1.5s ease",
          letterSpacing: "-0.08em",
        }}
      >
        {monogram}
      </div>

      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%]"
        style={{
          background: `radial-gradient(ellipse at 50% 100%, rgb(var(--brand-glow) / 0.22), transparent 60%)`,
        }}
      />

      <header className="relative z-20 flex items-center justify-between gap-4 px-5 py-5 sm:px-8 sm:py-6 md:px-12">
        <a
          href={brandConfig.storefront}
          className="flex items-center gap-3 min-w-0"
          target="_blank"
          rel="noreferrer"
        >
          {brandConfig.logo.url ? (
            <img
              src={brandConfig.logo.url}
              alt={brandConfig.brandName}
              className="h-7 md:h-8 object-contain"
              style={{
                filter: brandConfig.logo.headerTint
                  ? `drop-shadow(0 0 0 ${brandConfig.logo.headerTint})`
                  : undefined,
              }}
            />
          ) : (
            <span
              className="text-[11px] tracking-[0.35em] sm:text-sm sm:tracking-[0.4em]"
              style={{
                fontFamily:
                  "var(--font-atelier-display, 'Fraunces', serif)",
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

      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col items-center px-4 pb-20 text-center sm:px-6 sm:pb-24 md:pb-28">
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className="mt-2 mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[9px] tracking-[0.4em] backdrop-blur-md sm:mb-5 sm:px-4 sm:py-1.5 sm:text-[11px] sm:tracking-[0.55em]"
          style={{
            color:
              tier >= 2
                ? `rgb(var(--brand-glow))`
                : `rgb(var(--brand-paper) / 0.85)`,
            borderColor:
              tier >= 2
                ? `rgb(var(--brand-glow) / 0.65)`
                : `rgb(var(--brand-paper) / 0.25)`,
            background: "rgb(255 255 255 / 0.04)",
            transition: "color 1s ease, border-color 1s ease",
          }}
        >
          <Sparkles className="w-3 h-3" />
          {eyebrow}
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 1.05, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 max-w-3xl text-balance text-[clamp(1.85rem,7.2vw,4rem)] leading-[1.04]"
          style={{
            fontFamily:
              "var(--font-atelier-display, 'Fraunces', 'Playfair Display', serif)",
            fontWeight: 400,
            letterSpacing: "-0.012em",
            fontVariationSettings: '"opsz" 144, "SOFT" 30',
          }}
        >
          {heroHead}
          {heroHead && " "}
          <em
            className="italic font-light"
            style={{ color: `rgb(var(--brand-glow))` }}
          >
            {heroAccent}
          </em>
          .
        </motion.h1>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 1 }}
          className="relative mx-auto mt-2 aspect-[3/4] w-full max-w-[22rem] sm:-mt-4 sm:aspect-auto sm:h-[58vh] sm:max-w-2xl md:-mt-6 md:h-[62vh]"
        >
          <AtelierHourglass
            topFraction={topFraction}
            tier={tier}
            displayFaces={faces}
            faceLabels={labels}
            palette={palette}
          />
        </motion.div>

        {heroBody && tier <= 2 && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.55, duration: 1 }}
            className="mt-2 max-w-xl text-sm leading-relaxed text-[rgb(var(--brand-paper)/0.78)] sm:mt-4 sm:text-base"
          >
            {heroBody}
          </motion.p>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-[9px] tracking-[0.3em] sm:gap-3 sm:text-[10px] sm:tracking-[0.35em]">
          <span
            className="rounded-full border px-3 py-1 sm:px-4 sm:py-1.5"
            style={{
              borderColor: `rgb(var(--brand-glow) / 0.3)`,
              color: `rgb(var(--brand-paper) / 0.75)`,
            }}
          >
            BY INVITATION
          </span>
          {inVipWindow && (
            <motion.span
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6 }}
              className="rounded-full border px-3 py-1 sm:px-4 sm:py-1.5"
              style={{
                borderColor: `rgb(var(--brand-glow))`,
                color: `rgb(var(--brand-glow))`,
              }}
            >
              ✨ VIP EARLY ACCESS OPEN
            </motion.span>
          )}
          {tier === 2 && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8 }}
              className="rounded-full border px-3 py-1 sm:px-4 sm:py-1.5"
              style={{
                borderColor: `rgb(var(--brand-glow))`,
                color: `rgb(var(--brand-glow))`,
              }}
            >
              OPENING TONIGHT
            </motion.span>
          )}
        </div>

        <div className="mt-7 flex min-h-[3rem] items-start justify-center sm:mt-9">
          {tier <= 2 ? (
            <div className="flex flex-wrap justify-center gap-2 text-[10px] tracking-[0.25em] sm:gap-3 sm:text-[11px] sm:tracking-[0.3em]">
              {icsReady && icsHrefRef.current && (
                <a
                  href={icsHrefRef.current}
                  download={`${payload.slug}.ics`}
                  className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 transition sm:px-6 sm:py-3"
                  style={{
                    background: `rgb(var(--brand-glow))`,
                    color: `rgb(var(--brand-ink))`,
                  }}
                >
                  <CalendarPlus className="w-3.5 h-3.5" />
                  SAVE THE DATE
                </a>
              )}
              <a
                href={gcalHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border px-5 py-2.5 transition sm:px-6 sm:py-3"
                style={{
                  borderColor: `rgb(var(--brand-glow) / 0.45)`,
                  color: `rgb(var(--brand-paper) / 0.85)`,
                }}
              >
                <CalendarPlus className="w-3.5 h-3.5" />
                GOOGLE CALENDAR
              </a>
              <a
                href="#lp-invitation"
                className="inline-flex items-center gap-2 rounded-full border px-5 py-2.5 transition sm:px-6 sm:py-3"
                style={{
                  borderColor: `rgb(var(--brand-paper) / 0.18)`,
                  color: `rgb(var(--brand-paper) / 0.65)`,
                }}
              >
                JOIN THE LIST
                <ChevronDown className="w-3.5 h-3.5" />
              </a>
            </div>
          ) : tier === 3 ? (
            <a
              href="#lp-invitation"
              className="text-[10px] tracking-[0.3em] underline underline-offset-[8px] sm:text-[11px] sm:tracking-[0.35em] sm:underline-offset-[10px]"
              style={{ color: `rgb(var(--brand-glow))` }}
            >
              STAY ON THIS PAGE — IT OPENS HERE
            </a>
          ) : (
            <div
              className="text-[10px] tracking-[0.35em] sm:text-[11px] sm:tracking-[0.4em]"
              style={{ color: `rgb(var(--brand-glow))` }}
            >
              ◦ DO NOT REFRESH ◦
            </div>
          )}
        </div>

        {tier <= 2 && !reduceMotion && (
          <motion.div
            aria-hidden
            className="mt-10 flex flex-col items-center gap-1 text-[10px] tracking-[0.35em] text-[rgb(var(--brand-paper)/0.4)] sm:mt-12"
            animate={{ y: [0, 6, 0] }}
            transition={{ repeat: Infinity, duration: 2.4, ease: "easeInOut" }}
          >
            SCROLL
            <ChevronDown className="w-3.5 h-3.5" />
          </motion.div>
        )}
      </main>
    </section>
  );
}
