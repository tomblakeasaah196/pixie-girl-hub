// @ts-nocheck
// Consumed as out-of-root source by BOTH apps; their bundlers resolve
// react/framer-motion/lucide-react from each app's node_modules at build time,
// but `tsc` run per app can't resolve them from packages/. The ./config
// contract (LandingConfig, withDefaults, …) stays fully type-checked.
"use client";

/**
 * LandingPreview — faithful, config-driven render of the approved "Atelier"
 * sales landing design (the Lovable reference is the UI/UX SSOT).
 *
 * Everything is driven by a LandingConfig: colours, copy, logo (+ tint),
 * hero/gallery imagery, the invitation form fields, scarcity, pillars and
 * socials. Brand colours are injected as "r g b" triplets on the root
 * wrapper and consumed via rgb(var(--brand-*) / a), so this component never
 * disturbs the surrounding admin theme.
 *
 * This is the SINGLE renderer shared by the admin Landing Studio and the
 * public sales site. The cinematic reveal is intentionally NOT rendered here
 * — the host composes <AtelierRevealPreview> as a sibling overlay so it can
 * control replay (studio) or play-once (public). The form's submit handler is
 * injected by the host (`onSubmit`): the studio runs a local success ritual,
 * the public page POSTs to the backend.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  motion,
  useScroll,
  useTransform,
  useMotionValue,
  useSpring,
  AnimatePresence,
} from "framer-motion";
import {
  Instagram,
  Facebook,
  Twitter,
  Youtube,
  MessageCircle,
  Check,
  Copy,
} from "lucide-react";
import type { LandingConfig } from "./config";
import { hexToTriplet } from "./config";

// The Atelier faces are loaded by the host app (admin index.html / landing
// layout.tsx) and exposed as --font-atelier-*; we consume them here with a
// hard fallback chain so the kit never depends on a runtime font fetch.
const DISPLAY_FONT =
  'var(--font-atelier-display, "Fraunces", "Playfair Display", Georgia, serif)';
const BODY_FONT =
  'var(--font-atelier-body, "Inter Tight", "Montserrat", system-ui, sans-serif)';

/** Spread onto every display heading. Fraunces reads as the Lovable face only
 *  at a high optical size with a hint of SOFT — this mirrors the reference's
 *  `.font-display { font-variation-settings: "opsz" 144, "SOFT" 30 }`. */
const DISPLAY = {
  fontFamily: DISPLAY_FONT,
  fontVariationSettings: '"opsz" 144, "SOFT" 30',
} as const;

/** Shared easing — the slow, settled curve the whole reference moves on. */
const EASE = [0.22, 1, 0.36, 1] as const;

/** Quiet, season-ahead launch month (≈ one quarter out) — the reference never
 *  shows precise digits. Authors write "{season}" in the hero footnote and we
 *  swap in this month, so the copy stays editable but reads live by default. */
const LAUNCH_SEASON = (() => {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() + 3, 1);
  return target.toLocaleString("en-US", { month: "long" });
})();

