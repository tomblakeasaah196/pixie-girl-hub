/**
 * Stylist Partner Programme (V2.2 §6.26) — downloadable badge card (Q11).
 *
 * A branded, printable card (PDF via the shared Puppeteer service) carrying
 * the partner's name, tier, partner ID and a QR that encodes the live
 * verification URL — the QR is just the encoded URL; the verify page is the
 * source of truth (revocation reflects instantly, the card does not need
 * reprinting to be invalidated).
 */

"use strict";

const QRCode = require("qrcode");
const repo = require("./stylist.repo");
const programmeRepo = require("./programme.repo");
const notify = require("./stylist.notify");
const pdf = require("../../services/pdf.service");
const { NotFoundError, AppError } = require("../../utils/errors");

async function verifyUrl(partner) {
  const base = await notify.portalBaseUrl();
  return `${base}/verify/badge/${partner.badge_token}`;
}

function cardHtml({ partner, tier, qrDataUrl, url }) {
  const tierLabel = tier ? tier.label : "Partner";
  const tierColor = (tier && tier.badge_color) || "#690909";
  const expiry = partner.current_tier_expires_at
    ? new Date(partner.current_tier_expires_at).toLocaleDateString("en-GB", {
        month: "short",
        year: "numeric",
      })
    : "—";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; font-family: Montserrat, Helvetica, Arial, sans-serif;
           display: flex; justify-content: center; padding-top: 24px; }
    .card { width: 340px; height: 540px; box-sizing: border-box; padding: 32px 28px;
            border-radius: 18px;
            background: linear-gradient(160deg, #171214 0%, #241418 55%, #2e161b 100%);
            color: #f5efe8; display: flex; flex-direction: column; }
    .brand { font-family: Georgia, 'Playfair Display', serif; font-size: 15px;
             letter-spacing: 3px; text-transform: uppercase; color: #cdb8a0; }
    .tier { margin-top: 26px; display: inline-block; padding: 5px 14px; border-radius: 999px;
            border: 1px solid ${tierColor}; color: #fff; background: ${tierColor}22;
            font-size: 12px; letter-spacing: 2px; text-transform: uppercase; align-self: flex-start; }
    .name { font-family: Georgia, 'Playfair Display', serif; font-size: 27px; margin-top: 14px; line-height: 1.25; }
    .code { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #cdb8a0; margin-top: 6px; }
    .qrbox { margin-top: auto; background: #fff; border-radius: 12px; padding: 14px;
             width: 168px; height: 168px; align-self: center; }
    .qrbox img { width: 100%; height: 100%; }
    .verify { text-align: center; font-size: 10px; color: #cdb8a0; margin-top: 12px; word-break: break-all; }
    .valid { text-align: center; font-size: 10px; color: #8d7f70; margin-top: 4px; }
  </style></head><body><div class="card">
    <div class="brand">Pixie Girl Global</div>
    <div class="tier">${tierLabel} Partner</div>
    <div class="name">${partner.display_name}</div>
    <div class="code">${partner.partner_code}</div>
    <div class="qrbox"><img src="${qrDataUrl}" alt="verify QR"></div>
    <div class="verify">Scan to verify · ${url}</div>
    <div class="valid">Tier valid to ${expiry} · status live on the verification page</div>
  </div></body></html>`;
}

/** Badge payload for the portal (verify URL + QR + tier). */
async function badgeInfo({ stylist_id }) {
  const partner = await repo.findPartner({ id: stylist_id });
  if (!partner) throw new NotFoundError("Stylist");
  if (!partner.badge_token || partner.badge_revoked_at)
    return { issued: false };
  const url = await verifyUrl(partner);
  const tier = partner.current_tier_key
    ? await programmeRepo.findTier({ tier_key: partner.current_tier_key })
    : null;
  return {
    issued: true,
    verify_url: url,
    qr_data_url: await QRCode.toDataURL(url, { margin: 1, width: 320 }),
    tier_key: partner.current_tier_key,
    tier_label: tier ? tier.label : null,
    tier_expires_at: partner.current_tier_expires_at,
    partner_code: partner.partner_code,
  };
}

/** The printable card as a PDF buffer. */
async function renderCard({ stylist_id }) {
  const partner = await repo.findPartner({ id: stylist_id });
  if (!partner) throw new NotFoundError("Stylist");
  if (!partner.badge_token || partner.badge_revoked_at)
    throw new AppError("NO_BADGE", "No active badge to render", 422);
  const url = await verifyUrl(partner);
  const tier = partner.current_tier_key
    ? await programmeRepo.findTier({ tier_key: partner.current_tier_key })
    : null;
  const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 480 });
  const buffer = await pdf.renderHtmlToPdf(
    cardHtml({ partner, tier, qrDataUrl, url }),
    {
      footerTemplate: "<span></span>",
      headerTemplate: "<span></span>",
      margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" },
    },
  );
  return {
    buffer,
    filename: `${partner.partner_code}-badge.pdf`,
    mime_type: "application/pdf",
  };
}

module.exports = { badgeInfo, renderCard };
