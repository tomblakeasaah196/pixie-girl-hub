/**
 * Web Push subscription flow for the admin PWA.
 * Mirrors hub-system push.ts, simplified: registers the service worker,
 * fetches the VAPID public key, subscribes, and POSTs the subscription
 * to /api/v1/push/subscribe. No-ops gracefully if the backend is not
 * configured or the browser doesn't support push.
 */

import { api } from "@/lib/api";

// When a new service worker takes control of the page (its `activate` runs
// `clients.claim()`), reload once so the tab drops the old JS bundles and
// loads the new build. Under the in-app update flow the new worker only takes
// control after the user accepts the update banner (which posts SKIP_WAITING),
// so this reload is the final step of an explicit, user-initiated update — not
// a surprise mid-task refresh. The guard prevents a reload loop.
//
// A FIRST install also fires controllerchange (nothing to wait behind, so the
// worker activates and claims straight away) — but there's no old bundle to
// drop, and the visitor may be mid-typing on the login form. Skip that one:
// only reload when the page was already controlled by a previous worker.
let swReloading = false;
if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) {
      hadController = true; // first install — adopt silently, no reload
      return;
    }
    if (swReloading) return;
    swReloading = true;
    window.location.reload();
  });
}

// The worker that has finished installing and is waiting to take over. Held so
// the update banner can activate it on demand via applyServiceWorkerUpdate().
let waitingWorker: ServiceWorker | null = null;

/** Fired when a new build has installed and is waiting for the user's OK. */
export const SW_UPDATE_EVENT = "pgh:sw:update-available";

function announceUpdate(worker: ServiceWorker) {
  waitingWorker = worker;
  window.dispatchEvent(new CustomEvent(SW_UPDATE_EVENT));
}

/**
 * Watch a registration for a newer worker. A worker reaching the `installed`
 * state while a controller already exists means an update finished downloading
 * (a fresh first install has no prior controller, so we stay silent). We also
 * catch the case where a worker was already waiting before this page loaded.
 */
function trackUpdates(reg: ServiceWorkerRegistration) {
  if (reg.waiting && navigator.serviceWorker.controller) {
    announceUpdate(reg.waiting);
  }
  reg.addEventListener("updatefound", () => {
    const installing = reg.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      if (
        installing.state === "installed" &&
        navigator.serviceWorker.controller
      ) {
        announceUpdate(reg.waiting ?? installing);
      }
    });
  });
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
    });
    trackUpdates(reg);
    // Check for a newer worker immediately on every load.
    reg.update();
    return reg;
  } catch {
    return null;
  }
}

/**
 * Ask the browser to re-fetch sw.js and install it if it changed. Cheap to call
 * repeatedly (e.g. on route changes) so the app notices a deploy without a full
 * reload. If a newer worker is found it installs and fires SW_UPDATE_EVENT.
 */
export async function checkForServiceWorkerUpdate(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg?.update();
  } catch {
    /* offline or unsupported — ignore */
  }
}

/**
 * Activate the waiting worker (the user accepted the update banner). Posts
 * SKIP_WAITING; the worker then activates, claims the page, and the
 * controllerchange handler above reloads the tab onto the new build.
 */
export function applyServiceWorkerUpdate(): void {
  waitingWorker?.postMessage({ type: "SKIP_WAITING" });
}

export async function ensurePushSubscription(): Promise<boolean> {
  if (
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  )
    return false;
  if (!("serviceWorker" in navigator) || !("PushManager" in window))
    return false;
  try {
    const reg =
      (await navigator.serviceWorker.getRegistration()) ??
      (await registerServiceWorker());
    if (!reg) return false;

    const res = await api.get<{ public_key?: string }>("/push/public-key");
    const publicKey = (res as { public_key?: string })?.public_key;
    if (!publicKey) return false; // backend not configured yet

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      });
    }
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;
    await api.post("/push/subscribe", {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    });
    return true;
  } catch {
    return false;
  }
}

export async function requestPushPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return "denied";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function pushPermission(): NotificationPermission {
  return typeof Notification === "undefined"
    ? "denied"
    : Notification.permission;
}

const PUSH_PROMPT_KEY = "pgh_push_prompted";

export function hasPushBeenPrompted(): boolean {
  try {
    return !!localStorage.getItem(PUSH_PROMPT_KEY);
  } catch {
    return false;
  }
}

export function markPushPrompted() {
  try {
    localStorage.setItem(PUSH_PROMPT_KEY, "1");
  } catch {}
}
