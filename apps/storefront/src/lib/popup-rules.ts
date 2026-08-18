/**
 * Storefront Studio popup rules — the single trigger / audience / frequency
 * engine every popup on the website goes through.
 *
 * It lives here rather than inside a component because the site renders two
 * different popup *presentations* (the bespoke newsletter capture and the
 * generic Studio popup), and they must share one gate. When the newsletter
 * modal owned its own timer it rendered unconditionally from hardcoded
 * defaults — so a popup that was deactivated (or deleted) in Studio kept
 * showing on the live site, and its trigger_type was ignored entirely.
 *
 * Only PUBLISHED + is_active popups ever reach the browser: the public
 * /site endpoint filters them server-side. Anything in this module therefore
 * assumes "the operator wants this popup live" and only decides *when*.
 */

import type { StudioPopup } from "./site-config";

// Fired by lib/useStore.notifyCartChanged() whenever the bag changes — the
// closest signal the storefront has to "added to cart".
export const CART_CHANGED_EVENT = "sf:cart-changed";
// Set on the first-ever visit so `new` matches only then and `returning` after.
const VISITED_KEY = "sf_visited.v1";
const seenKey = (key: string) => `sf_popup_seen_${key}`;

export type VisitorContext = { returning: boolean; signedIn: boolean };

function frequencyOf(popup: StudioPopup): string {
  return (popup.display_rules?.frequency as string) || "once_per_session";
}

/** Frequency gate — has this popup already been shown within its window? */
export function alreadySeen(popup: StudioPopup): boolean {
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

export function markSeen(popup: StudioPopup): void {
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

export function audienceOk(popup: StudioPopup, ctx: VisitorContext): boolean {
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
 * Read (and set) the first-visit marker. Called once per mount, before any
 * trigger is armed, so `new` vs `returning` is decided consistently for every
 * popup in the batch.
 */
export function readAndMarkVisit(): boolean {
  try {
    const returning = window.localStorage.getItem(VISITED_KEY) === "1";
    window.localStorage.setItem(VISITED_KEY, "1");
    return returning;
  } catch {
    return false; // storage blocked — treat as a new visitor
  }
}

/**
 * Arm a popup's trigger. Calls `fire` once the condition is met and returns a
 * cleanup that removes any listener/timer.
 */
export function armTrigger(popup: StudioPopup, fire: () => void): () => void {
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

/** Does this popup need an auth round-trip to decide its audience? */
export function needsAuth(popups: StudioPopup[]): boolean {
  return popups.some((p) => p.audience === "guest" || p.audience === "member");
}
