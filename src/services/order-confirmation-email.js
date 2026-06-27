/**
 * Order-confirmation email — the letter a customer receives the moment their
 * payment is confirmed (fired off the `order.paid` outbox event, post-commit,
 * via shared/notifications/notifications.subscribers.js).
 *
 * It reuses the premium email skin (services/email-theme.js) and the per-brand
 * identity resolver (modules/email_campaigns/email-render.js), so one letter
 * reskins itself for Pixie Girl Global vs Faitlynhair straight from Settings —
 * logo, accent colour, name, links, address — nothing hard-coded. Compiles to
 * nested tables with inline CSS so it survives Gmail / Outlook / Apple Mail.
 *
 * What it says:
 *   • Payment received + a warm thank-you, signed "Sales, {brand name}".
 *   • The products ordered, with a clean itemised summary and totals.
 *   • WHEN to expect the order — a delivery ETA (chosen by the order's zone) if
 *     they picked delivery, or a store-collection window if they picked pickup.
 *     Both timeframes come from business_config.fulfilment_settings (Settings).
 *
 * Best-effort by contract: sendOrderConfirmationEmail never throws — a delivery
 * problem must never roll back (or appear to fail) a confirmed, paid order.
 */

"use strict";

const email = require("./email.service");
const T = require("./email-theme");
const docCopy = require("./document-copy");
const emailRender = require("../modules/email_campaigns/email-render");
const { query } = require("../config/database");
const { logger } = require("../config/logger");

const { SERIF, SANS, NEUTRAL, esc, pad } = T;
// Money figures get a monospace stack (the design canon's JetBrains Mono, with
// safe fallbacks for mail clients that won't load a web font).
const MONO =
  "'JetBrains Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

