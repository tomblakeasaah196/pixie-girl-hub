/**
 * Helpers for the Gmail-style email composer shared across Messaging.
 *
 * The rich editor produces HTML; the thread + channel-list previews, search,
 * notifications and the mail preheader all want readable plain text. These
 * convert between the two so a rich send stores a clean plain-text "shadow"
 * alongside the HTML that actually goes out. All DOM-based — the admin app
 * runs in the browser.
 */

/** Rich editor HTML → readable plain text (block breaks preserved, images
 *  reduced to their alt text so nothing silently vanishes from the shadow). */
export function htmlToPlainText(html: string): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  doc.querySelectorAll("img").forEach((img) => {
    const alt = img.getAttribute("alt");
    img.replaceWith(alt ? `[${alt}]` : "[image]");
  });
  doc
    .querySelectorAll("p, div, li, h1, h2, h3, h4, blockquote, tr")
    .forEach((el) => el.append("\n"));
  const text = doc.body.textContent || "";
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** True when the editor holds no meaningful content (no text and no image).
 *  TipTap serialises an empty editor as `<p></p>`, so a bare `.trim()` on the
 *  HTML is not enough. */
export function isRichHtmlEmpty(html: string): boolean {
  if (!html) return true;
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (doc.querySelector("img")) return false;
  return (doc.body.textContent || "").trim().length === 0;
}

/** Plain text → simple editor HTML (paragraphs, line breaks, auto-linked
 *  URLs). Used when dropping stored text — a Praxis draft, a quick reply, a
 *  welcome-form link — into the rich editor. */
export function textToMailHtml(text: string): string {
  const raw = String(text || "");
  if (!raw.trim()) return "";
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const linkify = (s: string) =>
    s.replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}">${u}</a>`);
  return raw
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${linkify(esc(block)).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
