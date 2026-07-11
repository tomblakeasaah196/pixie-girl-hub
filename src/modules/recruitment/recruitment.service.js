/**
 * Recruitment service — business logic, transactions, events, audit.
 *
 * The flow: draft (AI) → edit in the Studio → approve & send (mint offer packet
 * PDF + e-signature request + short branded email) → candidate signs on the
 * no-login /offer/<token> page (e-sign engine) → on full signature an employment
 * contract is generated + countersigned and a "login details to follow" welcome
 * email goes out (NO auto login) → an admin later provisions the login and
 * emails the one-time password straight to the new hire.
 *
 * Controllers never touch repos/esign directly; repos never emit events.
 */

"use strict";

const repo = require("./recruitment.repo");
const ai = require("./recruitment.ai");
const render = require("./recruitment.render");
const events = require("./recruitment.events");
const pdf = require("../../services/pdf.service");
const esign = require("../../shared/documents/documents.esign.service");
const invitations = require("../../shared/hr_payroll/invitations.service");
const email = require("../../services/email.service");
const { audit } = require("../../middleware/audit");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const { NotFoundError, ConflictError, AppError } = require("../../utils/errors");

const fs = require("fs");
const path = require("path");

const LOCKED = ["signed", "contracted", "provisioned"];

const escHtml = (s) =>
  String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const appUrl = () => (config.APP_URL || "").replace(/\/$/, "");
const offerLink = (token) => `${appUrl()}/offer/${token}`;

function loadLogoBase64(logoPath) {
  if (!logoPath) return null;
  const rel = logoPath.replace(/^\/+/, "");
  const candidates = [
    path.resolve(process.cwd(), rel),
    path.resolve(process.cwd(), "media", rel),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const ext = path.extname(p).toLowerCase().replace(".", "");
        const mime = ext === "svg" ? "image/svg+xml" : `image/${ext || "png"}`;
        return `data:${mime};base64,${fs.readFileSync(p).toString("base64")}`;
      }
    } catch { /* skip */ }
  }
  return null;
}

/** Resolve the issuing brand's display name, branding, and who countersigns offers. */
async function getCompany({ brand, targets }) {
  const rows = await repo.getContext({ businesses: [brand, ...(targets || [])] });
  const byKey = Object.fromEntries(rows.map((r) => [r.business, r]));
  const ctx = byKey[brand] || byKey["*"] || {};
  const glob = byKey["*"] || {};
  const branding = await repo.businessBranding({ brand });
  const displayName = branding?.display_name || ctx.display_name || brand;
  return {
    display_name: displayName,
    legal_name: branding?.legal_name || displayName,
    signatory_name: ctx.signatory_name || glob.signatory_name || "Faith",
    signatory_title: ctx.signatory_title || glob.signatory_title || "Chief Executive Officer",
    accent_colour: branding?.accent_colour || "#690909",
    secondary_colour: branding?.secondary_colour || "#A81D1D",
    logo_base64: loadLogoBase64(branding?.logo_path || branding?.logo_alt_path),
    brand_key: brand,
  };
}

// ── Company context pack ───────────────────────────────────
const getContextPack = () => repo.listContext();

async function updateContext({ user, request_id, business, input }) {
  const row = await repo.upsertContext({ business, fields: input, user_id: user.user_id });
  await audit({
    business: null,
    user_id: user.user_id,
    action_key: "recruitment.context.update",
    target_type: "recruitment_context",
    target_id: business,
    request_id,
  });
  return row;
}

// ── Role templates ─────────────────────────────────────────
const listTemplates = ({ brand }) => repo.listTemplates({ business: brand });
const createTemplate = ({ user, input }) =>
  repo.createTemplate({ input, user_id: user.user_id });
const deleteTemplate = ({ id }) => repo.deleteTemplate({ id });

