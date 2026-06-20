import { motion, useScroll, useTransform, useMotionValue, useSpring, AnimatePresence } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useBrand } from "./BrandProvider";
import { toast } from "sonner";
import {
  Instagram, Facebook, Twitter, Youtube, MessageCircle, Check, Copy,
} from "lucide-react";
import type { SocialPlatform } from "@/lib/brands";

// Quiet countdown — opens roughly one season ahead, no precise digits.
const LAUNCH_SEASON = (() => {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() + 3, 1);
  return target.toLocaleString("en-US", { month: "long" });
})();

// Tasteful starting seat count — small enough to feel intimate, growing slowly.
const SEATS_TOTAL = 200;
const SEATS_CLAIMED_BASE = 73;

function SocialIcon({ platform, className }: { platform: SocialPlatform; className?: string }) {
  const p = { className: className ?? "w-4 h-4", strokeWidth: 1.5 };
  switch (platform) {
    case "instagram": return <Instagram {...p} />;
    case "facebook":  return <Facebook {...p} />;
    case "twitter":   return <Twitter {...p} />;
    case "youtube":   return <Youtube {...p} />;
    case "whatsapp":  return <MessageCircle {...p} />;
    case "tiktok":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={p.className}>
          <path d="M16 3v3.5a4.5 4.5 0 0 0 4.5 4.5M11 3v12.5a3.5 3.5 0 1 1-3.5-3.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      );
    case "pinterest":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={p.className}>
          <circle cx="12" cy="12" r="9"/>
          <path d="M11 8c2.5-.5 5 1 5 3.5S14 16 12.5 15.5 10.5 13 11.5 11" strokeLinecap="round"/>
          <path d="M11 11l-1.5 9" strokeLinecap="round"/>
        </svg>
      );
  }
}

function Field({
  label, type = "text", value, onChange, placeholder, delay = 0,
}: {
  label: string; type?: string; value: string;
  onChange: (v: string) => void; placeholder?: string; delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className="group relative"
    >
      <label
        className="absolute -top-2 left-4 px-2 z-10 text-[9px] uppercase tracking-[0.35em] text-[hsl(var(--brand-paper)/0.45)] group-focus-within:text-[hsl(var(--brand-accent))] transition-colors"
        style={{ background: "hsl(var(--brand-primary-deep))" }}
      >
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-white/5 border border-white/10 rounded-xl px-5 py-4 text-[hsl(var(--brand-paper))] placeholder:text-[hsl(var(--brand-paper)/0.2)] outline-none transition-all focus:border-[hsl(var(--brand-accent)/0.55)] focus:ring-1 focus:ring-[hsl(var(--brand-accent)/0.3)] focus:bg-white/[0.08]"
      />
    </motion.div>
  );
}


