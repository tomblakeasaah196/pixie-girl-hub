import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { bootstrapAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { NewsletterModal } from "@/components/site/NewsletterModal";
import { usePopups, type StudioPopup } from "@/lib/site-config";
import {
  alreadySeen,
  armTrigger,
  audienceOk,
  markSeen,
  needsAuth,
  readAndMarkVisit,
} from "@/lib/popup-rules";

/**
 * Storefront Studio popup renderer — the ONLY thing that opens a popup on the
 * website.
 *
 * It reads every popup the public /site endpoint returns (published +
 * is_active only, filtered server-side) and shows it from its saved content,
 * honouring the trigger / audience / frequency the operator chose in Studio.
 * The "newsletter" key renders through the bespoke <NewsletterModal/> (it has
 * an email capture form); every other key renders generically here.
 *
 * The newsletter modal used to mount itself and run its own timer, so it
 * appeared on the live site from hardcoded defaults even when its popup was
 * deactivated or absent — an operator had no way to turn it off. Routing every
 * popup through this one gate means "not published / not active" always means
 * "not on the site", and only one popup can ever be on screen at a time.
 *
 * Content shape (mirrors the Studio Popups form):
 *   heading, body, image_url, button_label, button_href, discount_code
 * Trigger: time_delay | scroll_depth | exit_intent | page_load | add_to_cart
 * Audience: all | new | returning | guest | member
 * Frequency (display_rules.frequency): once_per_session | once_per_day | every_visit
 */

type PopupContent = {
  heading?: string;
  body?: string;
  image_url?: string;
  button_label?: string;
  button_href?: string;
  discount_code?: string;
};

export function StudioPopups() {
  const popups = usePopups();
  const [openKey, setOpenKey] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || popups.length === 0) return;
    let cancelled = false;
    let opened = false;
    const cleanups: Array<() => void> = [];
    const disarm = () => cleanups.forEach((c) => c());

    (async () => {
      const returning = readAndMarkVisit();

      // Only pay for an auth round-trip when a popup actually targets sign-in.
      let signedIn = false;
      if (needsAuth(popups)) {
        try {
          signedIn = await bootstrapAuth();
        } catch {
          signedIn = false;
        }
      }
      if (cancelled) return;

      const eligible = popups.filter(
        (p) =>
          p.popup_key &&
          audienceOk(p, { returning, signedIn }) &&
          !alreadySeen(p),
      );
      if (eligible.length === 0) return;

      // First trigger to fire wins; one popup on screen at a time.
      const fire = (popup: StudioPopup) => {
        if (cancelled || opened) return;
        opened = true;
        markSeen(popup);
        setOpenKey(popup.popup_key ?? null);
        disarm();
      };

      for (const popup of eligible) {
        cleanups.push(armTrigger(popup, () => fire(popup)));
      }
    })();

    return () => {
      cancelled = true;
      disarm();
    };
  }, [popups]);

  const active = popups.find((p) => p.popup_key === openKey) || null;
  const close = () => setOpenKey(null);

  return (
    <AnimatePresence>
      {active ? (
        active.popup_key === "newsletter" ? (
          <NewsletterModal
            key={active.popup_key}
            popup={active}
            onClose={close}
          />
        ) : (
          <StudioPopupModal
            key={active.popup_key}
            popup={active}
            onClose={close}
          />
        )
      ) : null}
    </AnimatePresence>
  );
}

function StudioPopupModal({
  popup,
  onClose,
}: {
  popup: StudioPopup;
  onClose: () => void;
}) {
  const c = (popup.content ?? {}) as PopupContent;
  const [copied, setCopied] = useState(false);

  const heading = c.heading?.trim();
  const body = c.body?.trim();
  const image = c.image_url?.trim();
  const label = c.button_label?.trim();
  const href = c.button_href?.trim();
  const code = c.discount_code?.trim();

  // Nothing to show → don't trap the screen behind an empty overlay.
  if (!heading && !body && !image && !(label && href) && !code) return null;

  const copyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the code is on screen to copy by hand */
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[95] bg-ink/80 backdrop-blur-md"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        role="dialog"
        aria-modal="true"
        className={cn(
          "fixed inset-4 z-[96] overflow-hidden border border-taupe/30 bg-ink md:inset-auto md:left-1/2 md:top-1/2 md:w-[min(900px,92vw)] md:-translate-x-1/2 md:-translate-y-1/2 rounded-lg",
          image ? "md:grid md:grid-cols-2" : "",
        )}
      >
        {image ? (
          <>
            <div className="absolute inset-0 md:hidden">
              <img src={image} alt="" className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-ink/60" />
            </div>
            <div className="relative hidden md:block">
              <img src={image} alt="" className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-r from-transparent to-ink/40" />
            </div>
          </>
        ) : null}
        <div className="relative z-10 flex flex-col justify-center p-8 md:p-12">
          <button
            onClick={onClose}
            className="absolute right-4 top-4 text-xs uppercase tracking-[0.3em] text-taupe hover:text-cream"
          >
            Close
          </button>
          {heading ? (
            <h3 className="text-balance font-display text-3xl leading-tight md:text-5xl">
              {heading}
            </h3>
          ) : null}
          {body ? (
            <p className="mt-6 text-sm leading-relaxed text-cream/70">{body}</p>
          ) : null}
          {code ? (
            <button
              type="button"
              onClick={copyCode}
              className="mt-6 flex items-center gap-3 self-start border border-dashed border-taupe/50 px-4 py-2 transition-colors hover:border-taupe rounded-sm"
            >
              <span className="font-mono text-sm tracking-[0.2em] text-cream">
                {code}
              </span>
              <span className="text-[0.6rem] uppercase tracking-[0.3em] text-taupe">
                {copied ? "Copied" : "Tap to copy"}
              </span>
            </button>
          ) : null}
          {label && href ? (
            <a
              href={href}
              onClick={onClose}
              className="mt-8 self-start bg-taupe px-8 py-4 text-[0.7rem] uppercase tracking-[0.4em] text-ink transition-colors hover:bg-cream rounded-lg"
            >
              {label}
            </a>
          ) : null}
        </div>
      </motion.div>
    </>
  );
}
