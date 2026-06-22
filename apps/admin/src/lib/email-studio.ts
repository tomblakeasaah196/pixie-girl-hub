/**
 * Block-based email studio — design model + compiler.
 *
 * THE GOLDEN RULE OF EMAIL HTML: it is not web HTML. Outlook renders with
 * Word's engine and Gmail strips <style>, so everything compiles to nested
 * tables with inline CSS only. Users edit blocks; we guarantee the output
 * renders everywhere.
 *
 * compileEmailHtml() output goes into email_templates.html_body and is sent
 * as-is by the backend, which substitutes {{customer_name}} and {{email}} per
 * recipient. The original design is stored back-to-back with the HTML inside an
 * HTML comment (serializeDesign / parseDesign) so a template can be re-opened
 * in the studio without a separate design column.
 */

export type EmailBlockType =
  | "header"
  | "hero"
  | "heading"
  | "text"
  | "button"
  | "price"
  | "deadline"
  | "image"
  | "divider"
  | "spacer"
  | "footer";

export interface EmailBlock {
  id: string;
  type: EmailBlockType;
  text?: string;
  label?: string;
  href?: string;
  imageUrl?: string;
  alt?: string;
  align?: "left" | "center" | "right";
  height?: number;
}

export interface EmailTheme {
  background: string;
  content: string;
  accent: string;
  text: string;
}

export interface EmailDesign {
  version: 1;
  theme: EmailTheme;
  blocks: EmailBlock[];
}

// Maroon Noir-ish defaults (literal hex is fine here — this is email HTML, not
// the app UI, and must be inline/portable). Aligned with the server skin
// (src/services/email-theme.js): warm ivory page, white letter, maroon accent.
export const DEFAULT_THEME: EmailTheme = {
  background: "#F4EFE9",
  content: "#FFFFFF",
  accent: "#690909",
  text: "#1A1212",
};

export const BLOCK_LABELS: Record<EmailBlockType, string> = {
  header: "Header",
  hero: "Hero image",
  heading: "Heading",
  text: "Text",
  button: "Button",
  price: "Price (before → after)",
  deadline: "Countdown banner",
  image: "Image",
  divider: "Divider",
  spacer: "Spacer",
  footer: "Footer",
};

let counter = 0;
function blockId(): string {
  counter += 1;
  return `blk_${Date.now().toString(36)}_${counter}`;
}

export function newBlock(type: EmailBlockType): EmailBlock {
  const base: EmailBlock = { id: blockId(), type };
  switch (type) {
    case "header":
      return { ...base, text: "Your Brand", imageUrl: "" };
    case "hero":
      return { ...base, imageUrl: "", alt: "", href: "" };
    case "heading":
      return { ...base, text: "A headline that earns the open", align: "left" };
    case "text":
      return { ...base, text: "Hi {{customer_name}},\n\nWrite your message here." };
    case "button":
      return { ...base, label: "Shop now", href: "{{website_url}}", align: "center" };
    case "price":
      return { ...base, text: "₦120,000", label: "₦84,000", alt: "Sale price", align: "center" };
    case "deadline":
      return { ...base, text: "{{deadline_phrase}}", label: "Sale ends {{sale_end_display}}" };
    case "image":
      return { ...base, imageUrl: "", alt: "", href: "" };
    case "divider":
      return base;
    case "spacer":
      return { ...base, height: 24 };
    case "footer":
      return {
        ...base,
        text: "You're receiving this because you're part of the {{brand_name}} community.",
      };
    default:
      return base;
  }
}

export function defaultDesign(brandName?: string): EmailDesign {
  // Header auto-brands from Settings via tokens; a typed brand name is used as
  // the visible fallback when no logo is set.
  return {
    version: 1,
    theme: { ...DEFAULT_THEME },
    blocks: [
      { ...newBlock("header"), text: brandName || "{{brand_name}}", imageUrl: "{{logo_url}}" },
      newBlock("heading"),
      newBlock("text"),
      newBlock("button"),
      newBlock("divider"),
      newBlock("footer"),
    ],
  };
}