export function SalesLanding({ campaignName }: { campaignName?: string | null }) {
  const { brand } = useBrand();
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [name, setName] = useState("");
  const [referral, setReferral] = useState("");
  const [channel, setChannel] = useState<"email" | "whatsapp" | "both">("both");

  // Post-submit ritual state
  const [submitted, setSubmitted] = useState<null | { name: string; code: string }>(null);
  const [copied, setCopied] = useState(false);

  // Scarcity — small organic drift so the number feels alive without lying.
  const [seatsClaimed, setSeatsClaimed] = useState(SEATS_CLAIMED_BASE);
  useEffect(() => {
    const id = setInterval(() => {
      setSeatsClaimed((s) => (s < SEATS_TOTAL - 30 ? s + (Math.random() > 0.7 ? 1 : 0) : s));
    }, 12000);
    return () => clearInterval(id);
  }, []);

  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroY = useTransform(scrollYProgress, [0, 1], ["0%", "30%"]);
  const heroScale = useTransform(scrollYProgress, [0, 1], [1, 1.15]);
  const veilOpacity = useTransform(scrollYProgress, [0, 1], [0.3, 0.8]);

  // Ambient mouse parallax — slow, springy drift on the hero monogram.
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

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email && !whatsapp) {
      toast.error("Leave us a way to reach you.");
      return;
    }
    // Generate a referral code from brand + first name + 3 digits.
    const prefix = brand.name.replace(/[^A-Za-z]/g, "").slice(0, 5).toUpperCase() || "HOUSE";
    const handle = (name.trim().split(/\s+/)[0] || "FRIEND").toUpperCase().slice(0, 6);
    const code = `${prefix}-${handle}-${Math.floor(100 + Math.random() * 900)}`;
    setSubmitted({ name: name.trim() || "you", code });
    setSeatsClaimed((s) => Math.min(s + 1, SEATS_TOTAL));
  };

  const resetForm = () => {
    setSubmitted(null);
    setCopied(false);
    setEmail(""); setWhatsapp(""); setName(""); setReferral("");
  };

  const copyCode = async () => {
    if (!submitted) return;
    try {
      await navigator.clipboard.writeText(submitted.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy — long-press to select.");
    }
  };

  const waShare = submitted
    ? `https://wa.me/?text=${encodeURIComponent(
        `I just got my seat at ${brand.name}'s private launch — quiet, curated, and up to 30% off for the list. Use my code ${submitted.code} when you join: ${brand.domain}`,
      )}`
    : "#";

  return (
    <main className="brand-paper-bg brand-text min-h-screen">
      {/* HERO */}
      <section
        ref={heroRef}
        onMouseMove={onHeroMove}
        className="relative h-[100svh] overflow-hidden brand-ink-bg"
      >
        <motion.div style={{ y: heroY, scale: heroScale, x: imgX }} className="absolute inset-0">
          <motion.div style={{ y: imgY }} className="w-full h-full">
            <img src={brand.hero} alt={brand.name} className="w-full h-full object-cover" />
          </motion.div>
        </motion.div>

        {/* Ambient monogram — drifts with the cursor, quiet and slow. */}
        <motion.div
          aria-hidden
          style={{ x: monoX, y: monoY }}
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <div
            className="font-display italic text-white/[0.045] select-none leading-none"
            style={{ fontSize: "clamp(18rem, 38vw, 36rem)", letterSpacing: "-0.04em" }}
          >
            {brand.name.charAt(0)}
          </div>
        </motion.div>
        {/* Readability overlay */}
        <div
          className="absolute inset-0"
          aria-hidden
          style={{
            background: `
              radial-gradient(120% 80% at 50% 0%, transparent 0%, hsl(var(--brand-primary-deep)/0.35) 60%, hsl(var(--brand-primary-deep)/0.7) 100%),
              linear-gradient(180deg, hsl(0 0% 0% / 0.55) 0%, hsl(0 0% 0% / 0.15) 28%, hsl(0 0% 0% / 0.2) 55%, hsl(0 0% 0% / 0.85) 100%)
            `,
          }}
        />
        <motion.div style={{ opacity: veilOpacity }} aria-hidden className="absolute inset-0 bg-black/25" />

        {/* Top bar — logo restored */}
        <div className="absolute top-0 inset-x-0 z-10 flex items-center justify-between gap-4 px-5 sm:px-6 md:px-12 py-5 md:py-6">
          <a href={brand.storefront} className="flex items-center gap-3 group min-w-0">
            <img
              src={brand.logo}
              alt={brand.name}
              className="h-9 sm:h-10 md:h-12 w-auto max-w-[55vw] sm:max-w-[260px] object-contain drop-shadow-[0_2px_12px_rgba(0,0,0,0.4)] transition-transform group-hover:scale-105"
            />
          </a>
          <div className="text-[10px] tracking-[0.4em] uppercase text-white/60 hidden md:block shrink-0">
            {brand.domain}
          </div>
        </div>

        {/* Hero content */}
        <div className="relative z-10 h-full flex flex-col justify-end pb-[14vh] px-6 md:px-12 max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 1, ease: [0.22, 1, 0.36, 1] }}
            className="mb-6 inline-flex w-fit items-center gap-2 rounded-full border border-white/25 bg-white/5 backdrop-blur-md px-4 py-1.5 text-[10px] md:text-[11px] tracking-[0.35em] uppercase text-white"
          >
            <span aria-hidden className="text-base leading-none">✨</span>
            {campaignName ? `Now showing — ${campaignName}` : "Between chapters — opening soon"}
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
            className="font-display text-[clamp(2.5rem,8vw,6.5rem)] font-semibold leading-[0.92] tracking-[-0.025em] text-white max-w-4xl"
          >
            {campaignName ? (
              <>The drop <em className="italic font-light">is live.</em></>
            ) : (
              <>Quiet <em className="italic font-light">on purpose.</em></>
            )}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7, duration: 1, ease: [0.22, 1, 0.36, 1] }}
            className="mt-6 max-w-xl text-white/85 text-base md:text-lg leading-relaxed font-light"
          >
            The next chapter is being written. Doors closed for now — but the list inside hears first,
            pays less, and receives the curated gifts reserved for our earliest few. Add your name. Be
            first through the door.
          </motion.p>
          <motion.a
            href="#invitation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1, duration: 1 }}
            className="mt-10 inline-flex items-center gap-3 text-white text-xs tracking-[0.3em] uppercase group w-fit"
          >
            <span className="border-b border-white/40 pb-1 group-hover:border-white transition-colors">
              Request your invitation
            </span>
            <span aria-hidden className="transition-transform group-hover:translate-x-1">↓</span>
          </motion.a>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.4, duration: 1.2 }}
            className="mt-6 text-[10px] tracking-[0.4em] uppercase text-white/40"
          >
            <span aria-hidden className="mr-2">◦</span>
            The doors open in the season of {LAUNCH_SEASON}
          </motion.p>
        </div>
      </section>

      {/* INVITATION */}
      <section id="invitation" className="relative py-28 md:py-40 px-6 md:px-12 overflow-hidden">
        {/* ambient brand glow behind glass card */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-60"
          style={{
            background: `
              radial-gradient(60% 50% at 80% 20%, hsl(var(--brand-primary)/0.35) 0%, transparent 60%),
              radial-gradient(50% 40% at 15% 80%, hsl(var(--brand-accent)/0.25) 0%, transparent 60%)
            `,
          }}
        />
        <div className="relative max-w-6xl mx-auto grid md:grid-cols-2 gap-16 md:gap-24 items-center">
          <div>
            <div className="text-[10px] tracking-[0.4em] uppercase brand-accent mb-6 inline-flex items-center gap-2">
              <span aria-hidden>✨</span> The Inner Circle
            </div>
            <h2 className="font-display text-4xl md:text-5xl lg:text-6xl font-semibold tracking-[-0.02em] leading-[0.98]">
              Two hundred names. <em className="italic font-light">Nothing more.</em>
            </h2>
            <p className="mt-8 brand-muted text-base md:text-lg leading-relaxed max-w-md">
              Twenty-four hours of early access. Private launch pricing — up to <span className="brand-accent font-medium">30% off</span> for the list. A curated launch gift hand-selected for top orders. And for those who bring three friends with them: an additional private discount and bonus loyalty points on every purchase they make.
            </p>
            <div className="mt-10 grid grid-cols-3 gap-6">
              {[
                ["I.", "First access"],
                ["II.", "Private pricing"],
                ["III.", "Curated gifts"],
              ].map(([n, l]) => (
                <div key={n}>
                  <div className="font-display text-2xl italic brand-accent">{n}</div>
                  <div className="mt-2 text-xs tracking-wider uppercase brand-muted">{l}</div>
                </div>
              ))}
            </div>

            {/* Scarcity — quiet, organic */}
            <div className="mt-12 max-w-md">
              <div className="flex items-baseline justify-between text-[10px] tracking-[0.35em] uppercase brand-muted mb-3">
                <span>Seats claimed</span>
                <span className="brand-accent tabular-nums">
                  <motion.span
                    key={seatsClaimed}
                    initial={{ opacity: 0.4, y: -2 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6 }}
                    className="inline-block"
                  >
                    {seatsClaimed}
                  </motion.span>
                  <span className="text-[hsl(var(--brand-paper)/0.3)]"> / {SEATS_TOTAL}</span>
                </span>
              </div>
              <div className="h-px w-full bg-[hsl(var(--brand-paper)/0.08)] relative overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  whileInView={{ width: `${(seatsClaimed / SEATS_TOTAL) * 100}%` }}
                  viewport={{ once: true }}
                  animate={{ width: `${(seatsClaimed / SEATS_TOTAL) * 100}%` }}
                  transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute inset-y-0 left-0 bg-[hsl(var(--brand-accent))]"
                  style={{ boxShadow: "0 0 12px hsl(var(--brand-accent)/0.6)" }}
                />
              </div>
              <p className="mt-3 text-[11px] brand-muted italic">
                {SEATS_TOTAL - seatsClaimed} remain. We close the list at {SEATS_TOTAL}.
              </p>
            </div>
          </div>

          {/* Glassmorphic form card */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
            className="relative"
          >
            {/* Frame border glow */}
            <div
              aria-hidden
              className="absolute -inset-px rounded-3xl pointer-events-none"
              style={{
                background: `linear-gradient(140deg, hsl(var(--brand-accent)/0.6), transparent 40%, hsl(var(--brand-primary)/0.5))`,
                mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
                WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
                maskComposite: "exclude",
                WebkitMaskComposite: "xor",
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
                  transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                  className="relative rounded-[2.5rem] p-8 md:p-12 space-y-7 overflow-hidden"
                  style={{
                    background: "hsl(var(--brand-primary-deep))",
                    boxShadow: "0 40px 80px -30px hsl(var(--brand-primary-deep)/0.65), inset 0 1px 0 hsl(var(--brand-paper)/0.08)",
                  }}
                >
              {/* Soft glass overlay for depth */}
              <div
                aria-hidden
                className="absolute inset-0 pointer-events-none rounded-[2.5rem]"
                style={{
                  background: "linear-gradient(140deg, hsl(var(--brand-paper)/0.08), transparent 35%, hsl(0 0% 0% / 0.25))",
                }}
              />

              <div className="relative">
                <div className="text-[10px] tracking-[0.3em] uppercase font-medium text-[hsl(var(--brand-paper)/0.5)] mb-3">
                  Private invitation
                </div>
                <h3 className="font-display text-3xl md:text-4xl text-[hsl(var(--brand-paper))] leading-[1.1]">
                  Reserve your seat <em className="italic font-light text-[hsl(var(--brand-paper)/0.8)]">at the table.</em>
                </h3>
              </div>

              <div className="relative space-y-6">
                <Field label="Name" value={name} onChange={setName} placeholder="Julianne Moore" delay={0.1} />
                <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="julianne@studio.com" delay={0.2} />
                <Field label="WhatsApp" type="tel" value={whatsapp} onChange={setWhatsapp} placeholder="+234 7700 900000" delay={0.3} />

                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.4, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                  className="rounded-2xl border border-dashed border-[hsl(var(--brand-accent)/0.35)] bg-[hsl(var(--brand-accent)/0.05)] p-4"
                >
                  <Field label="Referral code (optional)" value={referral} onChange={setReferral} placeholder="e.g. PIXIE-ADA" />
                  <p className="mt-3 text-[10px] leading-relaxed tracking-wide text-[hsl(var(--brand-paper)/0.55)]">
                    <span className="brand-accent">✨ Invite three.</span> When three friends you refer join the list, you unlock an additional private discount at launch — and every purchase they make adds to your loyalty points.
                  </p>
                </motion.div>


                <div className="pt-1">
                  <div className="text-[10px] uppercase tracking-[0.3em] text-[hsl(var(--brand-paper)/0.4)] mb-3 px-1">
                    Notify me via
                  </div>
                  <div className="grid grid-cols-3 gap-1 p-1 bg-black/25 rounded-xl border border-white/5">
                    {(["email", "whatsapp", "both"] as const).map((c) => (
                      <button
                        type="button"
                        key={c}
                        onClick={() => setChannel(c)}
                        className={`py-2.5 text-[11px] uppercase tracking-wider rounded-lg transition-all ${
                          channel === c
                            ? "bg-[hsl(var(--brand-accent))] text-[hsl(var(--brand-primary-deep))] font-semibold shadow-inner shadow-white/20"
                            : "text-[hsl(var(--brand-paper)/0.55)] hover:text-[hsl(var(--brand-paper))]"
                        }`}
                      >
                        {c === "both" ? "Both" : c}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-2">
                  <motion.button
                    type="submit"
                    whileTap={{ scale: 0.98 }}
                    className="w-full group flex items-center justify-center gap-3 bg-[hsl(var(--brand-paper))] hover:bg-white text-[hsl(var(--brand-primary-deep))] py-5 rounded-2xl text-xs font-semibold uppercase tracking-[0.2em] shadow-xl transition-all"
                  >
                    <span>Add me to the list</span>
                    <span aria-hidden className="opacity-50 transition-transform group-hover:translate-x-1">→</span>
                  </motion.button>
                  <p className="text-center text-[hsl(var(--brand-paper)/0.3)] text-[10px] mt-6 leading-relaxed">
                    One message when doors open. A quiet inbox otherwise.
                  </p>
                </div>
              </div>
                </motion.form>
              ) : (
                <motion.div
                  key="welcome"
                  initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                  className="relative rounded-[2.5rem] p-8 md:p-12 overflow-hidden"
                  style={{
                    background: "hsl(var(--brand-primary-deep))",
                    boxShadow: "0 40px 80px -30px hsl(var(--brand-primary-deep)/0.65), inset 0 1px 0 hsl(var(--brand-paper)/0.08)",
                  }}
                >
                  <div
                    aria-hidden
                    className="absolute inset-0 pointer-events-none rounded-[2.5rem]"
                    style={{
                      background: "radial-gradient(80% 60% at 50% 0%, hsl(var(--brand-accent)/0.25), transparent 60%), linear-gradient(140deg, hsl(var(--brand-paper)/0.08), transparent 35%, hsl(0 0% 0% / 0.25))",
                    }}
                  />
                  <div className="relative text-center">
                    <motion.div
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: 0.2, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                      className="mx-auto w-16 h-16 rounded-full border border-[hsl(var(--brand-accent)/0.5)] flex items-center justify-center mb-6"
                      style={{ boxShadow: "0 0 30px hsl(var(--brand-accent)/0.35)" }}
                    >
                      <Check className="w-7 h-7 text-[hsl(var(--brand-accent))]" strokeWidth={1.5} />
                    </motion.div>
                    <div className="text-[10px] tracking-[0.35em] uppercase text-[hsl(var(--brand-accent))] mb-4">
                      Welcome to the Inner Circle
                    </div>
                    <h3 className="font-display text-3xl md:text-4xl text-[hsl(var(--brand-paper))] leading-[1.1]">
                      You're in,{" "}
                      <em className="italic font-light text-[hsl(var(--brand-paper)/0.85)]">{submitted.name}.</em>
                    </h3>
                    <p className="mt-5 text-sm md:text-base text-[hsl(var(--brand-paper)/0.6)] leading-relaxed max-w-sm mx-auto">
                      We'll knock quietly when the doors open. Until then — your private code is below. Pass it to three friends and unlock an extra layer of the launch.
                    </p>
                  </div>

                  <div className="relative mt-8">
                    <div className="text-[10px] tracking-[0.35em] uppercase text-[hsl(var(--brand-paper)/0.4)] text-center mb-3">
                      Your referral code
                    </div>
                    <button
                      type="button"
                      onClick={copyCode}
                      className="group w-full flex items-center justify-between gap-4 rounded-2xl border border-dashed border-[hsl(var(--brand-accent)/0.45)] bg-[hsl(var(--brand-accent)/0.06)] px-5 py-4 hover:bg-[hsl(var(--brand-accent)/0.1)] transition-colors"
                    >
                      <span className="font-display text-xl md:text-2xl tracking-[0.15em] text-[hsl(var(--brand-paper))]">
                        {submitted.code}
                      </span>
                      <span className="flex items-center gap-2 text-[10px] tracking-[0.3em] uppercase text-[hsl(var(--brand-paper)/0.55)] group-hover:text-[hsl(var(--brand-accent))] transition-colors">
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
                      className="w-full group flex items-center justify-center gap-3 bg-[#25D366] hover:bg-[#1ebe5a] text-white py-4 rounded-2xl text-xs font-semibold uppercase tracking-[0.2em] shadow-xl transition-all"
                    >
                      <MessageCircle className="w-4 h-4" strokeWidth={2} />
                      <span>Share on WhatsApp</span>
                    </a>
                    <button
                      type="button"
                      onClick={resetForm}
                      className="w-full text-center text-[10px] tracking-[0.3em] uppercase text-[hsl(var(--brand-paper)/0.35)] hover:text-[hsl(var(--brand-paper)/0.7)] py-2 transition-colors"
                    >
                      Add another name
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

          </motion.div>
        </div>
      </section>

      {/* GALLERY */}
      <section className="relative py-20 md:py-28 overflow-hidden">
        <div className="px-6 md:px-12 max-w-6xl mx-auto mb-12 flex items-end justify-between gap-6">
          <div>
            <div className="text-[10px] tracking-[0.4em] uppercase brand-accent mb-4 inline-flex items-center gap-2">
              <span aria-hidden>⚡</span> The Last Chapter
            </div>
            <h3 className="font-display text-3xl md:text-5xl font-semibold tracking-[-0.02em] leading-[0.98]">
              A glimpse of <em className="italic font-light">what has been.</em>
            </h3>
          </div>
        </div>

        <div className="relative group overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_8%,black_92%,transparent)]">
          <div className="flex gap-6 animate-marquee w-max group-hover:[animation-play-state:paused]">
            {brand.gallery.concat(brand.gallery).concat(brand.gallery).map((src, i) => (
              <div key={`r1-${i}`} className="relative shrink-0 w-[68vw] md:w-[380px] aspect-[4/5] overflow-hidden">
                <img src={src} alt="" className="w-full h-full object-cover" />
                <div className="absolute bottom-0 inset-x-0 p-5 bg-gradient-to-t from-black/70 to-transparent">
                  <div className="text-[10px] tracking-[0.3em] uppercase text-white/85">
                    Plate {String((i % brand.gallery.length) + 1).padStart(2, "0")}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative group overflow-hidden mt-6 [mask-image:linear-gradient(90deg,transparent,black_8%,black_92%,transparent)]">
          <div className="flex gap-6 animate-marquee-slow w-max [animation-direction:reverse] group-hover:[animation-play-state:paused]">
            {brand.gallery.slice().reverse().concat(brand.gallery).concat(brand.gallery).map((src, i) => (
              <div key={`r2-${i}`} className="relative shrink-0 w-[56vw] md:w-[300px] aspect-[3/4] overflow-hidden">
                <img src={src} alt="" className="w-full h-full object-cover" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PILLARS */}
      <section className="py-28 md:py-40 px-6 md:px-12">
        <div className="max-w-6xl mx-auto grid md:grid-cols-3 gap-12 md:gap-20">
          {[
            { n: "I.", t: "Crafted", b: "Hand-selected strands, hand-finished lace. Every cap is made for one head." },
            { n: "II.", t: "Curated", b: "Tight seasons. Few pieces. We release only what we would wear ourselves." },
            { n: "III.", t: "Limited", b: "When a chapter closes, it closes. No restocks. No second printings." },
          ].map((p) => (
            <motion.div
              key={p.t}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
              className="border-t border-[hsl(var(--brand-accent)/0.3)] pt-8"
            >
              <div className="font-display text-3xl italic brand-accent">{p.n}</div>
              <h4 className="font-display text-2xl md:text-3xl mt-2">{p.t}</h4>
              <p className="mt-4 brand-muted leading-relaxed">{p.b}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-[hsl(var(--brand-accent)/0.2)] py-16 px-6 md:px-12">
        <div className="max-w-6xl mx-auto grid md:grid-cols-3 gap-10 md:gap-16 items-start">
          {/* Brand block */}
          <div className="space-y-4">
            <img src={brand.logo} alt={brand.name} className="h-10 w-auto object-contain" />
            <p className="brand-muted text-sm leading-relaxed max-w-xs">{brand.tagline}</p>
          </div>

          {/* Address */}
          <div className="space-y-3">
            <div className="text-[10px] tracking-[0.35em] uppercase brand-accent">The Studio</div>
            <div className="font-display text-lg brand-text">{brand.legalName}</div>
            <p className="brand-muted text-sm leading-relaxed not-italic">{brand.address}</p>
          </div>

          {/* Socials */}
          <div className="space-y-4">
            <div className="text-[10px] tracking-[0.35em] uppercase brand-accent">Follow the House</div>
            <div className="flex flex-wrap gap-3">
              {brand.socials.map((s) => (
                <a
                  key={s.platform}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.label}
                  className="group relative w-11 h-11 rounded-full border border-[hsl(var(--brand-accent)/0.35)] bg-[hsl(var(--brand-paper)/0.04)] backdrop-blur-md flex items-center justify-center brand-text hover:bg-[hsl(var(--brand-primary))] hover:text-[hsl(var(--brand-paper))] hover:border-[hsl(var(--brand-primary))] hover:-translate-y-0.5 transition-all duration-300"
                >
                  <SocialIcon platform={s.platform} />
                </a>
              ))}
            </div>
            <a
              href={brand.storefront}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-[10px] tracking-[0.3em] uppercase brand-text hover:brand-accent transition-colors pt-2"
            >
              Visit the storefront <span aria-hidden>→</span>
            </a>
          </div>
        </div>

        <div className="max-w-6xl mx-auto mt-12 pt-6 border-t border-[hsl(var(--brand-accent)/0.15)] flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-[10px] tracking-[0.3em] uppercase brand-muted">
            © {new Date().getFullYear()} {brand.legalName}
          </div>
          <div className="text-[10px] tracking-[0.3em] uppercase brand-muted">{brand.domain}</div>
        </div>
      </footer>
    </main>
  );
}
