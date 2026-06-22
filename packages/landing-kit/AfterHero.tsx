// @ts-nocheck
"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Bell, Sparkles } from "lucide-react";
import type { LandingConfig, LandingPayload } from "./types";
import { hexToTriplet } from "./types";
import { AtelierHourglass } from "./blocks/3d/AtelierHourglass";

interface Props {
  payload: LandingPayload;
  brandConfig: LandingConfig;
}

function splitHeadline(title: string) {
  const words = title.trim().split(/\s+/);
  if (words.length <= 1) return { head: "", accent: title };
  return { head: words.slice(0, -1).join(" "), accent: words[words.length - 1] };
}

function formatMonthDay(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
}

function durationHours(starts: Date, ends: Date) {
  const hours = Math.max(1, Math.round((ends.getTime() - starts.getTime()) / 3_600_000));
  return hours;
}

function formatDuration(starts: Date, ends: Date) {
  const hours = durationHours(starts, ends);
  if (hours <= 48) return `${hours} HOURS`;
  const days = Math.round(hours / 24);
  return `${days} DAYS`;
}

export function AfterHero({ payload, brandConfig }: Props) {
  const starts = useMemo(() => new Date(payload.starts_at), [payload.starts_at]);
  const ends = useMemo(() => new Date(payload.ends_at), [payload.ends_at]);

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

  const headlineSrc = payload.hero.title || payload.name;
  const { head: headHead, accent: headAccent } = splitHeadline(headlineSrc);
  const isPlural = /s\b|s$/i.test(headAccent);
  // Past-tense framing: append a soft closing phrase if the campaign name reads
  // as a noun rather than a complete sentence. This is intentionally minimal
  // since the eyebrow already reads "THIS CHAPTER, COMPLETE".
  const closingPhrase = payload.ended?.message
    ? null
    : isPlural
      ? "fond memories"
      : "complete";
  const subline =
    payload.ended?.message ||
    "We open the doors a few times a year. Stay close — the next moment is being prepared.";

  const mementoFaces = useMemo(
    () => [
      payload.name.toUpperCase(),
      `${formatMonthDay(starts)} — ${formatMonthDay(ends)}`,
      formatDuration(starts, ends),
      "CHAPTER CLOSED",
    ],
    [payload.name, starts, ends],
  );

  const storefrontHref =
    payload.ended?.redirect_to ||
    brandConfig.storefront ||
    `https://${brandConfig.domain.replace(/^sales\./, "")}`;

  const next = payload.next_campaign;
  const nextDate = next ? new Date(next.starts_at) : null;
  const nextLabel = nextDate
    ? nextDate.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
      })
    : null;

  const monogram = brandConfig.brandName.charAt(0).toUpperCase();

  return (
    <section
      style={{
        ...brandVars,
        background:
          "radial-gradient(ellipse at 50% 75%, rgb(var(--brand-primary-deep)) 0%, rgb(var(--brand-ink)) 50%, #050302 100%)",
        filter: "saturate(0.88)",
      }}
      className="relative isolate flex min-h-[100svh] w-full flex-col overflow-hidden text-[rgb(var(--brand-paper))]"
      data-state="ended"
    >
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
          opacity: 0.06,
          lineHeight: 1,
          letterSpacing: "-0.08em",
        }}
      >
        {monogram}
      </div>

      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%]"
        style={{
          background: `radial-gradient(ellipse at 50% 100%, rgb(var(--brand-glow) / 0.15), transparent 60%)`,
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

      {next && nextLabel && (
        <motion.a
          href={`/sale/${next.slug}/before`}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-20 mx-auto mb-2 inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-[10px] tracking-[0.35em] backdrop-blur-md sm:text-[11px]"
          style={{
            borderColor: `rgb(var(--brand-glow) / 0.45)`,
            color: `rgb(var(--brand-glow))`,
            background: "rgb(255 255 255 / 0.04)",
          }}
        >
          <Sparkles className="w-3 h-3" />
          THE NEXT CHAPTER OPENS {nextLabel.toUpperCase()}
          <ArrowRight className="w-3.5 h-3.5" />
        </motion.a>
      )}

      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col items-center px-4 pb-20 text-center sm:px-6 sm:pb-24 md:pb-28">
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className="mt-2 mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[9px] tracking-[0.4em] backdrop-blur-md sm:mb-5 sm:px-4 sm:py-1.5 sm:text-[11px] sm:tracking-[0.55em]"
          style={{
            color: `rgb(var(--brand-glow))`,
            borderColor: `rgb(var(--brand-glow) / 0.45)`,
            background: "rgb(255 255 255 / 0.04)",
          }}
        >
          <span aria-hidden>◦</span>
          THIS CHAPTER, COMPLETE
          <span aria-hidden>◦</span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 1.05, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 max-w-3xl text-balance text-[clamp(1.85rem,7.2vw,4rem)] leading-[1.04]"
          style={{
            fontFamily:
              "var(--font-atelier-display, 'Fraunces', 'Playfair Display', serif)",
            fontWeight: 400,
            letterSpacing: "-0.012em",
            fontVariationSettings: '"opsz" 144, "SOFT" 30',
          }}
        >
          {headHead}
          {headHead && " "}
          {headAccent}
          {closingPhrase ? (
            <>
              ,{" "}
              <em
                className="italic font-light"
                style={{ color: `rgb(var(--brand-glow))` }}
              >
                {closingPhrase}
              </em>
              .
            </>
          ) : (
            "."
          )}
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.45, duration: 1 }}
          className="mt-5 max-w-xl text-sm leading-relaxed text-[rgb(var(--brand-paper)/0.7)] sm:text-base"
        >
          {subline}
        </motion.p>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 1.1 }}
          className="relative mx-auto mt-4 aspect-[3/4] w-full max-w-[22rem] sm:mt-2 sm:aspect-auto sm:h-[58vh] sm:max-w-2xl md:h-[62vh]"
        >
          <AtelierHourglass
            topFraction={0}
            tier={1}
            mode="memento"
            displayFaces={mementoFaces}
            faceLabels={["", "", "", ""]}
            palette={palette}
          />
        </motion.div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-[10px] tracking-[0.3em] sm:gap-4 sm:text-[11px] sm:tracking-[0.35em]">
          {next ? (
            <>
              <a
                href={`/sale/${next.slug}/before`}
                className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 transition sm:px-6 sm:py-3"
                style={{
                  background: `rgb(var(--brand-glow))`,
                  color: `rgb(var(--brand-ink))`,
                }}
              >
                <Bell className="w-3.5 h-3.5" />
                NEXT DROP — {next.name.toUpperCase()}
              </a>
              <a
                href={storefrontHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border px-5 py-2.5 transition sm:px-6 sm:py-3"
                style={{
                  borderColor: `rgb(var(--brand-glow) / 0.45)`,
                  color: `rgb(var(--brand-paper) / 0.85)`,
                }}
              >
                VISIT THE STOREFRONT
                <ArrowRight className="w-3.5 h-3.5" />
              </a>
            </>
          ) : (
            <>
              <a
                href={storefrontHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 transition sm:px-6 sm:py-3"
                style={{
                  background: `rgb(var(--brand-glow))`,
                  color: `rgb(var(--brand-ink))`,
                }}
              >
                VISIT THE STOREFRONT
                <ArrowRight className="w-3.5 h-3.5" />
              </a>
              <a
                href="#lp-invitation"
                className="inline-flex items-center gap-2 rounded-full border px-5 py-2.5 transition sm:px-6 sm:py-3"
                style={{
                  borderColor: `rgb(var(--brand-glow) / 0.45)`,
                  color: `rgb(var(--brand-paper) / 0.85)`,
                }}
              >
                <Bell className="w-3.5 h-3.5" />
                HEAR FIRST WHEN WE REOPEN
              </a>
            </>
          )}
        </div>
      </main>
    </section>
  );
}
