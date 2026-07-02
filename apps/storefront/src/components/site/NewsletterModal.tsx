import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { SITE_IMAGES } from "@/lib/site-assets";
import { usePopup } from "@/lib/site-config";

const KEY = "faitlyn.newsletter.seen.v1";

/**
 * "The Letter" newsletter modal (ported from the reference). Opens once per
 * session after a delay or on exit-intent. Email capture is local for now —
 * wire to the Hub newsletter/contact endpoint when available.
 */
export function NewsletterModal() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  // Studio-editable popup content (falls back to the ported defaults).
  const popup = usePopup("newsletter");
  const cfg = (popup?.content ?? {}) as {
    eyebrow?: string;
    heading?: string;
    bullets?: string[];
    cta_label?: string;
    placeholder?: string;
    image_url?: string;
  };
  const eyebrow = cfg.eyebrow ?? "The Letter";
  const heading = cfg.heading ?? "One curated note. Once a month.";
  const bullets = cfg.bullets ?? [
    "Early access to limited drops",
    "Hair education from the Lagos atelier",
    "Founder picks, no spam, ever",
  ];
  const ctaLabel = cfg.cta_label ?? "Join the list";
  const placeholder = cfg.placeholder ?? "your@email.com";
  const image = cfg.image_url ?? SITE_IMAGES.model2;
  const delayMs = (Number(popup?.trigger_value) || 25) * 1000;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(KEY)) return;
    const timer = setTimeout(() => setOpen(true), delayMs);
    const onLeave = (e: MouseEvent) => {
      if (e.clientY <= 0) {
        setOpen(true);
        cleanup();
      }
    };
    document.addEventListener("mouseleave", onLeave);
    const cleanup = () => {
      clearTimeout(timer);
      document.removeEventListener("mouseleave", onLeave);
    };
    return cleanup;
  }, []);

  const close = () => {
    setOpen(false);
    try {
      sessionStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} className="fixed inset-0 bg-ink/80 backdrop-blur-md z-[95]" />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-4 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[min(900px,92vw)] z-[96] bg-ink border border-taupe/30 grid md:grid-cols-2 overflow-hidden"
          >
            <div className="hidden md:block relative">
              <img src={image} alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-r from-transparent to-ink/40" />
            </div>
            <div className="p-8 md:p-12 flex flex-col justify-center relative">
              <button onClick={close} className="absolute top-4 right-4 text-taupe text-xs tracking-[0.3em] uppercase">Close</button>
              <p className="text-[0.65rem] tracking-[0.5em] uppercase text-taupe mb-4">{eyebrow}</p>
              <h3 className="font-display text-3xl md:text-5xl leading-tight text-balance">
                {heading}
              </h3>
              <ul className="mt-6 space-y-2 text-sm text-cream/70">
                {bullets.map((b) => (
                  <li key={b}>· {b}</li>
                ))}
              </ul>
              {sent ? (
                <p className="mt-8 text-taupe font-display text-xl">Welcome in. Check your inbox.</p>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (email) {
                      setSent(true);
                      setTimeout(close, 1800);
                    }
                  }}
                  className="mt-8 flex flex-col gap-3"
                >
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={placeholder}
                    className="bg-transparent border-b border-taupe/40 py-3 text-cream placeholder:text-cream/35 focus:outline-none focus:border-taupe text-sm"
                  />
                  <button type="submit" className="mt-2 py-4 bg-taupe text-ink text-[0.7rem] tracking-[0.4em] uppercase hover:bg-cream transition-colors">
                    {ctaLabel}
                  </button>
                </form>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
