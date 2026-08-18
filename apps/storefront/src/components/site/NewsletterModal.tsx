import { motion } from "motion/react";
import { useState } from "react";
import { SITE_IMAGES } from "@/lib/site-assets";
import type { StudioPopup } from "@/lib/site-config";
import { subscribeNewsletter } from "@/lib/storefront";

/**
 * "The Letter" newsletter modal — the bespoke presentation of the popup whose
 * popup_key is "newsletter" (it captures an email; the generic Studio popup
 * only shows content + a CTA).
 *
 * This component is PRESENTATIONAL ONLY. It does not decide whether it shows:
 * <StudioPopups/> owns the trigger / audience / frequency gate and mounts this
 * with the popup that fired. That matters — it used to mount itself, run its
 * own timer and fall back to hardcoded copy, so it appeared on the live site
 * even when the operator had deactivated (or never published) the popup, and
 * there was no way to switch it off from Storefront Studio.
 *
 * Copy comes from the popup's `content`. Studio's Popups form writes the
 * canonical keys (heading / body / image_url / button_label); the seeded row
 * additionally carries newsletter-only extras (eyebrow / bullets / placeholder)
 * that the generic form does not expose. Both are read, canonical keys first,
 * so whatever an operator types in Studio actually renders.
 */

type NewsletterContent = {
  // Canonical Studio Popups form fields.
  heading?: string;
  body?: string;
  image_url?: string;
  button_label?: string;
  // Newsletter-only extras (seeded; not in the generic form).
  eyebrow?: string;
  bullets?: string[];
  cta_label?: string;
  placeholder?: string;
};

export function NewsletterModal({
  popup,
  onClose,
}: {
  popup: StudioPopup;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const cfg = (popup.content ?? {}) as NewsletterContent;
  const eyebrow = cfg.eyebrow?.trim() || "The Letter";
  const heading = cfg.heading?.trim() || "One curated note. Once a month.";
  const body = cfg.body?.trim();
  const bullets = Array.isArray(cfg.bullets)
    ? cfg.bullets.filter((b) => typeof b === "string" && b.trim())
    : [];
  const ctaLabel =
    cfg.button_label?.trim() || cfg.cta_label?.trim() || "Join the list";
  const placeholder = cfg.placeholder?.trim() || "your@email.com";
  const image = cfg.image_url?.trim() || SITE_IMAGES.model2;

  const close = () => {
    setEmail("");
    onClose();
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={close}
        className="fixed inset-0 bg-ink/80 backdrop-blur-md z-[95]"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        role="dialog"
        aria-modal="true"
        className="fixed inset-4 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[min(900px,92vw)] z-[96] bg-ink border border-taupe/30 md:grid md:grid-cols-2 overflow-hidden rounded-lg"
      >
        <div className="absolute inset-0 md:hidden">
          <img src={image} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-ink/60" />
        </div>
        <div className="hidden md:block relative">
          <img src={image} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-transparent to-ink/40" />
        </div>
        <div className="relative z-10 p-8 md:p-12 flex flex-col justify-center">
          <button onClick={close} className="absolute top-4 right-4 text-taupe text-xs tracking-[0.3em] uppercase">Close</button>
          <p className="text-[0.65rem] tracking-[0.5em] uppercase text-taupe mb-4">{eyebrow}</p>
          <h3 className="font-display text-3xl md:text-5xl leading-tight text-balance">
            {heading}
          </h3>
          {body ? (
            <p className="mt-6 text-sm leading-relaxed text-cream/70">{body}</p>
          ) : null}
          {bullets.length > 0 ? (
            <ul className="mt-6 space-y-2 text-sm text-cream/70">
              {bullets.map((b) => (
                <li key={b}>· {b}</li>
              ))}
            </ul>
          ) : null}
          {sent ? (
            <p className="mt-8 text-taupe font-display text-xl">Welcome in. Check your inbox.</p>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!email) return;
                // Persist to the Hub as a website lead; still thank them if
                // it's a duplicate or the request hiccups.
                try {
                  await subscribeNewsletter(email);
                } catch {
                  /* best-effort */
                }
                setSent(true);
                setTimeout(close, 1800);
              }}
              className="mt-8 flex flex-col gap-3"
            >
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={placeholder}
                className="bg-transparent border-b border-taupe/40 py-3 text-cream placeholder:text-cream/35 focus:outline-none focus:border-taupe text-sm rounded-sm"
              />
              <button type="submit" className="mt-2 py-4 bg-taupe text-ink text-[0.7rem] tracking-[0.4em] uppercase hover:bg-cream transition-colors rounded-lg">
                {ctaLabel}
              </button>
            </form>
          )}
        </div>
      </motion.div>
    </>
  );
}
