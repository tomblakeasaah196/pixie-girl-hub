/**
 * Human-input tracker — the client half of the forced idle logout.
 *
 * Records the timestamp of the last real user input (pointer, key, wheel,
 * touch). lib/api.ts turns "recent input" into the X-User-Activity header,
 * which is the ONLY thing that re-arms the server-side idle window — so
 * background refetches from an abandoned tab can't keep a session alive.
 * lib/idle-session.ts drives its heartbeat/probe loop off the same clock.
 *
 * Listeners are passive + capture on window so no component can swallow
 * them, and the handler is a single timestamp assignment — free even for
 * pointermove.
 */

/** Input this recent counts as "the user is at the keyboard" (header window,
 *  heartbeat window). Keep it small: a request re-arms the FULL idle window
 *  server-side, so this is the worst-case overshoot past the idle limit. */
export const ACTIVITY_FRESH_MS = 90_000;

const DEFAULT_IDLE_LIMIT_MS = 45 * 60_000;

let lastInputAt = 0;
/** Server-declared idle limit (idle_timeout_s from login/refresh). Falls
 *  back to the backend's default so the two agree before first sync. */
let idleLimitMs = DEFAULT_IDLE_LIMIT_MS;

function markActivity() {
  lastInputAt = Date.now();
}

if (typeof window !== "undefined") {
  const events = [
    "pointerdown",
    "pointermove",
    "keydown",
    "wheel",
    "touchstart",
  ] as const;
  for (const ev of events) {
    window.addEventListener(ev, markActivity, {
      passive: true,
      capture: true,
    });
  }
}

/** Timestamp (ms) of the last human input this page-load; 0 if none yet. */
export function lastActivityAt(): number {
  return lastInputAt;
}

/** True when a human touched the page within the given window. */
export function isRecentlyActive(windowMs: number = ACTIVITY_FRESH_MS): boolean {
  return lastInputAt > 0 && Date.now() - lastInputAt < windowMs;
}

/** Adopt the server's idle limit (login/refresh responses carry it). */
export function setIdleLimitSeconds(seconds?: number): void {
  if (typeof seconds === "number" && seconds > 0) {
    idleLimitMs = seconds * 1000;
  }
}

export function getIdleLimitMs(): number {
  return idleLimitMs;
}
