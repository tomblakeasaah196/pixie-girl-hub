/**
 * Ring alerting — everything a ringing call does to get an agent's attention,
 * in one place, so the three states behave consistently:
 *
 *   1. In the caller's chat        in-thread banner + sound + vibration
 *   2. In the app, other module    corner toast + sound + vibration + tab flash
 *   2b. In the app, tab hidden     …plus an OS notification (with actions)
 *   3. Out of the app              push notification only (service worker)
 *
 * The subtle part is state 2b vs 3: BOTH can fire an OS notification for the
 * same call — the service worker's push handler and this module's local one.
 * They deliberately share the tag `pgh-call-<id>` (see calls.push.js), which
 * the platform treats as one notification, so the agent never sees a double.
 * The service worker additionally suppresses its own display when a visible
 * client exists and hands the ring to the page instead (postMessage), so a
 * focused tab rings in-app rather than behind an OS chrome.
 *
 * Nothing here throws. A blocked AudioContext, a missing Vibration API, a
 * denied notification permission — each degrades on its own and the others
 * still fire.
 */

import {
  startRingtone,
  stopRingtone,
  startVibration,
  stopVibration,
} from "@/lib/notif-sound";
import { setRingingTitle } from "@/lib/tab-badge";

/** Must match calls.push.js#tagFor so push and local collapse into one. */
export const callTag = (callId: string) => `pgh-call-${callId}`;

export interface CallAlertTarget {
  call_id: string;
  caller_name?: string | null;
  from_number?: string | null;
  brand?: string;
  channel_id?: string | null;
}

export function callerLabel(t: CallAlertTarget): string {
  return t.caller_name || t.from_number || "Unknown caller";
}

// ── Local OS notification (state 2b) ──────────────────────

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    return null;
  }
}

function canNotify(): boolean {
  return (
    typeof Notification !== "undefined" && Notification.permission === "granted"
  );
}

/**
 * Show an OS-level ring for a call the page learned about over the socket
 * while it was hidden. Uses the service-worker registration (not `new
 * Notification()`) because only that form supports action buttons, and it is
 * what lets the tag dedupe against the push copy.
 */
export async function showLocalCallNotification(t: CallAlertTarget) {
  if (!canNotify()) return;
  const reg = await registration();
  if (!reg) return;
  const name = callerLabel(t);
  try {
    await reg.showNotification(`📞 ${name} is calling`, {
      body: "Incoming WhatsApp call — tap to answer",
      tag: callTag(t.call_id),
      renotify: true,
      requireInteraction: true,
      icon: "/pwa-icon-192.svg",
      badge: "/pwa-icon-192.svg",
      data: {
        kind: "call_ring",
        call_id: t.call_id,
        brand: t.brand,
        channel_id: t.channel_id ?? null,
        url: answerDeepLink(t),
        answer_url: answerDeepLink(t),
        decline_url: declineDeepLink(t),
      },
      actions: [
        { action: "answer", title: "Answer" },
        { action: "decline", title: "Decline" },
      ],
    } as NotificationOptions);
  } catch {
    /* notification display is best-effort */
  }
}

/** Close any OS notification for this call (answered, declined, ended). */
export async function closeCallNotification(callId: string) {
  const reg = await registration();
  if (!reg) return;
  try {
    const open = await reg.getNotifications({ tag: callTag(callId) });
    for (const n of open) n.close();
  } catch {
    /* nothing to close */
  }
}

// ── Deep links (mirror of calls.push.js) ──────────────────

function callDeepLink(t: CallAlertTarget, action: string): string {
  const params = new URLSearchParams();
  if (t.channel_id) params.set("channel", t.channel_id);
  params.set(action, t.call_id);
  return `/smartcomm?${params.toString()}`;
}

export const answerDeepLink = (t: CallAlertTarget) =>
  callDeepLink(t, "answer_call");
export const declineDeepLink = (t: CallAlertTarget) =>
  callDeepLink(t, "decline_call");

// ── The alert itself ──────────────────────────────────────

let alerting: string | null = null;

/**
 * Start (or retarget) the ring alert. Idempotent per call: re-calling with the
 * same call keeps one ringtone running rather than layering a second.
 *
 * `hidden` says whether the tab is currently out of sight — the caller passes
 * it rather than reading document.visibilityState here, so the CallLayer can
 * re-evaluate when the agent tabs away mid-ring and escalate to an OS
 * notification at that moment.
 */
export function startCallAlert(t: CallAlertTarget, opts: { hidden: boolean }) {
  const name = callerLabel(t);
  if (alerting !== t.call_id) {
    alerting = t.call_id;
    startRingtone();
    startVibration();
  }
  setRingingTitle(name);
  if (opts.hidden) void showLocalCallNotification(t);
}

/**
 * Stop everything. Called when the ring stack empties, when this agent
 * answers, or when the call is settled by anyone.
 */
export function stopCallAlert(callId?: string) {
  stopRingtone();
  stopVibration();
  setRingingTitle(null);
  const id = callId ?? alerting;
  alerting = null;
  if (id) void closeCallNotification(id);
}

/** Which call, if any, this tab is currently alerting for. */
export function alertingCallId(): string | null {
  return alerting;
}