// ── Offers: draft / edit ───────────────────────────────────
async function draftOffer({ brand, user, request_id, input }) {
  const targets =
    input.target_businesses && input.target_businesses.length
      ? input.target_businesses
      : [brand];

  let drafted = {
    jd_markdown: input.jd_markdown || "",
    offer_markdown: input.offer_markdown || "",
    offer_meta: input.offer_meta || {},
    provider: null,
  };
  if (input.use_ai !== false) {
    drafted = await ai.draft({
      intake: { title: input.title, target_businesses: targets, ...(input.intake || {}) },
      targets,
    });
  }

  const offer = await repo.createOffer({
    brand,
    user_id: user.user_id,
    input: {
      title: input.title,
      candidate_name: input.candidate_name,
      candidate_email: input.candidate_email,
      target_businesses: targets,
      opening_id: input.opening_id,
      jd_markdown: drafted.jd_markdown,
      offer_markdown: drafted.offer_markdown,
      offer_meta: drafted.offer_meta,
      role_ids: input.role_ids,
      is_ceo: input.is_ceo,
      ai_provider: drafted.provider,
    },
  });

  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "recruitment.offer.draft",
    target_type: "recruitment_offer",
    target_id: offer.offer_id,
    request_id,
  });
  events.emit("offer_drafted", { offer_id: offer.offer_id, business: brand });
  return offer;
}

async function regenerateDraft({ brand, user, request_id, id, intake }) {
  const offer = await repo.getOffer({ brand, id });
  if (!offer) throw new NotFoundError("Offer");
  if (LOCKED.includes(offer.status))
    throw new ConflictError(`Cannot redraft a ${offer.status} offer`);
  const targets = offer.target_businesses.length ? offer.target_businesses : [brand];
  const drafted = await ai.draft({
    intake: { title: offer.title, target_businesses: targets, ...(intake || {}) },
    targets,
  });
  const updated = await repo.updateOffer({
    id,
    fields: {
      jd_markdown: drafted.jd_markdown,
      offer_markdown: drafted.offer_markdown,
      offer_meta: drafted.offer_meta,
      ai_provider: drafted.provider,
    },
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "recruitment.offer.redraft",
    target_type: "recruitment_offer",
    target_id: id,
    request_id,
  });
  events.emit("offer_redrafted", { offer_id: id, business: brand });
  return updated;
}

const EDITABLE = [
  "title",
  "candidate_name",
  "candidate_email",
  "target_businesses",
  "jd_markdown",
  "offer_markdown",
  "offer_meta",
  "role_ids",
  "is_ceo",
];

async function editOffer({ brand, id, input }) {
  const offer = await repo.getOffer({ brand, id });
  if (!offer) throw new NotFoundError("Offer");
  if (LOCKED.includes(offer.status))
    throw new ConflictError(`Cannot edit a ${offer.status} offer`);
  const fields = {};
  for (const k of EDITABLE) if (input[k] !== undefined) fields[k] = input[k];
  return repo.updateOffer({ id, fields });
}

const listOffers = ({ brand, status }) => repo.listOffers({ brand, status });

async function getOffer({ brand, id }) {
  const offer = await repo.getOffer({ brand, id });
  if (!offer) throw new NotFoundError("Offer");
  return offer;
}

/** Server-authoritative rendered preview (what the candidate will see / sign). */
async function getRenderedOffer({ brand, id }) {
  const offer = await repo.getOffer({ brand, id });
  if (!offer) throw new NotFoundError("Offer");
  const company = await getCompany({ brand, targets: offer.target_businesses });
  return { ...render.renderForWeb(offer), company };
}

