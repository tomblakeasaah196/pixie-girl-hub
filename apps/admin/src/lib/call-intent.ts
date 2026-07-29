/**
 * A tapped "Answer" that has to survive the app booting from scratch.
 *
 * State 3 in full: the device is signed out, a customer calls, the push
 * notification arrives, the agent taps Answer. The service worker can only
 * open a URL — it holds no access token — so the intent rides in the query
 * string (`?answer_call=<id>`). But between that URL and a mounted CallLayer
 * sit a boot splash, a `<Navigate to="/login">` that keeps only the pathname,
 * a login form, and (for multi-brand users) an entity picker. The query string
 * does not survive that journey.
 *
 * So the intent is lifted out of the URL the instant the bundle loads — before
 * React renders and therefore before any redirect can drop it — and parked in
 * sessionStorage. CallLayer claims it once it mounts, whether that is 200 ms
 * later (already signed in) or 40 s later (typed a password first).
 *
 * sessionStorage, not localStorage: this belongs to one tab's boot, and it must
 * never be replayed in a different window tomorrow.
 *
 * The TTL is what stops a stale intent doing something rude. A ring is dead
 * within ~30 s and the server settles it by 120 s; if the agent took longer
 * than TTL_MS to sign in, the honest outcome is "that call is over" rather than
 * auto-answering a call that no longer exists.
 */

const KEY = "pgh_call_intent";
const TTL_MS = 120_000;

export interface CallIntent {
  call_id: string;
  intent: "answer" | "decline";
  /** epoch ms the intent was captured. */
  at: number;
}

function write(intent: CallIntent) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(intent));
  } catch {
    /* private mode / storage disabled — the in-URL path still works */
  }
}

/**
 * Read and clear the pending intent. Returns null when there is none, or when
 * the one on file is older than the TTL (which is also cleared, so a stale
 * intent can't linger for the next boot).
 */
export function takeCallIntent(): CallIntent | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(KEY);
    if (raw) sessionStorage.removeItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CallIntent;
    if (!parsed?.call_id) return null;
    if (parsed.intent !== "answer" && parsed.intent !== "decline") return null;
    if (!Number.isFinite(parsed.at) || Date.now() - parsed.at > TTL_MS) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Park an intent for CallLayer to pick up (used by the capture below). */
export function stashCallIntent(
  call_id: string,
  intent: "answer" | "decline",
): void {
  write({ call_id, intent, at: Date.now() });
}

/**
 * Drop any parked intent. Called the moment an intent is acted on live, so the
 * two delivery paths (postMessage into a running page, and the stash) can never
 * both fire for one tap — and so a stale intent can't be replayed by a
 * CallLayer that remounts later in the same tab (e.g. after signing out and
 * back in).
 */
export function clearCallIntent(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Lift `?answer_call=` / `?decline_call=` out of the current URL into the
 * stash, and rewrite the address bar without them.
 *
 * Called at module load from main.tsx. Stripping matters as much as capturing:
 * left in place, a reload (or the browser restoring the tab tomorrow) would
 * try to answer a long-dead call, and the URL would keep re-triggering the
 * intent every time the router re-evaluated it.
 */
export function captureCallIntentFromUrl(): void {
  if (typeof window === "undefined") return;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return;
  }
  const answerId = params.get("answer_call");
  const declineId = params.get("decline_call");
  const callId = answerId || declineId;
  if (!callId) return;

  stashCallIntent(callId, answerId ? "answer" : "decline");

  params.delete("answer_call");
  params.delete("decline_call");
  const search = params.toString();
  const url = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
  try {
    window.history.replaceState(window.history.state, "", url);
  } catch {
    /* replaceState can throw in exotic embeddings — the stash still holds */
  }
}