// ── Compiler ────────────────────────────────────────────────

function esc(s: string | undefined): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escMultiline(s: string | undefined): string {
  return esc(s).replace(/\r?\n/g, "<br>");
}
function safeHref(href: string | undefined): string {
  const h = (href || "").trim();
  return /^https?:\/\/.+/i.test(h) ? esc(h) : "#";
}

const FONT = "'Playfair Display', Georgia, 'Times New Roman', serif";
const FONT_SANS = "'Montserrat', Arial, Helvetica, sans-serif";

function renderBlock(b: EmailBlock, t: EmailTheme): string {
  const align = b.align || "left";
  switch (b.type) {
    case "header": {
      const logo = (b.imageUrl || "").trim()
        ? `<img src="${esc(b.imageUrl)}" alt="${esc(b.text)}" height="40" style="display:block;border:0;max-height:40px" />`
        : `<span style="font-family:${FONT};font-size:22px;letter-spacing:2px;color:${t.text};text-transform:uppercase">${esc(b.text)}</span>`;
      return `<tr><td align="center" style="padding:24px 32px;border-bottom:1px solid #EEEAE0">${logo}</td></tr>`;
    }
    case "hero":
    case "image": {
      if (!(b.imageUrl || "").trim()) return "";
      const img = `<img src="${esc(b.imageUrl)}" alt="${esc(b.alt)}" width="600" style="display:block;border:0;width:100%;max-width:600px;height:auto" />`;
      const body = (b.href || "").trim()
        ? `<a href="${safeHref(b.href)}" target="_blank" style="text-decoration:none">${img}</a>`
        : img;
      return `<tr><td style="padding:0">${body}</td></tr>`;
    }
    case "heading":
      return `<tr><td align="${align}" style="padding:28px 32px 8px;font-family:${FONT};font-size:26px;line-height:34px;color:${t.text};font-weight:bold">${esc(b.text)}</td></tr>`;
    case "text":
      return `<tr><td align="${align}" style="padding:12px 32px;font-family:${FONT_SANS};font-size:15px;line-height:24px;color:${t.text}">${escMultiline(b.text)}</td></tr>`;
    case "button":
      return `<tr><td align="${b.align || "center"}" style="padding:20px 32px">
        <table role="presentation" border="0" cellspacing="0" cellpadding="0"><tr>
          <td align="center" bgcolor="${t.accent}" style="border-radius:4px">
            <a href="${safeHref(b.href)}" target="_blank" style="display:inline-block;padding:13px 32px;font-family:${FONT_SANS};font-size:14px;font-weight:bold;letter-spacing:1px;color:#FFFFFF;text-decoration:none;text-transform:uppercase">${esc(b.label)}</a>
          </td>
        </tr></table>
      </td></tr>`;
    case "price":
      return `<tr><td align="${b.align || "center"}" style="padding:18px 32px 0">
        <table role="presentation" border="0" cellspacing="0" cellpadding="0" align="${b.align || "center"}"><tr>
          <td style="font-family:${FONT_SANS};font-size:18px;color:#A89F96;text-decoration:line-through;padding-right:14px">${esc(b.text)}</td>
          <td style="font-family:${FONT};font-size:30px;font-weight:bold;color:${t.accent}">${esc(b.label)}</td>
        </tr></table>
        ${b.alt ? `<div style="font-family:${FONT_SANS};font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#7A7068;margin-top:8px">${esc(b.alt)}</div>` : ""}
      </td></tr>`;
    case "deadline":
      return `<tr><td style="padding:22px 32px 4px">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tr>
          <td align="center" bgcolor="#1A1212" style="border-radius:6px;padding:18px 20px">
            <div style="font-family:${FONT_SANS};font-size:13px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#FFFFFF">⏳ ${esc(b.text)}</div>
            ${b.label ? `<div style="font-family:${FONT_SANS};font-size:12px;letter-spacing:1px;color:#D9CFC6;margin-top:6px">${esc(b.label)}</div>` : ""}
          </td>
        </tr></table>
      </td></tr>`;
    case "divider":
      return `<tr><td style="padding:20px 32px"><table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tr><td style="border-top:1px solid #E5E0D5;font-size:0;line-height:0">&nbsp;</td></tr></table></td></tr>`;
    case "spacer":
      return `<tr><td style="font-size:0;line-height:0;height:${Math.max(4, Math.min(120, b.height || 24))}px">&nbsp;</td></tr>`;
    case "footer":
      return `<tr><td align="center" style="padding:28px 32px;border-top:1px solid #EEEAE0;font-family:${FONT_SANS};font-size:12px;line-height:18px;color:#8A8578">
        ${escMultiline(b.text)}
      </td></tr>`;
    default:
      return "";
  }
}

