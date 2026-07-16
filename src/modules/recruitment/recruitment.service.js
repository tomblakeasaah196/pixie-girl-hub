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
const storage = require("../../services/storage.service");
const invitations = require("../../shared/hr_payroll/invitations.service");
const contractsRepo = require("../../shared/hr_payroll/contracts.repo");
const { sendTransactionalEmail } = require("../../services/transactional-email");
const { audit } = require("../../middleware/audit");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const { NotFoundError, ConflictError, AppError } = require("../../utils/errors");
const { formatDate } = require("../../utils/dates");

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
// Direct, no-login download of the offer packet PDF (candidate's stamped
// signature included once signed). Served by the public recruitment router —
// works straight from an email client, no SPA needed.
const offerPdfLink = (token) => `${appUrl()}/api/public/offer/${token}/pdf?download=1`;

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
    // Countersignatory: per-brand row wins over the '*' shared row; either can
    // carry the captured signature image so the rendered packet stamps a real
    // hand-drawn signature next to the candidate's — never a bare ruled line.
    signatory_name: ctx.signatory_name || glob.signatory_name || "Faitlyn Alex",
    signatory_title: ctx.signatory_title || glob.signatory_title || "Chief Executive Officer",
    signatory_signature_data_url:
      ctx.signatory_signature_data_url || glob.signatory_signature_data_url || null,
    accent_colour: branding?.accent_colour || "#690909",
    secondary_colour: branding?.secondary_colour || "#A81D1D",
    logo_base64: loadLogoBase64(branding?.logo_path || branding?.logo_alt_path),
    // Business Setup contact strip — populated fields show on the cover; empty
    // fields are simply skipped by the renderer so a partly-configured brand
    // still looks intentional, not broken.
    address: branding?.address || null,
    phone: branding?.phone || null,
    email: branding?.email || null,
    website: branding?.website || null,
    tin: branding?.tin || null,
    cac_number: branding?.cac_number || null,
    mission_statement: branding?.mission_statement || null,
    brand_key: brand,
  };
}

/**
 * Resolve the candidate's captured e-signature for an offer, as a base64 image
 * data URL plus signing metadata — so it can be stamped into the PDF and shown
 * on screen. Returns null when the offer isn't signed yet. Handles both the
 * inline draw flow (signature_data_url) and the legacy media-path flow.
 */