// ── Approve & send ─────────────────────────────────────────
async function approveAndSend({ brand, user, request_id, id, input = {} }) {
  let offer = await repo.getOffer({ brand, id });
  if (!offer) throw new NotFoundError("Offer");
  if (LOCKED.includes(offer.status))
    throw new ConflictError(`This offer is already ${offer.status}`);

  // Fold in any last-minute Studio edits sent with the approve action.
  const patch = {};
  for (const k of EDITABLE) if (input[k] !== undefined) patch[k] = input[k];
  if (Object.keys(patch).length) offer = await repo.updateOffer({ id, fields: patch });

  if (!offer.candidate_email)
    throw new AppError(
      "CANDIDATE_EMAIL_REQUIRED",
      "Enter the candidate's email before sending the offer",
      422,
    );

  const company = await getCompany({ brand, targets: offer.target_businesses });

  // 1) Render + store the offer packet PDF (JD + Offer Letter).
  const html = render.offerPacketHtml({ offer, company });
  const doc = await pdf.renderAndStore({
    brand,
    user_id: user.user_id,
    html,
    title: `Offer — ${offer.title} — ${offer.candidate_name || offer.candidate_email}`,
    document_type: "offer_letter",
    reference_type: "recruitment_offer",
    reference_id: offer.offer_id,
    request_id,
    pdfOptions: {
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#999;font-family:sans-serif;">
        <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
    },
  });

  // 2) E-signature request (candidate = sole external signer). Created directly
  //    in a signable state; we drive delivery via our own branded email below,
  //    so we deliberately do NOT call esign.sendRequest (that sends the generic
  //    signing-invite email). signByToken works from this state.
  const days = Number(input.expires_in_days) || 14;
  const expires_at = new Date(Date.now() + days * 86400_000).toISOString();
  const sreq = await esign.createRequest({
    brand,
    user,
    request_id,
    input: {
      document_id: doc.document_id,
      request_type: "employment_offer",
      reference_type: "recruitment_offer",
      reference_id: offer.offer_id,
      signing_order: "parallel",
      subject: `Offer of Employment — ${offer.title}`,
      message: input.message || null,
      expires_at,
      signers: [
        {
          external_name: offer.candidate_name || "Candidate",
          external_email: offer.candidate_email,
          display_email: offer.candidate_email,
          signer_role: "Candidate",
        },
      ],
    },
  });
  const token = sreq.signers[0].signing_token;

  const updated = await repo.updateOffer({
    id: offer.offer_id,
    fields: {
      status: "sent",
      public_token: token,
      signature_request_id: sreq.request_id,
      offer_document_id: doc.document_id,
      sent_at: new Date().toISOString(),
      expires_at,
    },
  });

  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "recruitment.offer.send",
    target_type: "recruitment_offer",
    target_id: offer.offer_id,
    after: { candidate_email: offer.candidate_email },
    request_id,
    is_sensitive: true,
  });

  // 3) Short branded email with the /offer/<token> link (best-effort).
  const link = offerLink(token);
  try {
    await email.send({
      brand,
      to: offer.candidate_email,
      subject: `Your offer from ${company.display_name}`,
      html: `<p>Hi ${escHtml(offer.candidate_name || "there")},</p>
             <p>We're delighted to share your offer for the role of <b>${escHtml(offer.title)}</b> at ${escHtml(company.display_name)}.</p>
             <p>Please review the full job description and offer letter, and sign at the bottom of the page:</p>
             <p><a href="${link}">Open your offer</a></p>
             <p>This link expires on ${new Date(expires_at).toDateString()}.</p>`,
      text: `Your offer for ${offer.title} at ${company.display_name}. Review and sign: ${link}`,
    });
  } catch (err) {
    logger.error(
      { err: err.message, offer_id: offer.offer_id },
      "recruitment: offer email failed (offer sent — admin can resend)",
    );
  }

  events.emit("offer_sent", { offer_id: offer.offer_id, business: brand });
  return updated;
}