export function compileEmailHtml(design: EmailDesign): string {
  const t = design.theme || DEFAULT_THEME;
  const rows = design.blocks.map((b) => renderBlock(b, t)).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title></title>
<style>@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&family=Playfair+Display:wght@500;600;700&display=swap');</style>
</head>
<body style="margin:0;padding:0;background-color:${t.background}">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="${t.background}">
    <tr><td align="center" style="padding:24px 12px">
      <table role="presentation" width="600" border="0" cellspacing="0" cellpadding="0" bgcolor="${t.content}" style="width:600px;max-width:100%;border-radius:6px;overflow:hidden">
${rows}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// A small, tasteful inline-SVG wordmark so previews show a real logo without a
// network round-trip (the live send uses the brand's actual logo from Settings).
const SAMPLE_LOGO =
  "data:image/svg+xml;base64," +
  btoa(
    `<svg xmlns='http://www.w3.org/2000/svg' width='280' height='44'><text x='0' y='32' font-family='Georgia, serif' font-size='28' letter-spacing='5' fill='#1A1212'>YOUR BRAND</text></svg>`,
  );

const SAMPLE: Record<string, string> = {
  customer_name: "Adaeze Obi",
  first_name: "Adaeze",
  email: "adaeze@example.com",
  unsubscribe_url: "#",
  // Brand identity (live send pulls these from Settings)
  brand_name: "Your Brand",
  brand_legal_name: "Your Brand Ltd",
  logo_url: SAMPLE_LOGO,
  brand_color: DEFAULT_THEME.accent,
  website_url: "#",
  support_email: "care@yourbrand.com",
  brand_address: "Lagos, Nigeria",
  year: String(new Date().getFullYear()),
  // Sale / campaign sample values
  discount: "30",
  sale_url: "#",
  cta_url: "#",
  sale_end_display: "23 June",
  deadline_phrase: "Only 2 days left",
  days_left: "2",
};

/** Replace merge tokens with sample values for an editor preview, so what the
 *  author sees matches the branded, personalised email recipients receive.
 *  Unknown tokens collapse to '' (never leak a raw {{x}} into the preview). */
export function fillSample(html: string): string {
  return html.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k: string) =>
    k in SAMPLE ? SAMPLE[k] : "",
  );
}

export function previewEmailHtml(design: EmailDesign): string {
  return fillSample(compileEmailHtml(design));
}

// ── Design round-trip (embed design JSON in an HTML comment) ──

const MARKER = "pgh-design:";

function encode(json: string): string {
  // base64 of UTF-8 bytes, browser-safe (handles emoji etc.).
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}
function decode(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Send-ready HTML with the design embedded so the studio can re-open it. */
export function serializeDesign(design: EmailDesign): string {
  const payload = encode(JSON.stringify(design));
  return `<!--${MARKER}${payload}-->\n${compileEmailHtml(design)}`;
}

/** Recover a design from html_body, or null if it wasn't studio-built. */
export function parseDesign(html: string | undefined): EmailDesign | null {
  if (!html) return null;
  const m = html.match(/<!--pgh-design:([A-Za-z0-9+/=]+)-->/);
  if (!m) return null;
  try {
    const design = JSON.parse(decode(m[1])) as EmailDesign;
    if (design && Array.isArray(design.blocks) && design.theme) return design;
  } catch {
    /* fall through */
  }
  return null;
}
