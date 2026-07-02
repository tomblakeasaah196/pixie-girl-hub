/**
 * Stylist Partner Programme (V2.2 §6.26) — partner contract (Q10).
 *
 * Flow: vetting passes → contract PDF generated from the template (Puppeteer)
 * → e-signature request via Documents & Signatures (§6.13) → the partner
 * signs through their emailed token link (or the portal contract screen,
 * which drives the same public sign endpoint) → on fully_signed the
 * subscriber stamps contract_signed_at and the badge auto-issues.
 *
 * Template: stylist_programme_config.contract_template_doc_id may point at an
 * HTML document whose {{merge_tokens}} are substituted; otherwise the built-in
 * default agreement below is used.
 */

"use strict";

const repo = require("./stylist.repo");
const programmeRepo = require("./programme.repo");
const notify = require("./stylist.notify");
const events = require("./stylist.events");
const documents = require("../../shared/documents/documents.service");
const esign = require("../../shared/documents/documents.esign.service");
const pdf = require("../../services/pdf.service");
const { audit } = require("../../middleware/audit");
const { query } = require("../../config/database");
const { NotFoundError, AppError } = require("../../utils/errors");
const { logger } = require("../../config/logger");

const BRAND = notify.BRAND;

function defaultTemplate() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: Georgia, serif; margin: 48px 56px; color: #1c1c1c; line-height: 1.65; }
    h1 { color: #690909; font-size: 22px; } h2 { font-size: 15px; margin-top: 28px; }
    .meta { border: 1px solid #ddd; padding: 12px 16px; margin: 20px 0; font-size: 13px; }
    .sig { margin-top: 56px; border-top: 1px solid #999; width: 280px; padding-top: 6px; font-size: 12px; }
  </style></head><body>
    <h1>Pixie Girl Global — Stylist Partner Agreement</h1>
    <div class="meta">
      Partner: <strong>{{partner_name}}</strong> ({{partner_code}})<br>
      Location: {{city}}, {{country}}<br>
      Date: {{date}}
    </div>
    <h2>1. The Partnership</h2>
    <p>Pixie Girl Global ("Pixie") admits the Partner into the Stylist Partner
    Programme as a vetted, certified servicer of Pixie hair. Certification is
    tiered, time-bound and revocable; the Partner's public verification page
    reflects their live status at all times.</p>
    <h2>2. Customer Ownership &amp; Payment</h2>
    <p>Customers routed through the platform pay Pixie; Pixie pays the Partner
    their agreed service rate after the customer confirms satisfaction or the
    quality-hold window lapses. The Partner earns a commission of
    {{commission_pct}}% on wig sales attributed to their referral link.</p>
    <h2>3. Quality &amp; Conduct</h2>
    <p>The Partner upholds Pixie's published service standards. Ratings below
    threshold, verified complaints or misuse of the badge may lead to
    suspension or termination, reflected immediately on the public
    verification page.</p>
    <h2>4. Term</h2>
    <p>This agreement runs while the Partner holds a current certification and
    may be terminated by either party with notice.</p>
    <div class="sig">Partner signature</div>
  </body></html>`;
}

async function buildContractHtml({ partner, cfg }) {
  let html = null;
  if (cfg && cfg.contract_template_doc_id) {
    try {
      const dl = await documents.download({
        brand: BRAND,
        id: cfg.contract_template_doc_id,
      });
      html = dl.buffer.toString("utf8");
    } catch (err) {
      logger.warn(
        { err: err.message },
        "stylist contract: template doc unreadable — using default",
      );
    }
  }
  if (!html) html = defaultTemplate();
  const commission =
    partner.referral_commission_pct ??
    (cfg ? cfg.referral_commission_pct : 10);
  const tokens = {
    partner_name: partner.display_name,
    partner_code: partner.partner_code,
    city: partner.city || "",
    country: partner.country_code || "",
    date: new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
    commission_pct: String(commission),
  };
  return html.replace(/\{\{(\w+)\}\}/g, (m, k) =>
    tokens[k] !== undefined ? tokens[k] : m,
  );
}

/** Generate the contract PDF, open + send the e-sign request, email the link. */
async function generateAndSend({ user, request_id, stylist_id }) {
  const partner = await repo.findPartner({ id: stylist_id });
  if (!partner) throw new NotFoundError("Stylist");
  const { rows } = await query(
    `SELECT email, display_name FROM shared.contacts WHERE contact_id = $1`,
    [partner.contact_id],
  );
  const contact = rows[0];
  if (!contact || !contact.email)
    throw new AppError(
      "NO_EMAIL",
      "Partner has no email on their contact record",
      422,
    );

  const cfg = await programmeRepo.getConfig({ business: BRAND });
  const html = await buildContractHtml({ partner, cfg });
  const buffer = await pdf.renderHtmlToPdf(html);
  const doc = await documents.store({
    brand: BRAND,
    user_id: user ? user.user_id : null,
    buffer,
    filename: `${partner.partner_code}-partner-agreement.pdf`,
    mime_type: "application/pdf",
    document_type: "stylist_contract",
    title: `Partner Agreement — ${partner.display_name}`,
    reference_type: "stylist_partner",
    reference_id: stylist_id,
    request_id,
  });

  const request = await esign.createRequest({
    brand: BRAND,
    user,
    request_id,
    input: {
      document_id: doc.document_id,
      request_type: "stylist_partner_agreement",
      reference_type: "stylist_partner",
      reference_id: stylist_id,
      signing_order: "parallel",
      subject: "Pixie Girl Stylist Partner Agreement",
      message: "Please review and sign your partner agreement.",
      signers: [
        {
          // Exactly ONE identity per signer (signer_identity_exactly_one):
          // the partner signs as their contact; snapshots carry name/email.
          contact_id: partner.contact_id,
          display_name: partner.display_name,
          display_email: contact.email,
          signer_role: "partner",
        },
      ],
    },
  });
  await esign.sendRequest({
    brand: BRAND,
    user,
    request_id,
    id: request.request_id,
  });

  await repo.updatePartner({
    id: stylist_id,
    patch: {
      contract_document_id: doc.document_id,
      contract_signature_request_id: request.request_id,
      contract_signed_at: null,
    },
  });

  const signer = request.signers && request.signers[0];
  if (signer && signer.signing_token)
    await notify.emailAddress({
      to: contact.email,
      subject: "Your Pixie Girl Partner Agreement is ready to sign",
      bodyHtml: `<p>Hi ${partner.display_name},</p>
        <p>Your partner agreement has been prepared. Review and sign it to
        activate your verified partner badge — the badge issues automatically
        the moment you sign.</p>`,
      ctaLabel: "Review & sign",
      ctaPath: `/contract/sign?token=${signer.signing_token}`,
    });

  await audit({
    business: BRAND,
    user_id: user ? user.user_id : null,
    action_key: "stylist.contract.send",
    target_type: "stylist_partner",
    target_id: stylist_id,
    after: { document_id: doc.document_id, request_id: request.request_id },
    request_id,
  });
  events.emit("contract.sent", { stylist_id, document_id: doc.document_id });
  return {
    document_id: doc.document_id,
    signature_request_id: request.request_id,
  };
}

/**
 * Reaction to documents `signature.fully_signed` (wired in subscribers):
 * stamp the signature and auto-issue the badge (§6.26 — "the badge issues
 * automatically on signature").
 */
async function onContractSigned({ reference_id }) {
  const partner = await repo.findPartner({ id: reference_id });
  if (!partner) return;
  await repo.updatePartner({
    id: partner.stylist_id,
    patch: { contract_signed_at: new Date().toISOString() },
  });
  if (!partner.badge_token || partner.badge_revoked_at) {
    const stylistService = require("./stylist.service");
    await stylistService.issueBadge({
      brand: BRAND,
      user: { user_id: null },
      request_id: null,
      id: partner.stylist_id,
    });
  }
  events.emit("contract.signed", { stylist_id: partner.stylist_id });
  await notify.notifyStylist({
    stylist_id: partner.stylist_id,
    type: "contract",
    title: "Contract signed — your badge is live",
    body: "Your partner agreement is fully signed and your verified badge has been issued.",
    data: {},
    email: {
      subject: "Your verified Pixie Girl partner badge is live",
      bodyHtml: `<p>Your partner agreement is fully signed. Your verifiable
        badge is now active — download your badge card and share your live
        verification page from the dashboard.</p>`,
      ctaLabel: "Open your dashboard",
      ctaPath: "/dashboard",
    },
  });
}

/** Portal view: the contract document + live signing state. */
async function getContractState({ stylist_id }) {
  const partner = await repo.findPartner({ id: stylist_id });
  if (!partner) throw new NotFoundError("Stylist");
  if (!partner.contract_document_id) return { exists: false };
  const out = {
    exists: true,
    document_id: partner.contract_document_id,
    signed_at: partner.contract_signed_at,
    status: partner.contract_signed_at ? "fully_signed" : "sent",
    signing_token: null,
  };
  if (!partner.contract_signed_at && partner.contract_signature_request_id) {
    const { rows } = await query(
      `SELECT s.signing_token, s.status AS signer_status, r.status
         FROM shared.signature_requests r
         JOIN shared.signature_request_signers s ON s.request_id = r.request_id
        WHERE r.request_id = $1
        ORDER BY s.signing_step LIMIT 1`,
      [partner.contract_signature_request_id],
    );
    if (rows[0]) {
      out.status = rows[0].status;
      if (!["fully_signed", "declined", "cancelled", "voided"].includes(rows[0].status))
        out.signing_token = rows[0].signing_token;
    }
  }
  return out;
}

module.exports = { generateAndSend, onContractSigned, getContractState };
