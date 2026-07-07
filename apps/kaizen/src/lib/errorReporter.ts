/**
 * Kaizen client error reporter (framework-agnostic).
 *
 * Drop this file into ANY of the client apps (admin, storefront, stylist,
 * landing, kaizen) and call installErrorReporter() once at startup. It hooks
 * window.onerror + onunhandledrejection and POSTs crashes to the Kaizen ingest
 * endpoint. It redacts obvious PII on the client too — never send form values.
 *
 * Config comes from Vite env (set per app; the ingest key is a low-sensitivity
 * static key, safe to embed — it only allows rate-limited, origin-allowlisted
 * error reporting):
 *   VITE_KAIZEN_INGEST_URL   e.g. https://kaizen.pixiegirlglobal.com/api/v1/kaizen/ingest/client-error
 *   VITE_KAIZEN_INGEST_KEY   the shared X-Kaizen-Ingest-Key
 *   VITE_APP_VERSION         optional build id
 *
 * If URL or KEY is missing, the reporter is a no-op (dev-friendly).
 */

type Source = "admin" | "storefront" | "stylist" | "landing" | "kaizen";

interface ReporterConfig {
  source: Source;
  url?: string;
  key?: string;
  appVersion?: string;
}

const SCRUBBERS: [RegExp, string][] = [
  [/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, "[redacted-email]"],
  [/[A-Za-z0-9_-]{32,}/g, "[redacted-token]"],
  [/(?:\+?\d[\s-]?){7,}\d/g, "[redacted-phone]"],
  [/\b\d{7,}\b/g, "[redacted-num]"],
];

function scrub(text?: string | null): string | undefined {
  if (!text) return undefined;
  let s = String(text);
  for (const [re, rep] of SCRUBBERS) s = s.replace(re, rep);
  return s.slice(0, 8000);
}

let installed = false;
let lastKey = "";
let lastAt = 0;

export function installErrorReporter(cfg: ReporterConfig): void {
  if (installed) return;
  const url = cfg.url ?? (import.meta as any).env?.VITE_KAIZEN_INGEST_URL;
  const key = cfg.key ?? (import.meta as any).env?.VITE_KAIZEN_INGEST_KEY;
  const appVersion =
    cfg.appVersion ?? (import.meta as any).env?.VITE_APP_VERSION ?? undefined;
  if (!url || !key) return; // not configured — stay silent
  installed = true;

  const send = (message?: string, stack?: string) => {
    const msg = scrub(message);
    if (!msg) return;
    // Client-side dedupe: drop repeats of the same message within 5s.
    const now = Date.now();
    if (msg === lastKey && now - lastAt < 5000) return;
    lastKey = msg;
    lastAt = now;

    const body = JSON.stringify({
      source: cfg.source,
      message: msg,
      stack: scrub(stack),
      route: location?.pathname,
      app_version: appVersion,
    });
    try {
      // keepalive lets the report survive a navigation/unload.
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Kaizen-Ingest-Key": key },
        body,
        keepalive: true,
        credentials: "omit",
      }).catch(() => {});
    } catch {
      /* never throw from the reporter */
    }
  };

  window.addEventListener("error", (e: ErrorEvent) => {
    send(e.message || String(e.error), e.error?.stack);
  });
  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const r = e.reason;
    send(r?.message || String(r), r?.stack);
  });
}

/** Manual report (e.g. from a React ErrorBoundary). Safe if not installed. */
export function reportError(error: unknown, source: Source): void {
  const url = (import.meta as any).env?.VITE_KAIZEN_INGEST_URL;
  const key = (import.meta as any).env?.VITE_KAIZEN_INGEST_KEY;
  if (!url || !key) return;
  const err = error as { message?: string; stack?: string };
  const msg = scrub(err?.message || String(error));
  if (!msg) return;
  try {
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Kaizen-Ingest-Key": key },
      body: JSON.stringify({
        source,
        message: msg,
        stack: scrub(err?.stack),
        route: location?.pathname,
        app_version: (import.meta as any).env?.VITE_APP_VERSION,
      }),
      keepalive: true,
      credentials: "omit",
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}