async function resolveOfferSignature(offer) {
  const sig = await repo.getOfferSignature({ request_id: offer.signature_request_id });
  if (!sig) return null;
  let data_url = sig.signature_data_url || null;
  if (!data_url && sig.captured_signature_path) {
    try {
      const buf = await storage.get(sig.captured_signature_path);
      const ext = String(sig.captured_signature_path).split(".").pop().toLowerCase();
      const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
      data_url = `data:${mime};base64,${buf.toString("base64")}`;
    } catch (err) {
      logger.warn(
        { err: err.message, offer_id: offer.offer_id },
        "recruitment: could not load captured signature image",
      );
    }
  }
  if (!data_url) return null;
  return {
    data_url,
    captured_signature_path: sig.captured_signature_path || null,
    signed_at: sig.signed_at || offer.signed_at || null,
    verification_code: sig.verification_code || null,
    signer_name: sig.display_name_snapshot || offer.candidate_name || null,
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
  // Once accepted, surface the candidate's captured signature so the Studio can
  // show the actual signature (not just "signed") beneath the document.
  if (LOCKED.includes(offer.status)) {
    offer.signature = await resolveOfferSignature(offer);
  }
  return offer;
}

/** Server-authoritative rendered preview (what the candidate will see / sign). */
async function getRenderedOffer({ brand, id }) {
  const offer = await repo.getOffer({ brand, id });
  if (!offer) throw new NotFoundError("Offer");
  const company = await getCompany({ brand, targets: offer.target_businesses });
  const signature = LOCKED.includes(offer.status)
    ? await resolveOfferSignature(offer)
    : null;
  // The full packet HTML is the *same* HTML the PDF exporter uses. The admin
  // studio and the candidate offer page both iframe this so the preview and
  // the downloadable PDF are literally the same document — zero drift.
  const packet_html = render.offerPacketHtml({ offer, company, signature });
  return { ...render.renderForWeb(offer), packet_html, company };
}

/**
 * Live-edit preview: re-render the packet HTML using the studio's in-flight
 * markdown drafts (jd_markdown / offer_markdown) instead of the persisted row.
 * Falls back silently to the persisted values when a field isn't provided.
 * Never mutates the offer.
 */
async function previewOffer({ brand, id, drafts = {} }) {
  const offer = await repo.getOffer({ brand, id });
  if (!offer) throw new NotFoundError("Offer");
  const company = await getCompany({ brand, targets: offer.target_businesses });
  const merged = {
    ...offer,
    jd_markdown: drafts.jd_markdown ?? offer.jd_markdown,
    offer_markdown: drafts.offer_markdown ?? offer.offer_markdown,
    title: drafts.title ?? offer.title,
    candidate_name: drafts.candidate_name ?? offer.candidate_name,
  };
  const signature = LOCKED.includes(offer.status)
    ? await resolveOfferSignature(offer)
    : null;
  const packet_html = render.offerPacketHtml({ offer: merged, company, signature });
  return { packet_html };
}

// ── PDF export (on-demand, branded, page-numbered) ─────────
const EXPORT_KINDS = new Set(["packet", "jd", "offer"]);

/**
 * Render a branded, page-numbered PDF for an offer on demand and return the
 * bytes (never persisted — this is a download). `doc` selects which document:
 *   • 'packet' — Job Description + Offer Letter + execution block (default)
 *   • 'jd'     — Job Description only
 *   • 'offer'  — Offer Letter only (with execution block)
 * When the offer is signed, the candidate's e-signature is stamped into the
 * execution block so it rides in the PDF itself.
 */
/**
 * Render the chosen document to branded, page-numbered PDF bytes. Shared by the
 * admin export and the public (tokenised) export so both produce a byte-for-byte
 * identical file. `signature` is resolved here and is null until the offer is
 * signed — once signed, the candidate's e-signature is stamped into the
 * execution block so it rides in the PDF itself.
 */
async function buildOfferPdf({ offer, company, doc = "packet" }) {
  const kind = EXPORT_KINDS.has(doc) ? doc : "packet";
  const signature = await resolveOfferSignature(offer); // null until signed

  let html;
  let label;
  if (kind === "jd") {
    html = render.jobDescriptionHtml({ offer, company });
    label = "Job-Description";
  } else if (kind === "offer") {
    html = render.offerLetterHtml({ offer, company, signature });
    label = "Offer-Letter";
  } else {
    html = render.offerPacketHtml({ offer, company, signature });
    label = "Offer-Packet";
  }

  const buffer = await pdf.renderHtmlToPdf(html, render.pdfDocOptions(company));
  const safe = (s) => String(s || "").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
  const filename = `${label}_${safe(offer.title) || "role"}_${
    safe(offer.candidate_name || offer.candidate_email) || "candidate"
  }.pdf`;
  return { buffer, filename, mime_type: "application/pdf" };
}

async function exportOfferPdf({ brand, id, doc = "packet" }) {
  const offer = await repo.getOffer({ brand, id });
  if (!offer) throw new NotFoundError("Offer");
  const company = await getCompany({ brand, targets: offer.target_businesses });
  return buildOfferPdf({ offer, company, doc });
}

/**
 * Public (no-login) export: the candidate downloads the SAME branded PDF from
 * their tokenised offer link — the full offer packet by default, or ?doc=jd|offer.
 * Available BEFORE and AFTER signing; once signed, their stamped e-signature is
 * in the packet. No permission gate — the unguessable token is the credential,
 * exactly as the existing read/sign endpoints already treat it.
 */
async function exportPublicOfferPdf({ token, doc = "packet" }) {
  const offer = await repo.getOfferByToken({ token });
  if (!offer) throw new NotFoundError("Offer");
  const company = await getCompany({ brand: offer.business, targets: offer.target_businesses });
  return buildOfferPdf({ offer, company, doc });
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

  // 1) Render + store the offer packet PDF (JD + Offer Letter). Branded,
  //    full-bleed and page-numbered via the shared document options.
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
    pdfOptions: render.pdfDocOptions(company),
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

  // 3) Branded, house-styled email with the /offer/<token> link (best-effort).
  const link = offerLink(token);
  try {
    await sendTransactionalEmail({
      brand,
      to: offer.candidate_email,
      subject: `Your offer from ${company.display_name}`,
      preheader: `Your offer of employment for ${offer.title} — review and sign online.`,
      eyebrow: "Your offer of employment",
      heading: `Congratulations, ${offer.candidate_name || "and welcome"}`,
      intro: `We're delighted to share your offer for the role of <b>${escHtml(
        offer.title,
      )}</b> at ${escHtml(company.display_name)}.`,
      body: [
        {
          html: "Please review the full job description and offer letter, then sign at the bottom of the page. You can download a PDF copy at any time — before or after you sign.",
          muted: true,
        },
      ],
      cta: { label: "Open & sign your offer", url: link },
      notice: `This secure link expires on <b>${escHtml(formatDate(expires_at))}</b>. If it lapses before you sign, contact us and we'll send a fresh one.`,
      signoff: `We're looking forward to welcoming you.<br/>The ${escHtml(
        company.display_name,
      )} team`,
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

  // Once signed, hand the candidate back their own captured signature so the
  // signed offer page shows the actual signature (not just "signed").
  const signature = signed ? await resolveOfferSignature(offer) : null;
  // The candidate reads the SAME packet HTML the PDF exporter produces — so
  // "what you see is what you sign is what you download". The renderer stamps
  // the countersignatory's captured signature (if configured) and, once the
  // candidate has signed, their own signature too.
  const packet_html = render.offerPacketHtml({ offer, company, signature });

  return {
    title: offer.title,
    candidate_name: offer.candidate_name,
    status: offer.status,
    signed,
    can_sign: canSign && !signed,
    jd_html: web.jd_html,
    offer_letter_html: web.offer_letter_html,
    packet_html,
    company: {
      // business_key so the public offer page can resolve the brand's
      // logo + Layer-B colours from /api/public/branding (the branded
      // PublicBrandShell). `name` stays the display string used in copy.
      business: offer.business,
      name: company.display_name,
      signatory_name: company.signatory_name,
      signatory_title: company.signatory_title,
    },
    signed_at: (signature && signature.signed_at) || (signer ? signer.signed_at : offer.signed_at),
    verification_code:
      (signature && signature.verification_code) || (signer ? signer.verification_code : null),
    signature_data_url: signature ? signature.data_url : null,
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
  // The tokenised offer link keeps working after signing, so we offer a direct
  // "download your signed offer" button here (the packet PDF carries their
  // stamped signature). Only shown when we actually have the public token.
  try {
    await sendTransactionalEmail({
      brand: offer.business,
      to: offer.candidate_email,
      subject: `Welcome to ${company.display_name} — your offer is signed`,
      preheader: `Your signed offer for ${offer.title} is received — your login details will follow.`,
      eyebrow: "Offer accepted",
      heading: `Welcome to ${company.display_name}`,
      intro: `Congratulations, ${escHtml(
        offer.candidate_name || "and welcome aboard",
      )}! We've received your signed offer for <b>${escHtml(
        offer.title,
      )}</b> and prepared your employment contract.`,
      body: [
        {
          html: "<b>Your login details will be sent to you by email shortly</b> so you can access the Hub.",
        },
      ],
      cta: offer.public_token
        ? { label: "Download your signed offer", url: offerPdfLink(offer.public_token) }
        : null,
      signoff: `We're excited to have you on board.<br/>The ${escHtml(
        company.display_name,
      )} team`,
    });
  } catch (err) {
    logger.error(
      { err: err.message, offer_id: offer.offer_id },
      "recruitment: welcome email failed",
    );
  }
}

// ── Provision & email credentials (explicit admin button) ──
/**
 * `input` comes from the onboarding wizard (both optional):
 *   • staff_profile_id — the HR employee profile created during onboarding.
 *     Linking it here is what makes the hire a *full* employee: they appear in
 *     the HR directory and their organigramme seat, and org-position role
 *     grants resolve to this login instead of nothing.
 *   • role_ids — replaces the offer's stored grants (e.g. the role of the
 *     position the hire was seated in).
 * When a profile is linked and the offer has a generated employment contract,
 * the contract PDF is also filed under the employee's HR contracts.
 */
async function provisionCredentials({ brand, user, request_id, id, input = {} }) {
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

  let profile = null;
  if (input.staff_profile_id) {
    profile = await repo.staffProfileBrief({ profile_id: input.staff_profile_id });
    if (!profile || profile.is_deleted)
      throw new AppError(
        "STAFF_PROFILE_NOT_FOUND",
        "The employee profile to link was not found",
        422,
      );
  }

  const businessKeys =
    offer.target_businesses && offer.target_businesses.length
      ? offer.target_businesses
      : [brand];
  const roleIds =
    input.role_ids && input.role_ids.length ? input.role_ids : offer.role_ids || [];

  // Reuse the HR login provisioner (temp password + force reset). It does NOT
  // email anything itself — we email the credentials straight to the candidate.
  const result = await invitations.provisionLogin({
    user,
    request_id,
    input: {
      email: offer.candidate_email,
      display_name: offer.candidate_name,
      role_ids: roleIds,
      business_keys: businessKeys,
      default_business: businessKeys[0],
      is_ceo: offer.is_ceo || false,
      staff_profile_id: profile ? profile.profile_id : null,
    },
  });

  // File the countersigned employment contract under the employee's HR record
  // (best-effort — a filing hiccup must not unwind a provisioned login).
  if (profile && offer.contract_document_id) {
    try {
      const CONTRACT_TYPES = new Set(["full_time", "part_time", "contract"]);
      await contractsRepo.createContract({
        input: {
          profile_id: profile.profile_id,
          contract_type: CONTRACT_TYPES.has(profile.employment_type)
            ? profile.employment_type
            : "full_time",
          effective_from: profile.start_date || new Date().toISOString().slice(0, 10),
          gross_salary: profile.base_salary || 0,
          document_id: offer.contract_document_id,
          notes: `Recruitment offer — ${offer.title}`,
          created_by: user.user_id,
        },
      });
    } catch (err) {
      logger.warn(
        { err: err.message, offer_id: offer.offer_id },
        "recruitment: could not file the employment contract on the HR profile",
      );
    }
  }

  const newUserId = await repo.userIdByEmail({ email: offer.candidate_email });
  const company = await getCompany({ brand, targets: offer.target_businesses });
  const loginUrl = `${appUrl()}/login`;

  await sendTransactionalEmail({
    brand,
    to: offer.candidate_email,
    subject: `Your ${company.display_name} Hub login`,
    preheader: `Your account is ready — here are your sign-in details.`,
    eyebrow: "Your account is ready",
    heading: `Welcome to the ${company.display_name} Hub`,
    intro: `Hi ${escHtml(
      offer.candidate_name || "there",
    )}, your account is set up. Here are your login details — you'll be asked to set a new password the first time you sign in.`,
    details: [
      { label: "Email", value: result.email },
      { label: "Temporary password", value: result.temp_password, mono: true },
    ],
    cta: { label: "Sign in to the Hub", url: loginUrl },
    notice: `For your security, please change this temporary password on first sign-in and don't share it with anyone.`,
    signoff: `See you inside.<br/>The ${escHtml(company.display_name)} team`,
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
  previewOffer,
  exportOfferPdf,
  approveAndSend,
  provisionCredentials,
  // public
  getPublicOffer,
  signPublicOffer,
  exportPublicOfferPdf,
  // events
  onOfferSigned,
};
