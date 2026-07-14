/**
 * JBS Praxis error reporting.
 *
 * When something fails in the admin (a save that silently died before this
 * existed), we let the operator reach the people who can fix it — JBS Praxis —
 * in one tap, with everything needed to reproduce the issue already filled in.
 *
 * WhatsApp deep-links (wa.me) and mailto: links cannot carry a file attachment
 * programmatically, so the screenshot is captured with html2canvas and saved to
 * the operator's device; the pre-filled message tells them to attach it. The
 * message body carries the full diagnostic (area, action, error, page, user,
 * brand, time, user-agent) so QA can triage even without the image.
 */

import { toast, type ErrorReportContext } from "@/stores/toast";

/** JBS Praxis support channels (the people to contact on failure). */
export const JBS_WHATSAPP = "2348169789106";
export const JBS_EMAIL = "intelligence@jbspraxis.com";

/** Turn an unknown thrown value into a human string + optional detail line. */
export function describeError(err: unknown): { message: string; detail?: string } {
  if (err && typeof err === "object") {
    const e = err as {
      message?: string;
      status?: number;
      code?: string;
      body?: unknown;
    };
    const parts: string[] = [];
    if (e.status != null) parts.push(`HTTP ${e.status}`);
    if (e.code) parts.push(`code ${e.code}`);
    return {
      message: e.message || "Something went wrong.",
      detail: parts.length ? parts.join(" · ") : undefined,
    };
  }
  return { message: typeof err === "string" ? err : "Something went wrong." };
}

/**
 * Fire a failure toast with the "Contact System Admin" report action wired
 * up in one call — the single entry point every catch block / onError
 * handler in the STAFF-FACING admin should use instead of a bare toast or
 * silent console.error. Not for public/unauthenticated pages (sign links,
 * order checkout, onboarding forms, login) — those shouldn't surface an
 * internal support WhatsApp number to outside visitors.
 */
export function toastReport(
  area: string,
  action: string,
  err: unknown,
): void {
  const { message, detail } = describeError(err);
  toast.error(action, {
    description: message,
    report: { area, action, message, detail },
  });
}

/** Best-effort read of the active brand + signed-in user for the report. */
function whoAndWhere(): { brand: string; user: string } {
  let brand = "unknown";
  let user = "unknown";
  try {
    const biz = JSON.parse(localStorage.getItem("pgh-business") || "null");
    brand = biz?.state?.activeKey || brand;
    const auth = JSON.parse(localStorage.getItem("pgh-auth") || "null");
    const u = auth?.state?.user;
    if (u) user = [u.fullName || u.name, u.email].filter(Boolean).join(" · ") || user;
  } catch {
    /* storage unavailable / malformed — keep the defaults */
  }
  return { brand, user };
}

/** The plain-text diagnostic block shared by WhatsApp and email. */
export function buildDiagnostics(ctx: ErrorReportContext): string {
  const { brand, user } = whoAndWhere();
  return [
    "Pixie Girl Hub — issue report",
    "",
    `Area:    ${ctx.area}`,
    `Action:  ${ctx.action}`,
    `Error:   ${ctx.message}`,
    ctx.detail ? `Detail:  ${ctx.detail}` : "",
    `Brand:   ${brand}`,
    `User:    ${user}`,
    `Page:    ${typeof location !== "undefined" ? location.href : ""}`,
    `Time:    ${new Date().toISOString()}`,
    `Device:  ${typeof navigator !== "undefined" ? navigator.userAgent : ""}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Capture the current page and download it as a PNG. Best-effort: html2canvas
 * is dynamically imported so it never weighs on first paint, and any failure
 * (tainted canvas, CSS it can't rasterise) resolves to `false` rather than
 * throwing — reporting must still work without the image.
 */
export async function captureScreenshot(ctx: ErrorReportContext): Promise<boolean> {
  try {
    const { default: html2canvas } = await import("html2canvas");
    const canvas = await html2canvas(document.body, {
      backgroundColor: getComputedStyle(document.body).backgroundColor || "#0b0b0d",
      logging: false,
      useCORS: true,
      scale: Math.min(window.devicePixelRatio || 1, 1.5),
      windowWidth: document.documentElement.clientWidth,
      windowHeight: document.documentElement.clientHeight,
    });
    const blob = await new Promise<Blob | null>((r) =>
      canvas.toBlob(r, "image/png"),
    );
    if (!blob) return false;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    saveBlob(blob, `pgh-issue-${slug(ctx.action) || "report"}-${stamp}.png`);
    return true;
  } catch {
    return false;
  }
}

/** Open the pre-filled WhatsApp chat with JBS Praxis. */
export function openWhatsApp(text: string): void {
  window.open(
    `https://wa.me/${JBS_WHATSAPP}?text=${encodeURIComponent(text)}`,
    "_blank",
    "noopener,noreferrer",
  );
}

/** Open a pre-filled email to JBS Praxis. */
export function openEmail(ctx: ErrorReportContext, text: string): void {
  const subject = `Pixie Girl Hub issue — ${ctx.area}: ${ctx.action}`;
  window.location.href = `mailto:${JBS_EMAIL}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(text)}`;
}

/**
 * Full "report to JBS Praxis" flow used by the error toast's primary action:
 * capture + download the screenshot, then open WhatsApp with the diagnostic
 * pre-filled. Returns whether the screenshot was captured so the caller can
 * tell the operator to attach it.
 */
export async function reportViaWhatsApp(ctx: ErrorReportContext): Promise<boolean> {
  const shot = await captureScreenshot(ctx);
  const note = shot
    ? "\n\n(A screenshot was downloaded to this device — please attach it here.)"
    : "";
  openWhatsApp(buildDiagnostics(ctx) + note);
  return shot;
}

/** Email variant of the report flow. */
export async function reportViaEmail(ctx: ErrorReportContext): Promise<boolean> {
  const shot = await captureScreenshot(ctx);
  const note = shot
    ? "\n\n(A screenshot was downloaded to this device — please attach it to this email.)"
    : "";
  openEmail(ctx, buildDiagnostics(ctx) + note);
  return shot;
}
