/**
 * Reflects the combined unread notification count on the browser tab:
 *   "(n) Pixie Hub"  in the title
 *   Canvas-drawn dot on the favicon (maroon for bell)
 */

const BASE_TITLE = "Pixie Hub";
const FAVICON_HREF = "/favicon.svg";
const DOT_COLOR = "#A81D1D"; // accent red

let cachedIcon: Promise<HTMLImageElement> | null = null;

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
  const label = count > 0 ? (count > 99 ? "99+" : String(count)) : "";
  document.title = count > 0 ? `(${label}) ${BASE_TITLE}` : BASE_TITLE;

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
