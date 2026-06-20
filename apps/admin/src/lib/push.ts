/**
 * Web Push subscription flow for the admin PWA.
 * Mirrors hub-system push.ts, simplified: registers the service worker,
 * fetches the VAPID public key, subscribes, and POSTs the subscription
 * to /api/v1/push/subscribe. No-ops gracefully if the backend is not
 * configured or the browser doesn't support push.
 */

import { api } from "@/lib/api";

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
    });
    reg.update();
    return reg;
  } catch {
    return null;
  }
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
