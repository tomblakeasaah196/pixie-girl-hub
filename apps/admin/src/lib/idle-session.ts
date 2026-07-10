/**
 * Idle-session loop — client companion to the server's forced idle logout
 * (src/shared/hr_payroll/session-idle.js). One 30-second tick, two jobs:
 *
 *  - Heartbeat (user present): if a human touched the page recently, POST
 *    /auth/heartbeat — lib/api.ts attaches X-User-Activity, which re-arms
 *    the server-side idle window. Covers the user who is reading without
 *    generating API traffic.
 *
 *  - Probe (this tab idle past the limit): send the same POST *without*
 *    recent activity, so it merely checks the session. The server sees
 *    activity across ALL tabs, so it — never this tab's local clock — is
 *    the authority: if the user is alive in another tab the probe 204s and
 *    nothing happens; if the whole session is idle the probe 401s and the
 *    existing silent-refresh machinery fails closed (refresh revokes the
 *    cookie, the in-memory token is dropped, and the SessionExpiredOverlay
 *    locks the screen). That's why this module never revokes directly.
 *
 * The server enforces the timeout regardless; this loop exists so an open
 * tab locks (hiding on-screen data) within moments of the window lapsing
 * instead of on the next click.
 */

import { api, getAccessToken, isSessionLocked } from "@/lib/api";
import {
  getIdleLimitMs,
  isRecentlyActive,
  lastActivityAt,
} from "@/lib/activity";

const TICK_MS = 30_000;
/** Floor between heartbeats/probes so the tick can run more often than we
 *  are willing to hit the network. */
const MIN_REQUEST_GAP_MS = 60_000;

let timer: number | null = null;
let startedAt = 0;
let lastBeatAt = 0;

/** A fresh page load has no recorded input yet — measure idle from when the
 *  watch started so a just-reloaded tab gets a full local window instead of
 *  probing instantly. The server still enforces the true window. */
function idleReference(): number {
  return Math.max(lastActivityAt(), startedAt);
}

function beat() {
  lastBeatAt = Date.now();
  // 401 here flows through api.ts's silent-refresh path; when the session
  // is truly idle that refresh fails and raises the session-expired lock —
  // exactly the outcome we want, so the error itself is noise.
  void api.post("/auth/heartbeat").catch(() => {});
}

function tick() {
  if (isSessionLocked()) return; // overlay is up — nothing to keep alive
  if (!getAccessToken()) return; // not authed yet / bootstrap in flight
  if (Date.now() - lastBeatAt < MIN_REQUEST_GAP_MS) return;

  if (isRecentlyActive()) {
    beat(); // carries X-User-Activity → re-arms the server window
  } else if (Date.now() - idleReference() >= getIdleLimitMs()) {
    beat(); // no activity header → pure server-side liveness check
  }
}

export function startIdleWatch(): void {
  if (timer !== null) return;
  startedAt = Date.now();
  timer = window.setInterval(tick, TICK_MS);
  // A tab surfacing after hours in the background shouldn't show stale data
  // for up to a full tick before locking — check immediately.
  document.addEventListener("visibilitychange", onVisible);
}

export function stopIdleWatch(): void {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
  document.removeEventListener("visibilitychange", onVisible);
}

function onVisible() {
  if (document.visibilityState === "visible") tick();
}
