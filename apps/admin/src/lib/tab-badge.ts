/**
 * Reflects the combined unread notification count on the browser tab:
 *   "(n) Pixie Hub"  in the title
 *   Canvas-drawn dot on the favicon (maroon for bell)
 *
 * A ringing call OVERRIDES the badge entirely (see setRingingTitle): a
 * background tab that says "📞 Ada Obi — calling" is the only thing that will
 * pull an agent back in time, and "(3) Pixie Hub" would bury it. This module
 * is the single owner of document.title so the two can never fight — the last
 * unread count is remembered and re-applied the moment the ring stops.
 */

const BASE_TITLE = "Pixie Hub";
const FAVICON_HREF = "/favicon.svg";
const DOT_COLOR = "#A81D1D"; // accent red

let cachedIcon: Promise<HTMLImageElement> | null = null;
let lastCount = 0;
let ringingLabel: string | null = null;
let ringFlashTimer: ReturnType<typeof setInterval> | null = null;
let ringFlashOn = true;

function loadIcon(): Promise<HTMLImageElement> {
  cachedIcon ??= new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = FAVICON_HREF;
  });
  return cachedIcon;
}

function faviconLink(): HTMLLinkElement {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  return link;
}

export async function applyTabBadge(count: number) {
  lastCount = count;
  const label = count > 0 ? (count > 99 ? "99+" : String(count)) : "";
  // A live ring owns the title until it stops.
  if (!ringingLabel) {
    document.title = count > 0 ? `(${label}) ${BASE_TITLE}` : BASE_TITLE;
  }

  const link = faviconLink();
  if (!count) {
    link.href = FAVICON_HREF;
    return;
  }
  try {
    const img = await loadIcon();
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const c = canvas.getContext("2d");
    if (!c) return;
    c.drawImage(img, 0, 0, 32, 32);
    c.beginPath();
    c.arc(23, 9, 8, 0, Math.PI * 2);
    c.fillStyle = DOT_COLOR;
    c.fill();
    link.href = canvas.toDataURL("image/png");
  } catch {
    // Favicon badge is best-effort; title badge still works.
  }
}

/**
 * Flash the tab title for an incoming call, or clear it (pass null) to hand
 * the title back to the unread badge. The 1 s alternation is what makes a
 * ringing tab catch the eye in a strip of a dozen identical ones.
 */
export function setRingingTitle(callerName: string | null) {
  if (!callerName) {
    if (ringFlashTimer) {
      clearInterval(ringFlashTimer);
      ringFlashTimer = null;
    }
    if (ringingLabel) {
      ringingLabel = null;
      void applyTabBadge(lastCount); // restore "(n) Pixie Hub"
    }
    return;
  }

  ringingLabel = callerName;
  if (ringFlashTimer) return; // already flashing — just took a new name

  ringFlashOn = true;
  const paint = () => {
    document.title = ringFlashOn
      ? `📞 ${ringingLabel} — calling`
      : `☎️ Answer the call`;
    ringFlashOn = !ringFlashOn;
  };
  paint();
  ringFlashTimer = setInterval(paint, 1000);
}
