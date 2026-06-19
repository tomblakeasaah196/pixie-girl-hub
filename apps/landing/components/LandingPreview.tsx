"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { motion, useScroll, useTransform, useMotionValue, useSpring, AnimatePresence } from "framer-motion";
import {
  Instagram,
  Facebook,
  Twitter,
  Youtube,
  MessageCircle,
  Check,
  Copy,
} from "lucide-react";
import type { LandingConfig } from "@/lib/types";
import { hexToTriplet } from "@/lib/types";
import { AtelierRevealPreview } from "@/components/AtelierRevealPreview";

const DISPLAY_FONT = '"Fraunces", "Playfair Display", Georgia, serif';
const BODY_FONT = '"Inter Tight", "Montserrat", system-ui, sans-serif';

function usePreviewAssets() {
  useEffect(() => {
    const id = "landing-preview-assets";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,300&family=Inter+Tight:wght@300;400;500;600;700&display=swap";
    document.head.appendChild(link);

    const style = document.createElement("style");
    style.id = "landing-preview-keyframes";
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

function LogoMark({ url, tint, scale = 1, alt, fallback }: { url?: string | null; tint?: string | null; scale?: number; alt: string; fallback: string }) {
  if (!url) return <span className="text-[13px] font-semibold">{fallback}</span>;
  return (
    <img
      src={url}
      alt={alt}
      style={{
        maxHeight: `${3.5 * scale}rem`,
        WebkitMaskImage: tint ? "url(#mask)" : undefined,
        maskImage: tint ? "url(#mask)" : undefined,
        backgroundColor: tint || undefined,
        mixBlendMode: tint ? "overlay" : undefined,
      }}
      className="max-w-[280px] object-contain"
    />
  );
}

export function LandingPreview({ config }: { config: LandingConfig }) {
  usePreviewAssets();

  const brandVars = useMemo(
    () => ({
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
  const [channel, setChannel] = useState<"email" | "whatsapp" | "both">(
    config.form.channels[0] || "both",
  );
  const [submitted, setSubmitted] = useState<null | { name: string; code: string }>(null);
  const [copied, setCopied] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

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

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (config.form.collectEmail && config.form.collectWhatsapp && !email && !whatsapp) {
      setFormError("Leave us a way to reach you.");
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/public/landing/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, whatsapp, name, channel }),
      });

      if (!response.ok) {
        throw new Error(`Failed to submit: ${response.status}`);
      }

      const result = await response.json();
      setSubmitted({ name: name.trim() || "you", code: result.data.code });
      setSeatsClaimed((s) => Math.min(s + 1, seatsTotal));
    } catch (err) {
      setFormError("Something went wrong. Try again shortly.");
      console.error("Form submission error:", err);
    } finally {
      setIsLoading(false);
    }
  }, [email, whatsapp, name, channel, config.form, seatsTotal]);

  const copyCode = async () => {
    if (!submitted) return;
    try {
      await navigator.clipboard.writeText(submitted.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  const gallery = config.gallery.length
    ? config.gallery
    : config.hero.imageUrl
      ? [{ url: config.hero.imageUrl }]
      : [];

  return (
    <main
      style={{ ...brandVars, background: "rgb(var(--brand-paper))", color: "rgb(var(--brand-primary-deep))", fontFamily: BODY_FONT }}
      className="min-h-screen"
    >
      {config.reveal.enabled && (
        <AtelierRevealPreview config={config} replayKey="landing-reveal" />
      )}

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

        <motion.div aria-hidden style={{ x: monoX, y: monoY }} className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className="select-none leading-none"
            style={{ fontFamily: DISPLAY_FONT, fontStyle: "italic", color: "rgb(255 255 255 / 0.045)", fontSize: "clamp(18rem, 38vw, 36rem)", letterSpacing: "-0.04em" }}
          >
            {config.brandName.charAt(0)}
          </div>
        </motion.div>

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
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-3xl mb-6 text-5xl md:text-7xl leading-tight tracking-tight text-white"
            style={{ fontFamily: DISPLAY_FONT }}
          >
            {config.hero.headline}{" "}
            <span style={{ color: "rgb(var(--brand-accent))", fontStyle: "italic" }}>
              {config.hero.headlineAccent}
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-xl text-base md:text-lg text-white/80 leading-relaxed mb-8"
          >
            {config.hero.body}
          </motion.p>

          <motion.a
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            href="#form"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-medium text-white"
            style={{ background: "rgb(var(--brand-accent))", color: "rgb(var(--brand-ink))" }}
          >
            {config.hero.ctaLabel}
            <span aria-hidden>↓</span>
          </motion.a>
        </div>
      </section>

      {/* ─── INVITATION FORM ─── */}
      <section id="form" className="relative py-20 md:py-24 px-6 md:px-12">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-12 md:gap-20">
            {/* Left: copy */}
            <div className="md:col-span-2">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.7 }}
              >
                <div className="text-[10px] tracking-[0.35em] uppercase mb-3" style={{ color: "rgb(var(--brand-accent))" }}>
                  {config.invitation.formEyebrow}
                </div>
                <h2 className="text-3xl md:text-4xl leading-tight tracking-tight mb-6" style={{ fontFamily: DISPLAY_FONT }}>
                  {config.invitation.formTitle}{" "}
                  <span style={{ color: "rgb(var(--brand-accent))" }}>
                    {config.invitation.formTitleAccent}
                  </span>
                </h2>
                <p className="text-base leading-relaxed text-[rgb(var(--text-muted))]">
                  {config.invitation.body}
                </p>

                {/* Scarcity bar */}
                {config.reveal.showScarcity && (
                  <div className="mt-8">
                    <div className="flex items-baseline justify-between mb-2">
                      <div className="text-[12px] tracking-[0.2em] uppercase">Seats claimed</div>
                      <div className="text-sm font-medium">{seatsClaimed} / {seatsTotal}</div>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgb(var(--brand-primary) / 0.1)" }}>
                      <motion.div
                        className="h-full"
                        style={{ background: "rgb(var(--brand-accent))", width: `${Math.min(100, (seatsClaimed / seatsTotal) * 100)}%` }}
                        transition={{ type: "spring", stiffness: 100, damping: 30 }}
                      />
                    </div>
                  </div>
                )}
              </motion.div>
            </div>

            {/* Right: form card */}
            <div className="md:col-span-3">
              <motion.form
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.7, delay: 0.2 }}
                onSubmit={submit}
                className="space-y-4 p-6 md:p-8 rounded-2xl"
                style={{
                  background: "rgb(var(--brand-paper))",
                  border: "1px solid rgb(var(--brand-primary) / 0.1)",
                  backdropFilter: "blur(12px)",
                }}
              >
                {config.form.collectName && (
                  <input
                    type="text"
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg text-sm"
                    style={{
                      background: "rgb(var(--brand-primary) / 0.04)",
                      border: "1px solid rgb(var(--brand-primary) / 0.12)",
                      color: "rgb(var(--brand-primary))",
                    }}
                  />
                )}

                {config.form.collectEmail && (
                  <input
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg text-sm"
                    style={{
                      background: "rgb(var(--brand-primary) / 0.04)",
                      border: "1px solid rgb(var(--brand-primary) / 0.12)",
                      color: "rgb(var(--brand-primary))",
                    }}
                  />
                )}

                {config.form.collectWhatsapp && (
                  <input
                    type="tel"
                    placeholder="+234 123 4567"
                    value={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg text-sm"
                    style={{
                      background: "rgb(var(--brand-primary) / 0.04)",
                      border: "1px solid rgb(var(--brand-primary) / 0.12)",
                      color: "rgb(var(--brand-primary))",
                    }}
                  />
                )}

                {config.form.channels.length > 1 && (
                  <select
                    value={channel}
                    onChange={(e) => setChannel(e.target.value as "email" | "whatsapp" | "both")}
                    className="w-full px-4 py-3 rounded-lg text-sm"
                    style={{
                      background: "rgb(var(--brand-primary) / 0.04)",
                      border: "1px solid rgb(var(--brand-primary) / 0.12)",
                      color: "rgb(var(--brand-primary))",
                    }}
                  >
                    {config.form.channels.includes("email") && <option value="email">Email</option>}
                    {config.form.channels.includes("whatsapp") && <option value="whatsapp">WhatsApp</option>}
                    {config.form.channels.includes("both") && <option value="both">Either</option>}
                  </select>
                )}

                {formError && (
                  <p className="text-sm" style={{ color: "rgb(var(--brand-glow))" }}>
                    {formError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3 rounded-lg font-semibold text-sm transition-opacity"
                  style={{
                    background: "rgb(var(--brand-accent))",
                    color: "rgb(var(--brand-ink))",
                    opacity: isLoading ? 0.7 : 1,
                  }}
                >
                  {isLoading ? "Adding..." : config.form.submitLabel}
                </button>

                <p className="text-[12px] text-center" style={{ color: "rgb(var(--brand-muted))" }}>
                  {config.form.footnote}
                </p>
              </motion.form>

              {/* Success state */}
              <AnimatePresence>
                {submitted && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="absolute inset-0 flex items-center justify-center p-6 rounded-2xl"
                    style={{ background: "rgb(var(--brand-paper))", backdropFilter: "blur(12px)" }}
                  >
                    <div className="text-center max-w-sm">
                      <div className="mb-6 flex justify-center">
                        <div
                          className="w-16 h-16 rounded-full flex items-center justify-center"
                          style={{ background: "rgb(var(--brand-accent) / 0.2)" }}
                        >
                          <Check className="w-8 h-8" style={{ color: "rgb(var(--brand-accent))" }} />
                        </div>
                      </div>
                      <h3 className="text-xl font-semibold mb-2">Welcome, {submitted.name}</h3>
                      <p className="text-sm text-[rgb(var(--text-muted))] mb-6">{config.invitation.referralNote}</p>
                      <div className="flex items-center gap-2 p-4 rounded-lg mb-6" style={{ background: "rgb(var(--brand-primary) / 0.04)" }}>
                        <code className="text-sm font-mono flex-1">{submitted.code}</code>
                        <button
                          onClick={copyCode}
                          className="p-2 rounded hover:bg-[rgb(var(--brand-primary)/0.1)] transition-colors"
                        >
                          {copied ? (
                            <Check className="w-4 h-4" style={{ color: "rgb(var(--brand-accent))" }} />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </section>

      {/* ─── GALLERY ─── */}
      {gallery.length > 0 && (
        <section className="py-20 md:py-24 px-6 md:px-12 border-t" style={{ borderColor: "rgb(var(--brand-primary) / 0.1)" }}>
          <div className="max-w-6xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.7 }}
              className="mb-12"
            >
              <div className="text-[10px] tracking-[0.35em] uppercase mb-3" style={{ color: "rgb(var(--brand-accent))" }}>
                {config.galleryEyebrow}
              </div>
              <h2 className="text-3xl md:text-4xl leading-tight" style={{ fontFamily: DISPLAY_FONT }}>
                {config.galleryHeading}
              </h2>
            </motion.div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {gallery.map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-100px" }}
                  transition={{ duration: 0.7, delay: i * 0.1 }}
                  className="aspect-square rounded-xl overflow-hidden group"
                >
                  <img
                    src={item.url}
                    alt={item.caption || `Gallery item ${i + 1}`}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ─── PILLARS ─── */}
      {config.pillars.length > 0 && (
        <section className="py-20 md:py-24 px-6 md:px-12 border-t" style={{ borderColor: "rgb(var(--brand-primary) / 0.1)" }}>
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
              {config.pillars.map((pillar, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-100px" }}
                  transition={{ duration: 0.7, delay: i * 0.1 }}
                >
                  <div className="text-3xl font-light mb-3" style={{ color: "rgb(var(--brand-accent))" }}>
                    {pillar.numeral}
                  </div>
                  <h3 className="text-xl font-semibold mb-3" style={{ fontFamily: DISPLAY_FONT }}>
                    {pillar.title}
                  </h3>
                  <p className="text-sm text-[rgb(var(--text-muted))] leading-relaxed">
                    {pillar.body}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ─── FOOTER ─── */}
      <footer className="py-12 px-6 md:px-12 border-t" style={{ borderColor: "rgb(var(--brand-primary) / 0.1)" }}>
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center mb-8">
            <div>
              <LogoMark url={config.logo.url} tint={config.logo.footerTint} scale={config.logo.footerScale} alt={config.brandName} fallback={config.brandName} />
            </div>
            <div className="flex items-center justify-end gap-4">
              {config.socials.map((social, i) => (
                <a
                  key={i}
                  href={social.href}
                  target="_blank"
                  rel="noreferrer"
                  className="p-3 rounded-lg transition-opacity hover:opacity-70"
                  style={{ background: "rgb(var(--brand-primary) / 0.08)" }}
                  title={social.label}
                >
                  <SocialIcon platform={social.platform} />
                </a>
              ))}
            </div>
          </div>
          <div className="text-center text-[12px] text-[rgb(var(--text-muted))]">
            <p>{config.address}</p>
            <p className="mt-2">&copy; {new Date().getFullYear()} {config.legalName}. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