/** Inject the marquee keyframes once (self-contained; no Tailwind dependency). */
function usePreviewAssets() {
  useEffect(() => {
    const id = "landing-preview-keyframes";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      @keyframes lp-marquee { from { transform: translateX(0) } to { transform: translateX(-50%) } }
      .lp-marquee { animation: lp-marquee 40s linear infinite; }
      .lp-marquee-slow { animation: lp-marquee 70s linear infinite; }
      .lp-marquee-wrap:hover .lp-marquee,
      .lp-marquee-wrap:hover .lp-marquee-slow { animation-play-state: paused; }
    `;
    document.head.appendChild(style);
  }, []);
}

function SocialIcon({ platform }: { platform: string }) {
  const p = { className: "w-4 h-4", strokeWidth: 1.5 };
  switch (platform) {
    case "instagram":
      return <Instagram {...p} />;
    case "facebook":
      return <Facebook {...p} />;
    case "twitter":
      return <Twitter {...p} />;
    case "youtube":
      return <Youtube {...p} />;
    case "whatsapp":
      return <MessageCircle {...p} />;
    case "tiktok":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
          <path d="M16 3v3.5a4.5 4.5 0 0 0 4.5 4.5M11 3v12.5a3.5 3.5 0 1 1-3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "pinterest":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
          <circle cx="12" cy="12" r="9" />
          <path d="M11 8c2.5-.5 5 1 5 3.5S14 16 12.5 15.5 10.5 13 11.5 11" strokeLinecap="round" />
          <path d="M11 11l-1.5 9" strokeLinecap="round" />
        </svg>
      );
    default:
      return <MessageCircle {...p} />;
  }
}

/** Logo that can be tinted to a flat colour (CSS mask) to fix contrast
 *  clashes — e.g. an ox-blood logo on an ox-blood header recoloured cream. */
function LogoMark({
  url,
  tint,
  scale,
  alt,
  fallback,
}: {
  url: string | null;
  tint: string | null;
  scale: number;
  alt: string;
  fallback: string;
}) {
  const baseH = 44 * (scale || 1);
  if (!url) {
    return (
      <div
        style={{
          ...DISPLAY,
          fontSize: baseH * 0.5,
          letterSpacing: "0.04em",
          color: tint || "rgb(var(--brand-paper))",
          fontStyle: "italic",
        }}
      >
        {fallback}
      </div>
    );
  }
  if (tint) {
    return (
      <div
        aria-label={alt}
        style={{
          height: baseH,
          width: baseH * 4,
          maxWidth: "55vw",
          backgroundColor: tint,
          WebkitMaskImage: `url(${url})`,
          maskImage: `url(${url})`,
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskPosition: "left center",
          maskPosition: "left center",
          WebkitMaskSize: "contain",
          maskSize: "contain",
        }}
      />
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      style={{ height: baseH, width: "auto", maxWidth: "55vw", objectFit: "contain" }}
    />
  );
}

function Field({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  delay = 0,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay, duration: 0.7, ease: EASE }}
      className="group relative"
    >
      <label
        className="absolute -top-2 left-4 px-2 z-10 text-[9px] uppercase tracking-[0.35em] transition-colors"
        style={{ background: "rgb(var(--brand-primary-deep))", color: "rgb(var(--brand-paper) / 0.45)" }}
      >
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl px-5 py-4 outline-none transition-all focus:bg-white/[0.08]"
        style={{
          background: "rgb(255 255 255 / 0.05)",
          border: "1px solid rgb(255 255 255 / 0.1)",
          color: "rgb(var(--brand-paper))",
        }}
      />
    </motion.div>
  );
}

/**
 * Host-supplied submit. Receives the collected fields; returns the referral
 * code to show in the success state (studio mints one locally; the public
 * page gets it from the backend). Throwing surfaces the error line.
 */
export type LandingSubmit = (fields: {
  name: string;
  email: string;
  whatsapp: string;
  referral: string;
  channel: "email" | "whatsapp" | "both";
}) => Promise<{ code: string }>;

export function LandingPreview({
  config,
  onSubmit,
}: {
  config: LandingConfig;
  /** Optional. When omitted, the form runs the studio's local success ritual. */
  onSubmit?: LandingSubmit;
}) {
  usePreviewAssets();

  const brandVars = useMemo(
    () =>
      ({
        "--brand-ink": hexToTriplet(config.theme.ink),
        "--brand-paper": hexToTriplet(config.theme.paper),
        "--brand-primary": hexToTriplet(config.theme.primary),
        "--brand-primary-deep": hexToTriplet(config.theme.primaryDeep),
        "--brand-accent": hexToTriplet(config.theme.accent),
        "--brand-muted": hexToTriplet(config.theme.muted),
        "--brand-glow": hexToTriplet(config.theme.glow),
      }) as React.CSSProperties,
    [config.theme],
  );

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [referral, setReferral] = useState("");
  const [channel, setChannel] = useState<"email" | "whatsapp" | "both">(
    config.form.channels[0] || "both",
  );
  const [submitted, setSubmitted] = useState<null | { name: string; code: string }>(null);
  const [copied, setCopied] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const seatsTotal = config.invitation.seatsTotal || 200;
  const [seatsClaimed, setSeatsClaimed] = useState(config.invitation.seatsClaimedBase || 0);
  useEffect(() => {
    setSeatsClaimed(config.invitation.seatsClaimedBase || 0);
  }, [config.invitation.seatsClaimedBase]);
  useEffect(() => {
    const id = setInterval(() => {
      setSeatsClaimed((s) => (s < seatsTotal - 30 ? s + (Math.random() > 0.7 ? 1 : 0) : s));
    }, 12000);
    return () => clearInterval(id);
  }, [seatsTotal]);

  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroY = useTransform(scrollYProgress, [0, 1], ["0%", "30%"]);
  const heroScale = useTransform(scrollYProgress, [0, 1], [1, 1.15]);
  const veilOpacity = useTransform(scrollYProgress, [0, 1], [0.3, 0.8]);

  const mxRaw = useMotionValue(0);
  const myRaw = useMotionValue(0);
  const mx = useSpring(mxRaw, { stiffness: 40, damping: 18, mass: 0.6 });
  const my = useSpring(myRaw, { stiffness: 40, damping: 18, mass: 0.6 });
  const monoX = useTransform(mx, (v) => `${v * 18}px`);
  const monoY = useTransform(my, (v) => `${v * 18}px`);
  const imgX = useTransform(mx, (v) => `${v * -8}px`);
  const imgY = useTransform(my, (v) => `${v * -8}px`);
  const onHeroMove = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    mxRaw.set((e.clientX - r.left) / r.width - 0.5);
    myRaw.set((e.clientY - r.top) / r.height - 0.5);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (config.form.collectEmail && config.form.collectWhatsapp && !email && !whatsapp) {
      setFormError("Leave us a way to reach you.");
      return;
    }
    setSubmitting(true);
    try {
      let code: string;
      if (onSubmit) {
        ({ code } = await onSubmit({ name, email, whatsapp, referral, channel }));
      } else {
        // Studio preview: local success ritual (no network).
        const prefix = config.brandName.replace(/[^A-Za-z]/g, "").slice(0, 5).toUpperCase() || "HOUSE";
        const handle = (name.trim().split(/\s+/)[0] || "FRIEND").toUpperCase().slice(0, 6);
        code = `${prefix}-${handle}-${Math.floor(100 + Math.random() * 900)}`;
      }
      setSubmitted({ name: name.trim() || "you", code });
      setSeatsClaimed((s) => Math.min(s + 1, seatsTotal));
    } catch {
      setFormError("Something went wrong. Try again shortly.");
    } finally {
      setSubmitting(false);
    }
  };

  const copyCode = async () => {
    if (!submitted) return;
    try {
      await navigator.clipboard.writeText(submitted.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked in preview iframe — ignore */
    }
  };

  // Pre-built WhatsApp share for the success ritual — carries the new member's
  // referral code so the invite-three loop actually closes.
  const waShare = submitted
    ? `https://wa.me/?text=${encodeURIComponent(
        `I just got my seat at ${config.brandName}'s private launch — quiet, curated, and up to 30% off for the list. Use my code ${submitted.code} when you join: ${config.domain}`,
      )}`
    : "#";

  const gallery = config.gallery.length
    ? config.gallery
    : config.hero.imageUrl
      ? [{ url: config.hero.imageUrl }]
      : [];

  return (
    <main
      style={{ ...brandVars, background: "rgb(var(--brand-paper))", color: "rgb(var(--brand-primary-deep))", fontFamily: BODY_FONT, fontFeatureSettings: '"ss01", "cv11"' }}
      className="min-h-screen"
    >
      {/* ─── HERO ─── */}
      <section
        ref={heroRef}
        onMouseMove={onHeroMove}
        className="relative h-[100svh] overflow-hidden"
        style={{ background: "rgb(var(--brand-ink))" }}
      >
        {(config.hero.imageUrl || config.background.imageUrl) && (
          <motion.div style={{ y: heroY, scale: heroScale, x: imgX }} className="absolute inset-0">
            <motion.div style={{ y: imgY }} className="w-full h-full">
              <img
                src={config.hero.imageUrl || config.background.imageUrl || ""}
                alt={config.brandName}
                className="w-full h-full object-cover"
              />
            </motion.div>
          </motion.div>
        )}

        {/* Ambient monogram */}
        <motion.div aria-hidden style={{ x: monoX, y: monoY }} className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className="select-none leading-none"
            style={{ ...DISPLAY, fontStyle: "italic", color: "rgb(255 255 255 / 0.045)", fontSize: "clamp(18rem, 38vw, 36rem)", letterSpacing: "-0.04em" }}
          >
            {config.brandName.charAt(0)}
          </div>
        </motion.div>

        {/* Readability overlay */}
        <div
          className="absolute inset-0"
          aria-hidden
          style={{
            background:
              "radial-gradient(120% 80% at 50% 0%, transparent 0%, rgb(var(--brand-primary-deep)/0.35) 60%, rgb(var(--brand-primary-deep)/0.7) 100%), linear-gradient(180deg, rgb(0 0 0 / 0.55) 0%, rgb(0 0 0 / 0.15) 28%, rgb(0 0 0 / 0.2) 55%, rgb(0 0 0 / 0.85) 100%)",
          }}
        />
        <motion.div style={{ opacity: veilOpacity }} aria-hidden className="absolute inset-0 bg-black/25" />

        {/* Top bar */}
        <div className="absolute top-0 inset-x-0 z-10 flex items-center justify-between gap-4 px-5 sm:px-6 md:px-12 py-5 md:py-6">
          <a href={config.storefront} className="flex items-center gap-3 min-w-0" target="_blank" rel="noreferrer">
            <LogoMark url={config.logo.url} tint={config.logo.headerTint} scale={config.logo.headerScale} alt={config.brandName} fallback={config.brandName} />
          </a>
          <div className="text-[10px] tracking-[0.4em] uppercase text-white/60 hidden md:block shrink-0">{config.domain}</div>
        </div>

        {/* Hero content */}
        <div className="relative z-10 h-full flex flex-col justify-end pb-[14vh] px-6 md:px-12 max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 1, ease: [0.22, 1, 0.36, 1] }}
            className="mb-6 inline-flex w-fit items-center gap-2 rounded-full px-4 py-1.5 text-[10px] md:text-[11px] tracking-[0.35em] uppercase text-white"
            style={{ border: "1px solid rgb(255 255 255 / 0.25)", background: "rgb(255 255 255 / 0.05)", backdropFilter: "blur(12px)" }}
          >
            <span aria-hidden className="text-base leading-none">✨</span>
            {config.hero.eyebrow}
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
            className="text-[clamp(2.5rem,8vw,6.5rem)] font-semibold leading-[0.92] tracking-[-0.025em] text-white max-w-4xl"
            style={DISPLAY}
          >
            {config.hero.headline}{" "}
            <em className="italic font-light">{config.hero.headlineAccent}</em>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7, duration: 1, ease: [0.22, 1, 0.36, 1] }}
            className="mt-6 max-w-xl text-white/85 text-base md:text-lg leading-relaxed font-light"
          >
            {config.hero.body}
          </motion.p>
          <motion.a
            href="#lp-invitation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1, duration: 1 }}
            className="mt-10 inline-flex items-center gap-3 text-white text-xs tracking-[0.3em] uppercase group w-fit"
          >
            <span className="border-b border-white/40 pb-1 group-hover:border-white transition-colors">{config.hero.ctaLabel}</span>
            <span aria-hidden className="transition-transform group-hover:translate-x-1">↓</span>
          </motion.a>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.4, duration: 1.2 }}
            className="mt-6 text-[10px] tracking-[0.4em] uppercase text-white/40"
          >
            <span aria-hidden className="mr-2">◦</span>
            {(config.hero.launchSeasonLabel || "").replace(/\{season\}/gi, LAUNCH_SEASON)}
          </motion.p>
        </div>
      </section>

      {/* ─── INVITATION ─── */}
      <section id="lp-invitation" className="relative py-28 md:py-40 px-6 md:px-12 overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(60% 50% at 80% 20%, rgb(var(--brand-primary)/0.35) 0%, transparent 60%), radial-gradient(50% 40% at 15% 80%, rgb(var(--brand-accent)/0.25) 0%, transparent 60%)",
          }}
        />
        <div className="relative max-w-6xl mx-auto grid md:grid-cols-2 gap-16 md:gap-24 items-center">
          <div>
            <div className="text-[10px] tracking-[0.4em] uppercase mb-6 inline-flex items-center gap-2" style={{ color: "rgb(var(--brand-primary))" }}>
              <span aria-hidden>✨</span> {config.invitation.eyebrow}
            </div>
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-semibold tracking-[-0.02em] leading-[0.98]" style={DISPLAY}>
              {config.invitation.heading} <em className="italic font-light">{config.invitation.headingAccent}</em>
            </h2>
            <p className="mt-8 text-base md:text-lg leading-relaxed max-w-md" style={{ color: "rgb(var(--brand-muted))" }}>
              {config.invitation.body}
            </p>
            <div className="mt-10 grid grid-cols-3 gap-6">
              {config.invitation.perks.map((p) => (
                <div key={p.numeral}>
                  <div className="text-2xl italic" style={{ ...DISPLAY, color: "rgb(var(--brand-primary))" }}>{p.numeral}</div>
                  <div className="mt-2 text-xs tracking-wider uppercase" style={{ color: "rgb(var(--brand-muted))" }}>{p.label}</div>
                </div>
              ))}
            </div>

            {config.reveal.showScarcity && (
              <div className="mt-12 max-w-md">
                <div className="flex items-baseline justify-between text-[10px] tracking-[0.35em] uppercase mb-3" style={{ color: "rgb(var(--brand-muted))" }}>
                  <span>Seats claimed</span>
                  <span style={{ color: "rgb(var(--brand-primary))" }} className="tabular-nums">
                    <motion.span
                      key={seatsClaimed}
                      initial={{ opacity: 0.4, y: -2 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.6 }}
                      className="inline-block"
                    >
                      {seatsClaimed}
                    </motion.span>
                    <span style={{ color: "rgb(var(--brand-primary-deep)/0.3)" }}> / {seatsTotal}</span>
                  </span>
                </div>
                <div className="h-px w-full relative overflow-hidden" style={{ background: "rgb(var(--brand-primary-deep)/0.12)" }}>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(seatsClaimed / seatsTotal) * 100}%` }}
                    transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
                    className="absolute inset-y-0 left-0"
                    style={{ background: "rgb(var(--brand-accent))", boxShadow: "0 0 12px rgb(var(--brand-accent)/0.6)" }}
                  />
                </div>
                <p className="mt-3 text-[11px] italic" style={{ color: "rgb(var(--brand-muted))" }}>
                  {seatsTotal - seatsClaimed} remain. We close the list at {seatsTotal}.
                </p>
              </div>
            )}
          </div>

          {/* Glass form card */}
          <div className="relative">
            {/* Frame border glow — the accent→primary hairline that rims the card */}
            <div
              aria-hidden
              className="absolute -inset-px rounded-[2.5rem] pointer-events-none z-10"
              style={{
                background:
                  "linear-gradient(140deg, rgb(var(--brand-accent)/0.6), transparent 40%, rgb(var(--brand-primary)/0.5))",
                WebkitMask:
                  "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
                mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
                WebkitMaskComposite: "xor",
                maskComposite: "exclude",
                padding: 1,
              }}
            />
            <AnimatePresence mode="wait" initial={false}>
              {!submitted ? (
                <motion.form
                  key="form"
                  onSubmit={submit}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8, filter: "blur(6px)" }}
                  transition={{ duration: 0.5 }}
                  className="relative rounded-[2.5rem] p-8 md:p-12 space-y-7 overflow-hidden"
                  style={{ background: "rgb(var(--brand-primary-deep))", boxShadow: "0 40px 80px -30px rgb(var(--brand-primary-deep)/0.65), inset 0 1px 0 rgb(var(--brand-paper)/0.08)" }}
                >
                  <div aria-hidden className="absolute inset-0 pointer-events-none rounded-[2.5rem]" style={{ background: "linear-gradient(140deg, rgb(var(--brand-paper)/0.08), transparent 35%, rgb(0 0 0 / 0.25))" }} />
                  <div className="relative">
                    <div className="text-[10px] tracking-[0.3em] uppercase font-medium mb-3" style={{ color: "rgb(var(--brand-paper)/0.5)" }}>{config.invitation.formEyebrow}</div>
                    <h3 className="text-3xl md:text-4xl leading-[1.1]" style={{ ...DISPLAY, color: "rgb(var(--brand-paper))" }}>
                      {config.invitation.formTitle} <em className="italic font-light" style={{ color: "rgb(var(--brand-paper)/0.8)" }}>{config.invitation.formTitleAccent}</em>
                    </h3>
                  </div>

                  <div className="relative space-y-6">
                    {config.form.collectName && <Field label="Name" value={name} onChange={setName} placeholder="Julianne Moore" delay={0.1} />}
                    {config.form.collectEmail && <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="julianne@studio.com" delay={0.2} />}
                    {config.form.collectWhatsapp && <Field label="WhatsApp" type="tel" value={whatsapp} onChange={setWhatsapp} placeholder="+234 7700 900000" delay={0.3} />}

                    {config.form.collectReferral && (
                      <div className="rounded-2xl p-4" style={{ border: "1px dashed rgb(var(--brand-accent)/0.35)", background: "rgb(var(--brand-accent)/0.05)" }}>
                        <Field label="Referral code (optional)" value={referral} onChange={setReferral} placeholder="e.g. PIXIE-ADA" />
                        <p className="mt-3 text-[10px] leading-relaxed tracking-wide" style={{ color: "rgb(var(--brand-paper)/0.55)" }}>
                          <span style={{ color: "rgb(var(--brand-accent))" }}>✨ </span>{config.invitation.referralNote}
                        </p>
                      </div>
                    )}

                    {config.form.channels.length > 0 && (
                      <div className="pt-1">
                        <div className="text-[10px] uppercase tracking-[0.3em] mb-3 px-1" style={{ color: "rgb(var(--brand-paper)/0.4)" }}>Notify me via</div>
                        <div className="grid gap-1 p-1 rounded-xl" style={{ gridTemplateColumns: `repeat(${config.form.channels.length}, minmax(0, 1fr))`, background: "rgb(0 0 0 / 0.25)", border: "1px solid rgb(255 255 255 / 0.05)" }}>
                          {config.form.channels.map((c) => {
                            const active = channel === c;
                            return (
                              <button
                                type="button"
                                key={c}
                                onClick={() => setChannel(c)}
                                className="py-2.5 text-[11px] uppercase tracking-wider rounded-lg transition-all"
                                style={
                                  active
                                    ? { background: "rgb(var(--brand-accent))", color: "rgb(var(--brand-primary-deep))", fontWeight: 600 }
                                    : { color: "rgb(var(--brand-paper)/0.55)" }
                                }
                              >
                                {c === "both" ? "Both" : c}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {formError && <p className="text-[12px]" style={{ color: "rgb(var(--brand-accent))" }}>{formError}</p>}

                    <div className="pt-2">
                      <motion.button
                        type="submit"
                        disabled={submitting}
                        whileTap={{ scale: 0.98 }}
                        className="w-full group flex items-center justify-center gap-3 py-5 rounded-2xl text-xs font-semibold uppercase tracking-[0.2em] shadow-xl transition-all hover:brightness-105 disabled:opacity-70"
                        style={{ background: "rgb(var(--brand-paper))", color: "rgb(var(--brand-primary-deep))" }}
                      >
                        <span>{submitting ? "One moment…" : config.form.submitLabel}</span>
                        <span aria-hidden className="opacity-50 transition-transform group-hover:translate-x-1">→</span>
                      </motion.button>
                      <p className="text-center text-[10px] mt-6 leading-relaxed" style={{ color: "rgb(var(--brand-paper)/0.3)" }}>{config.form.footnote}</p>
                    </div>
                  </div>
                </motion.form>
              ) : (
                <motion.div
                  key="welcome"
                  initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ duration: 0.8 }}
                  className="relative rounded-[2.5rem] p-8 md:p-12 overflow-hidden"
                  style={{ background: "rgb(var(--brand-primary-deep))", boxShadow: "0 40px 80px -30px rgb(var(--brand-primary-deep)/0.65)" }}
                >
                  <div aria-hidden className="absolute inset-0 pointer-events-none rounded-[2.5rem]" style={{ background: "radial-gradient(80% 60% at 50% 0%, rgb(var(--brand-accent)/0.25), transparent 60%)" }} />
                  <div className="relative text-center">
                    <motion.div
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: 0.2, duration: 0.8, ease: EASE }}
                      className="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-6"
                      style={{ border: "1px solid rgb(var(--brand-accent)/0.5)", boxShadow: "0 0 30px rgb(var(--brand-accent)/0.35)" }}
                    >
                      <Check className="w-7 h-7" style={{ color: "rgb(var(--brand-accent))" }} strokeWidth={1.5} />
                    </motion.div>
                    <div className="text-[10px] tracking-[0.35em] uppercase mb-4" style={{ color: "rgb(var(--brand-accent))" }}>Welcome to the Inner Circle</div>
                    <h3 className="text-3xl md:text-4xl leading-[1.1]" style={{ ...DISPLAY, color: "rgb(var(--brand-paper))" }}>
                      You&apos;re in, <em className="italic font-light" style={{ color: "rgb(var(--brand-paper)/0.85)" }}>{submitted.name}.</em>
                    </h3>
                    <p className="mt-5 text-sm md:text-base leading-relaxed max-w-sm mx-auto" style={{ color: "rgb(var(--brand-paper)/0.6)" }}>
                      We&apos;ll knock quietly when the doors open. Until then — your private code is below. Pass it to three friends and unlock an extra layer of the launch.
                    </p>
                  </div>
                  <div className="relative mt-8">
                    <div className="text-[10px] tracking-[0.35em] uppercase text-center mb-3" style={{ color: "rgb(var(--brand-paper)/0.4)" }}>Your referral code</div>
                    <button
                      type="button"
                      onClick={copyCode}
                      className="w-full flex items-center justify-between gap-4 rounded-2xl px-5 py-4 transition-colors"
                      style={{ border: "1px dashed rgb(var(--brand-accent)/0.45)", background: "rgb(var(--brand-accent)/0.06)" }}
                    >
                      <span className="text-xl md:text-2xl tracking-[0.15em]" style={{ ...DISPLAY, color: "rgb(var(--brand-paper))" }}>{submitted.code}</span>
                      <span className="flex items-center gap-2 text-[10px] tracking-[0.3em] uppercase" style={{ color: "rgb(var(--brand-paper)/0.55)" }}>
                        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {copied ? "Copied" : "Copy"}
                      </span>
                    </button>
                  </div>
                  <div className="relative mt-6 space-y-3">
                    <a
                      href={waShare}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full group flex items-center justify-center gap-3 py-4 rounded-2xl text-xs font-semibold uppercase tracking-[0.2em] shadow-xl transition-all hover:brightness-105"
                      style={{ background: "#25D366", color: "#ffffff" }}
                    >
                      <MessageCircle className="w-4 h-4" strokeWidth={2} />
                      <span>Share on WhatsApp</span>
                    </a>
                    <button
                      type="button"
                      onClick={() => { setSubmitted(null); setName(""); setEmail(""); setWhatsapp(""); setReferral(""); }}
                      className="w-full text-center text-[10px] tracking-[0.3em] uppercase py-2 transition-colors"
                      style={{ color: "rgb(var(--brand-paper)/0.35)" }}
                    >
                      Add another name
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </section>

      {/* ─── GALLERY ─── */}
      {gallery.length > 0 && (
        <section className="relative py-20 md:py-28 overflow-hidden">
          <div className="px-6 md:px-12 max-w-6xl mx-auto mb-12">
            <div className="text-[10px] tracking-[0.4em] uppercase mb-4 inline-flex items-center gap-2" style={{ color: "rgb(var(--brand-primary))" }}>
              <span aria-hidden>⚡</span> {config.galleryEyebrow}
            </div>
            <h3 className="text-3xl md:text-5xl font-semibold tracking-[-0.02em] leading-[0.98]" style={DISPLAY}>{config.galleryHeading}</h3>
          </div>
          <div className="lp-marquee-wrap relative overflow-hidden" style={{ maskImage: "linear-gradient(90deg,transparent,black 8%,black 92%,transparent)", WebkitMaskImage: "linear-gradient(90deg,transparent,black 8%,black 92%,transparent)" }}>
            <div className="lp-marquee flex gap-6 w-max">
              {gallery.concat(gallery).concat(gallery).map((g, i) => (
                <div key={`r1-${i}`} className="relative shrink-0 w-[68vw] md:w-[380px] aspect-[4/5] overflow-hidden">
                  <img src={g.url} alt="" className="w-full h-full object-cover" />
                  <div className="absolute bottom-0 inset-x-0 p-5 bg-gradient-to-t from-black/70 to-transparent">
                    <div className="text-[10px] tracking-[0.3em] uppercase text-white/85">Plate {String((i % gallery.length) + 1).padStart(2, "0")}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Second row — reversed direction, slower drift (reference detail). */}
          <div className="lp-marquee-wrap relative overflow-hidden mt-6" style={{ maskImage: "linear-gradient(90deg,transparent,black 8%,black 92%,transparent)", WebkitMaskImage: "linear-gradient(90deg,transparent,black 8%,black 92%,transparent)" }}>
            <div className="lp-marquee-slow flex gap-6 w-max" style={{ animationDirection: "reverse" }}>
              {gallery.slice().reverse().concat(gallery).concat(gallery).map((g, i) => (
                <div key={`r2-${i}`} className="relative shrink-0 w-[56vw] md:w-[300px] aspect-[3/4] overflow-hidden">
                  <img src={g.url} alt="" className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ─── PILLARS ─── */}
      <section className="py-28 md:py-40 px-6 md:px-12">
        <div className="max-w-6xl mx-auto grid md:grid-cols-3 gap-12 md:gap-20">
          {config.pillars.map((p, i) => (
            <div key={`${p.numeral}-${i}`} className="pt-8" style={{ borderTop: "1px solid rgb(var(--brand-accent)/0.3)" }}>
              <div className="text-3xl italic" style={{ ...DISPLAY, color: "rgb(var(--brand-primary))" }}>{p.numeral}</div>
              <h4 className="text-2xl md:text-3xl mt-2" style={DISPLAY}>{p.title}</h4>
              {/* primary-deep @ 0.8 (not the faint --brand-muted) so the pillar
                  body copy is actually legible on the light paper background. */}
              <p className="mt-4 leading-relaxed" style={{ color: "rgb(var(--brand-primary-deep) / 0.8)" }}>{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="py-16 px-6 md:px-12" style={{ borderTop: "1px solid rgb(var(--brand-accent)/0.2)" }}>
        <div className="max-w-6xl mx-auto grid md:grid-cols-3 gap-10 md:gap-16 items-start">
          <div className="space-y-4">
            <LogoMark url={config.logo.url} tint={config.logo.footerTint} scale={config.logo.footerScale} alt={config.brandName} fallback={config.brandName} />
            <p className="text-sm leading-relaxed max-w-xs" style={{ color: "rgb(var(--brand-muted))" }}>{config.tagline}</p>
          </div>
          <div className="space-y-3">
            <div className="text-[10px] tracking-[0.35em] uppercase" style={{ color: "rgb(var(--brand-primary))" }}>The Studio</div>
            <div className="text-lg" style={{ ...DISPLAY, color: "rgb(var(--brand-primary-deep))" }}>{config.legalName}</div>
            <p className="text-sm leading-relaxed not-italic" style={{ color: "rgb(var(--brand-muted))" }}>{config.address}</p>
          </div>
          <div className="space-y-4">
            <div className="text-[10px] tracking-[0.35em] uppercase" style={{ color: "rgb(var(--brand-primary))" }}>Follow the House</div>
            <div className="flex flex-wrap gap-3">
              {config.socials.map((s) => (
                <a
                  key={s.platform}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.label || s.platform}
                  className="w-11 h-11 rounded-full flex items-center justify-center transition-all"
                  style={{ border: "1px solid rgb(var(--brand-accent)/0.35)", background: "rgb(var(--brand-paper)/0.04)", color: "rgb(var(--brand-primary-deep))" }}
                >
                  <SocialIcon platform={s.platform} />
                </a>
              ))}
            </div>
            <a href={config.storefront} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-[10px] tracking-[0.3em] uppercase pt-2" style={{ color: "rgb(var(--brand-primary-deep))" }}>
              Visit the storefront <span aria-hidden>→</span>
            </a>
          </div>
        </div>
        <div className="max-w-6xl mx-auto mt-12 pt-6 flex flex-col md:flex-row items-center justify-between gap-4" style={{ borderTop: "1px solid rgb(var(--brand-accent)/0.15)" }}>
          <div className="text-[10px] tracking-[0.3em] uppercase" style={{ color: "rgb(var(--brand-muted))" }}>© {new Date().getFullYear()} {config.legalName}</div>
          <div className="text-[10px] tracking-[0.3em] uppercase" style={{ color: "rgb(var(--brand-muted))" }}>{config.domain}</div>
        </div>
      </footer>
    </main>
  );
}