// ── Public (no-login offer page) ───────────────────────────
async function getPublicOffer({ token, ip, ua }) {
  const offer = await repo.getOfferByToken({ token });
  if (!offer) throw new NotFoundError("Offer");

  let signer = null;
  let canSign = !LOCKED.includes(offer.status);
  try {
    const view = await esign.viewByToken({ token, ip, ua });
    signer = view.signer;
    canSign = !!view.signer.can_sign && signer.status !== "signed";
  } catch (err) {
    logger.warn({ err: err.message }, "recruitment: esign viewByToken failed on offer open");
  }

  const company = await getCompany({ brand: offer.business, targets: offer.target_businesses });
  const web = render.renderForWeb(offer);
  const signed = signer ? signer.status === "signed" : LOCKED.includes(offer.status);

  return {
    title: offer.title,
    candidate_name: offer.candidate_name,
    status: offer.status,
    signed,
    can_sign: canSign && !signed,
    jd_html: web.jd_html,
    offer_letter_html: web.offer_letter_html,
    company: {
      name: company.display_name,
      signatory_name: company.signatory_name,
      signatory_title: company.signatory_title,
    },
    signed_at: signer ? signer.signed_at : offer.signed_at,
    verification_code: signer ? signer.verification_code : null,
  };
}

async function signPublicOffer({ token, signature_data_url, ip, ua }) {
  const offer = await repo.getOfferByToken({ token });
  if (!offer) throw new NotFoundError("Offer");

  const result = await esign.signByToken({ token, signature_data_url, ip, ua });
  const fully = result && result.status === "fully_signed";

  if (fully) {
    await repo
      .updateOffer({
        id: offer.offer_id,
        fields: { status: "signed", signed_at: new Date().toISOString() },
      })
      .catch(() => {});
    // Generate the contract + welcome email now (awaited, non-fatal). The
    // documents 'signature.fully_signed' subscriber is a backstop and is
    // idempotent, so this never double-generates.
    try {
      await onOfferSigned({ offerId: offer.offer_id, business: offer.business });
    } catch (err) {
      logger.error(
        { err: err.message, offer_id: offer.offer_id },
        "recruitment: post-sign contract/welcome failed (offer is signed; can retry)",
      );
    }
  }

  return {
    signed: fully,
    verification_code: fully && result.signed ? result.signed.verification_code : null,
    signed_at: fully && result.signed ? result.signed.signed_at : null,
  };
}

/**
 * Post-signature: generate + countersign the employment contract and send the
 * "login details will follow" welcome email. Idempotent — safe to call from both
 * the sign path and the documents event subscriber.
 */
async function onOfferSigned({ offerId, business }) {
  const offer = await repo.getOffer({ brand: business || null, id: offerId });
  if (!offer) return;
  if (offer.contract_document_id || ["contracted", "provisioned"].includes(offer.status))
    return; // already handled

  const company = await getCompany({ brand: offer.business, targets: offer.target_businesses });
  const signedOffer = { ...offer, signed_at: offer.signed_at || new Date().toISOString() };

  // Contract generation (best-effort — a PDF outage must not block the welcome).
  try {
    const html = render.contractHtml({ offer: signedOffer, company });
    const doc = await pdf.renderAndStore({
      brand: offer.business,
      user_id: offer.created_by,
      html,
      title: `Contract — ${offer.title} — ${offer.candidate_name || offer.candidate_email}`,
      document_type: "employment_contract",
      reference_type: "recruitment_contract",
      reference_id: offer.offer_id,
    });
    await repo.updateOffer({
      id: offer.offer_id,
      fields: {
        status: "contracted",
        contract_document_id: doc.document_id,
        signed_at: signedOffer.signed_at,
      },
    });
    events.emit("offer_contracted", { offer_id: offer.offer_id, business: offer.business });
  } catch (err) {
    logger.error(
      { err: err.message, offer_id: offer.offer_id },
      "recruitment: contract generation failed (offer is signed; can regenerate)",
    );
  }

  // Welcome email — explicitly NO login yet (per the CEO): credentials follow.
  try {
    await email.send({
      brand: offer.business,
      to: offer.candidate_email,
      subject: `Welcome to ${company.display_name} — your offer is signed`,
      html: `<p>Hi ${escHtml(offer.candidate_name || "there")},</p>
             <p>Congratulations, and welcome to ${escHtml(company.display_name)}! We've received your
             signed offer for <b>${escHtml(offer.title)}</b> and prepared your employment contract.</p>
             <p><b>Your login details will be sent to you by email shortly</b> so you can access the Hub.</p>
             <p>We're excited to have you on board.</p>`,
      text: `Welcome to ${company.display_name}! Your signed offer for ${offer.title} is received. Your login details will follow by email shortly.`,
    });
  } catch (err) {
    logger.error(
      { err: err.message, offer_id: offer.offer_id },
      "recruitment: welcome email failed",
    );
  }
}

