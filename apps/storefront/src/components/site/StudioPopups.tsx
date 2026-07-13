import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { bootstrapAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { usePopups, type StudioPopup } from "@/lib/site-config";

/**
 * Generic Storefront Studio popup renderer.
 *
 * The website used to render only the bespoke <NewsletterModal/> (keyed to the
 * "newsletter" popup), so any OTHER popup an operator built in Studio — e.g.
 * an "AI Stylist" promo — was saved, published and returned by /site but never
 * shown. This component reads EVERY published popup and displays it from its
 * saved content, honouring the trigger / audience / frequency the operator
 * chose. The "newsletter" key is left to its dedicated component.
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

// Fired by lib/useStore.notifyCartChanged() whenever the bag changes — the
// closest signal the storefront has to "added to cart".
const CART_CHANGED_EVENT = "sf:cart-changed";
// Set on the first-ever visit so `new` matches only then and `returning` after.
const VISITED_KEY = "sf_visited.v1";
const seenKey = (key: string) => `sf_popup_seen_${key}`;

function frequencyOf(popup: StudioPopup): string {
  return (popup.display_rules?.frequency as string) || "once_per_session";
}

// Frequency gate — has this popup already been shown within its window?
function alreadySeen(popup: StudioPopup): boolean {
  const key = popup.popup_key;
  if (!key) return true;
  try {
    const freq = frequencyOf(popup);
    if (freq === "every_visit") return false;
    if (freq === "once_per_day") {
      const today = new Date().toISOString().slice(0, 10);
      return window.localStorage.getItem(seenKey(key)) === today;
    }
    return window.sessionStorage.getItem(seenKey(key)) === "1"; // once_per_session
  } catch {
    return false; // storage blocked → don't suppress the popup
  }
}

function markSeen(popup: StudioPopup): void {
  const key = popup.popup_key;
  if (!key) return;
  try {
    const freq = frequencyOf(popup);
    if (freq === "every_visit") return;
    if (freq === "once_per_day") {
      window.localStorage.setItem(seenKey(key), new Date().toISOString().slice(0, 10));
    } else {
      window.sessionStorage.setItem(seenKey(key), "1");
    }
  } catch {
    /* storage blocked — nothing to persist */
  }
}

function audienceOk(
  popup: StudioPopup,
  ctx: { returning: boolean; signedIn: boolean },
): boolean {
  switch (popup.audience) {
    case "new":
      return !ctx.returning;
    case "returning":
      return ctx.returning;
    case "guest":
      return !ctx.signedIn;
    case "member":
      return ctx.signedIn;
    case "all":
    default:
      return true;
  }
}

/**
 * Arm a popup's trigger. Calls `fire` once the condition is met and returns a
 * cleanup that removes any listener/timer.
 */
function armTrigger(popup: StudioPopup, fire: () => void): () => void {
  const type = popup.trigger_type || "time_delay";
  const value = Number(popup.trigger_value) || 0;

  if (type === "scroll_depth") {
    const threshold = value > 0 ? value : 40; // percent of page scrolled
    const onScroll = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const pct = max > 0 ? (window.scrollY / max) * 100 : 100;
      if (pct >= threshold) fire();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    // A short page may already be past the threshold — check once, but on the
    // next tick so every trigger is armed (and disarmable) before any can fire.
    const initial = window.setTimeout(onScroll, 0);
    return () => {
      window.clearTimeout(initial);
      window.removeEventListener("scroll", onScroll);
    };
  }

  if (type === "exit_intent") {
    const onLeave = (e: MouseEvent) => {
      if (e.clientY <= 0) fire();
    };
    document.addEventListener("mouseleave", onLeave);
    return () => document.removeEventListener("mouseleave", onLeave);
  }

  if (type === "add_to_cart") {
    window.addEventListener(CART_CHANGED_EVENT, fire);
    return () => window.removeEventListener(CART_CHANGED_EVENT, fire);
  }

  // time_delay & page_load → a timer. page_load shows shortly after paint when
  // no delay is set; time_delay defaults to a gentle 5s.
  const secs = value > 0 ? value : type === "page_load" ? 0.6 : 5;
  const timer = window.setTimeout(fire, secs * 1000);
  return () => window.clearTimeout(timer);
}

export function StudioPopups() {
  const allPopups = usePopups();
  // The bespoke NewsletterModal owns the "newsletter" popup; render the rest.
  const popups = useMemo(
    () => allPopups.filter((p) => p.popup_key && p.popup_key !== "newsletter"),
    [allPopups],
  );
  const [openKey, setOpenKey] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || popups.length === 0) return;
    let cancelled = false;
    let opened = false;
    const cleanups: Array<() => void> = [];
    const disarm = () => cleanups.forEach((c) => c());

    (async () => {
      let returning = false;
      try {
        returning = window.localStorage.getItem(VISITED_KEY) === "1";
        window.localStorage.setItem(VISITED_KEY, "1");
      } catch {
        /* storage blocked — treat as a new visitor */
      }

      // Only pay for an auth round-trip when a popup actually targets sign-in.
      const needsAuth = popups.some(
        (p) => p.audience === "guest" || p.audience === "member",
      );
      let signedIn = false;
      if (needsAuth) {
        try {
          signedIn = await bootstrapAuth();
        } catch {
          signedIn = false;
        }
      }
      if (cancelled) return;

      const eligible = popups.filter(
        (p) => audienceOk(p, { returning, signedIn }) && !alreadySeen(p),
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

  return (
    <AnimatePresence>
      {active ? (
        <StudioPopupModal
          key={active.popup_key}
          popup={active}
          onClose={() => setOpenKey(null)}
        />
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