/** ₦ figure with thousands grouping and 2dp — from a decimal string or number. */
function ngn(value) {
  const n = Number(value || 0);
  return (
    "₦" +
    (Number.isFinite(n) ? n : 0).toLocaleString("en-NG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function gt0(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0;
}

/** internal_notes is JSONB (object) but be defensive about a stringified blob. */
function asObject(v) {
  if (!v) return {};
  if (typeof v === "object") return v;
  try {
    return JSON.parse(v);
  } catch {
    return {};
  }
}

// ── Custom content blocks (use the shared skin's tokens) ───────────

/** Itemised order lines: name + (qty × unit) on the left, line total right. */
function orderItems(order) {
  const lines = Array.isArray(order.lines) ? order.lines : [];
  const rows = lines
    .map((l) => {
      const name =
        [l.product_name_snapshot, l.variant_label_snapshot]
          .filter(Boolean)
          .join(" — ") ||
        l.product_name_snapshot ||
        "Item";
      const lineTotal = gt0(l.line_total_ngn)
        ? l.line_total_ngn
        : Number(l.unit_price_ngn || 0) * Number(l.quantity || 0);
      return `<tr>
        <td style="padding:14px 0;border-bottom:1px solid ${NEUTRAL.hairline};font-family:${SANS};font-size:14px;line-height:1.45;color:${NEUTRAL.ink}">
          ${esc(name)}
          <div style="font-family:${SANS};font-size:12px;color:${NEUTRAL.muted};margin-top:3px">Qty ${esc(
            l.quantity,
          )} &times; ${esc(ngn(l.unit_price_ngn))}</div>
        </td>
        <td valign="top" align="right" style="padding:14px 0;border-bottom:1px solid ${NEUTRAL.hairline};font-family:${MONO};font-size:14px;color:${NEUTRAL.ink};white-space:nowrap">${esc(
          ngn(lineTotal),
        )}</td>
      </tr>`;
    })
    .join("");

  return pad(
    `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
      <tbody>${rows}</tbody>
    </table>`,
    { top: 18, bottom: 0 },
  );
}

/** A single totals row (label left, amount right; `strong` for the grand total). */
function totalRow(label, amount, { strong = false, accent } = {}) {
  const size = strong ? 18 : 14;
  const color = strong ? NEUTRAL.ink : NEUTRAL.muted;
  const amtColor = strong ? accent || NEUTRAL.ink : NEUTRAL.ink;
  const weight = strong ? 700 : 500;
  const pad_ = strong ? "14px 0 0 0" : "7px 0 0 0";
  return `<tr>
    <td style="padding:${pad_};font-family:${SANS};font-size:${size}px;font-weight:${weight};color:${color}">${esc(
      label,
    )}</td>
    <td align="right" style="padding:${pad_};font-family:${MONO};font-size:${size}px;font-weight:${weight};color:${amtColor};white-space:nowrap">${esc(
      ngn(amount),
    )}</td>
  </tr>`;
}

function orderTotals(order, accent) {
  const rows = [totalRow("Subtotal", order.subtotal_ngn)];
  if (gt0(order.discount_amount_ngn))
    rows.push(totalRow("Discount", `-${order.discount_amount_ngn}`));
  // Shipping shows for delivery orders even when free, so the buyer sees it.
  rows.push(
    gt0(order.shipping_fee_ngn)
      ? totalRow("Delivery", order.shipping_fee_ngn)
      : `<tr><td style="padding:7px 0 0 0;font-family:${SANS};font-size:14px;color:${NEUTRAL.muted}">Delivery</td><td align="right" style="padding:7px 0 0 0;font-family:${SANS};font-size:13px;color:${NEUTRAL.muted}">Free</td></tr>`,
  );
  if (gt0(order.tax_amount_ngn))
    rows.push(totalRow("VAT included", order.tax_amount_ngn));
  rows.push(totalRow("Total paid", order.total_ngn, { strong: true, accent }));

  return pad(
    `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
      <tbody>${rows.join("")}</tbody>
    </table>`,
    { top: 16, bottom: 0 },
  );
}

/** Resolve the delivery ETA phrase for this order from the brand's settings. */
function deliveryEta(order, settings) {
  const d = (settings && settings.delivery) || {};
  const internal = asObject(order.internal_notes);
  const snap = asObject(order.delivery_address_snapshot);
  const cc =
    (internal.delivery && internal.delivery.country_code) ||
    snap.country_code ||
    "";
  const isIntl = /^[A-Za-z]{2}$/.test(cc) && cc.toUpperCase() !== "NG";
  if (isIntl) return d.international || d.default || "7–14 business days";
  const hay = `${snap.city || ""} ${snap.state || ""} ${
    (internal.delivery && internal.delivery.zone_name) || ""
  }`.toLowerCase();
  if (hay.includes("lagos")) return d.lagos || d.default || "1–2 business days";
  return d.nigeria || d.default || "3–5 business days";
}

/**
 * The "what happens next" panel: a soft card with an accent left rule. Delivery
 * orders get the ETA; pickup orders get the collection window + hours + what to
 * bring. Both timeframes are Settings-driven (business_config.fulfilment_settings).
 */
function fulfilmentPanel({ isPickup, order, settings, accent }) {
  let title;
  let bodyHtml;
  if (isPickup) {
    const p = (settings && settings.pickup) || {};
    title = "Ready for collection";
    const bits = [
      `<div style="font-family:${SANS};font-size:14px;line-height:1.55;color:${NEUTRAL.ink}">Your order will be ready to collect in store <strong>${esc(
        p.ready_in || "within 24 hours",
      )}</strong>.</div>`,
    ];
    if (p.hours)
      bits.push(
        `<div style="font-family:${SANS};font-size:13px;line-height:1.55;color:${NEUTRAL.muted};margin-top:8px"><strong style="color:${NEUTRAL.ink}">Collection hours:</strong> ${esc(
          p.hours,
        )}</div>`,
      );
    if (p.instructions)
      bits.push(
        `<div style="font-family:${SANS};font-size:13px;line-height:1.55;color:${NEUTRAL.muted};margin-top:8px">${esc(
          p.instructions,
        )}</div>`,
      );
    bodyHtml = bits.join("");
  } else {
    const d = (settings && settings.delivery) || {};
    const eta = deliveryEta(order, settings);
    title = "On its way to you";
    const bits = [];
    if (d.intro)
      bits.push(
        `<div style="font-family:${SANS};font-size:14px;line-height:1.55;color:${NEUTRAL.ink}">${esc(
          d.intro,
        )}</div>`,
      );
    bits.push(
      `<div style="font-family:${SANS};font-size:14px;line-height:1.55;color:${NEUTRAL.ink};margin-top:8px">Estimated delivery: <strong>${esc(
        eta,
      )}</strong>.</div>`,
    );
    bits.push(
      `<div style="font-family:${SANS};font-size:13px;line-height:1.55;color:${NEUTRAL.muted};margin-top:8px">We'll be in touch with tracking details as soon as your parcel is on the move.</div>`,
    );
    bodyHtml = bits.join("");
  }

  return `<tr><td style="padding:8px 40px 0 40px">
    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="#FBF7F2" style="background-color:#FBF7F2;border-radius:8px;border-left:3px solid ${accent}">
      <tr><td style="padding:20px 22px">
        <div style="font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${accent};margin-bottom:10px">${esc(
          isPickup ? "Store pickup" : "Delivery",
        )}</div>
        <div style="font-family:${SERIF};font-size:19px;font-weight:600;color:${NEUTRAL.ink};margin-bottom:8px">${esc(
          title,
        )}</div>
        ${bodyHtml}
      </td></tr>
    </table>
  </td></tr>`;
}

/**
 * Compose the confirmation letter for a brand + order + recipient.
 * @returns {{subject:string, html:string, text:string}}
 */
function buildOrderConfirmationEmail({
  brandTokens,
  order,
  firstName,
  isPickup,
  settings,
  copyEmail = {},
}) {
  const name = (firstName || "").trim();
  const brandName = brandTokens.brand_name || "our atelier";
  const accent = brandTokens.brand_color || "#690909";
  const greeting = name ? `Thank you, ${name}` : "Thank you";
  const unsubscribe = brandTokens.support_email
    ? `mailto:${brandTokens.support_email}?subject=Order ${order.order_number}`
    : brandTokens.website_url || "";

  // Settings-driven curated copy (Invoicing → Settings · receipt mail). Blank →
  // the email's built-in wording. Tokens personalise the line per recipient.
  const tokens = {
    first_name: name || "there",
    brand_name: brandName,
    order_number: order.order_number,
  };
  const introBlock = copyEmail.intro
    ? T.paragraph(esc(docCopy.fillTokens(copyEmail.intro, tokens)))
    : "";
  const signoffHtml = copyEmail.signoff
    ? esc(docCopy.fillTokens(copyEmail.signoff, tokens)).replace(/\r?\n/g, "<br/>")
    : `With gratitude,<br/><strong style="color:${NEUTRAL.ink}">Sales, ${esc(
        brandName,
      )}</strong>`;

  const content = [
    T.eyebrow("Payment confirmed"),
    T.heading(`${greeting} — your order is on its way to being made real.`),
    introBlock,
    T.paragraph(
      `We've received your payment for order <strong>${esc(
        order.order_number,
      )}</strong>, and it's now confirmed. Every piece is chosen and packed with care — thank you for letting ${esc(
        brandName,
      )} be part of your story.`,
    ),
    // Order summary
    T.eyebrow("Your order"),
    orderItems(order),
    orderTotals(order, accent),
    T.spacer(8),
    T.divider(),
    // When to expect it (delivery ETA or pickup window) — Settings-driven.
    fulfilmentPanel({ isPickup, order, settings, accent }),
    T.spacer(18),
    T.paragraph(
      `If anything at all isn't perfect, simply reply to this email${
        brandTokens.support_email
          ? ` or reach us at <a href="mailto:${esc(
              brandTokens.support_email,
            )}" style="color:${accent};text-decoration:none">${esc(
              brandTokens.support_email,
            )}</a>`
          : ""
      } — we're here and happy to help.`,
      { muted: true },
    ),
    T.spacer(8),
    T.paragraph(signoffHtml, { muted: true }),
    T.spacer(22),
  ].join("");

  const html = emailRender.renderStr(
    T.wrapEmail({
      preheader: `Payment received — your ${brandName} order ${order.order_number} is confirmed.`,
      content,
    }),
    {
      ...brandTokens,
      first_name: name || "there",
      unsubscribe_url: unsubscribe,
    },
  );

  return {
    subject: `Payment confirmed — your ${brandName} order ${order.order_number} 🌹`,
    html,
    text: T.toPlainText(html),
  };
}