// ── Provision & email credentials (explicit admin button) ──
async function provisionCredentials({ brand, user, request_id, id }) {
  const offer = await repo.getOffer({ brand, id });
  if (!offer) throw new NotFoundError("Offer");
  if (!["signed", "contracted"].includes(offer.status))
    throw new ConflictError(
      "The candidate must sign the offer before you can provision an account",
    );
  if (offer.provisioned_user_id)
    throw new ConflictError("An account has already been provisioned for this offer");
  if (!offer.candidate_email)
    throw new AppError("CANDIDATE_EMAIL_REQUIRED", "No candidate email on this offer", 422);

  const businessKeys =
    offer.target_businesses && offer.target_businesses.length
      ? offer.target_businesses
      : [brand];

  // Reuse the HR login provisioner (temp password + force reset). It does NOT
  // email anything itself — we email the credentials straight to the candidate.
  const result = await invitations.provisionLogin({
    user,
    request_id,
    input: {
      email: offer.candidate_email,
      display_name: offer.candidate_name,
      role_ids: offer.role_ids || [],
      business_keys: businessKeys,
      default_business: businessKeys[0],
      is_ceo: offer.is_ceo || false,
    },
  });

  const newUserId = await repo.userIdByEmail({ email: offer.candidate_email });
  const company = await getCompany({ brand, targets: offer.target_businesses });
  const loginUrl = `${appUrl()}/login`;

  await email.send({
    brand,
    to: offer.candidate_email,
    subject: `Your ${company.display_name} Hub login`,
    html: `<p>Hi ${escHtml(offer.candidate_name || "there")},</p>
           <p>Your account is ready. Here are your login details — please change your password on first sign-in:</p>
           <p><b>Sign in:</b> <a href="${loginUrl}">${loginUrl}</a><br/>
              <b>Email:</b> ${escHtml(result.email)}<br/>
              <b>Temporary password:</b> ${escHtml(result.temp_password)}</p>
           <p>For your security you'll be asked to set a new password when you first log in.</p>`,
    text: `Your ${company.display_name} Hub login — Sign in: ${loginUrl} · Email: ${result.email} · Temporary password: ${result.temp_password} (you'll change it on first login).`,
  });

  const updated = await repo.updateOffer({
    id: offer.offer_id,
    fields: {
      status: "provisioned",
      provisioned_user_id: newUserId,
      provisioned_at: new Date().toISOString(),
    },
  });

  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "recruitment.offer.provision",
    target_type: "recruitment_offer",
    target_id: offer.offer_id,
    after: { user_id: newUserId, email: result.email },
    request_id,
    is_sensitive: true,
  });
  events.emit("offer_provisioned", {
    offer_id: offer.offer_id,
    business: brand,
    user_id: newUserId,
  });

  // The temp password went straight to the candidate — never surfaced to admin.
  return { email: result.email, emailed: true, user_id: newUserId, status: updated.status };
}

module.exports = {
  // context
  getContextPack,
  updateContext,
  // templates
  listTemplates,
  createTemplate,
  deleteTemplate,
  // offers (admin)
  draftOffer,
  regenerateDraft,
  editOffer,
  listOffers,
  getOffer,
  getRenderedOffer,
  approveAndSend,
  provisionCredentials,
  // public
  getPublicOffer,
  signPublicOffer,
  // events
  onOfferSigned,
};