/**
 * Render + send the order-confirmation email. Never throws.
 *
 * @param {object} a
 * @param {string} a.brand   brand key (pixiegirl | faitlynhair)
 * @param {object} a.order   full sales order (header + lines + internal_notes)
 * @param {object} a.contact { email, first_name, display_name }
 */
async function sendOrderConfirmationEmail({ brand, order, contact }) {
  if (!order || !contact || !contact.email) return;
  try {
    const brandTokens = await emailRender.resolveBrandTokens(brand);

    // Settings-driven fulfilment timeframes (delivery ETA / pickup window).
    let settings = {};
    try {
      const { rows } = await query(
        `SELECT fulfilment_settings FROM shared.business_config WHERE business_key = $1 LIMIT 1`,
        [brand],
      );
      settings = (rows[0] && rows[0].fulfilment_settings) || {};
    } catch (err) {
      logger.warn(
        { err: err.message, brand },
        "order confirmation: fulfilment_settings lookup failed — using defaults",
      );
    }

    // The campaign storefront always books order_type='dispatch'; the true
    // intent lives in internal_notes.fulfilment_type ('pickup' | 'delivery').
    const internal = asObject(order.internal_notes);
    const isPickup =
      internal.fulfilment_type === "pickup" ||
      order.order_type === "collection";

    // Curated, Settings-driven mail copy (Invoicing → Settings · receipt mail).
    let copyEmail = {};
    try {
      const copy = await docCopy.resolveCopy(brand);
      copyEmail = (copy.receipt && copy.receipt.email) || {};
    } catch {
      /* fall back to the email's built-in wording */
    }

    const { subject, html, text } = buildOrderConfirmationEmail({
      brandTokens,
      order,
      firstName: contact.first_name || contact.display_name || "",
      isPickup,
      settings,
      copyEmail,
    });

    await email.send({ to: contact.email, subject, html, text, brand });
    logger.info(
      { brand, order_id: order.order_id, isPickup },
      "order confirmation email sent",
    );
  } catch (err) {
    logger.error(
      { err: err.message, brand, order_id: order && order.order_id },
      "order confirmation email send failed — order unaffected",
    );
  }
}

module.exports = {
  sendOrderConfirmationEmail,
  buildOrderConfirmationEmail,
};
