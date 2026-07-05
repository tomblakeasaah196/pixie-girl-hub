/**
 * Documents & Signatures (V2.2 §6.13) — e-signature service.
 *
 * Lifecycle: draft → sent → (partially_signed) → fully_signed | declined | cancelled | expired | voided.
 * Signing order may be 'sequential' (one step at a time) or 'parallel' (all at once).
 * Every state change appends a hash-linked audit event (prev_event_hash → event_hash)
 * so the signing trail is tamper-evident. External signers act via an unguessable
 * signing_token (no login); internal signers via their user_id.
 */

"use strict";

const crypto = require("crypto");
const argon2 = require("argon2");
// config/database exports `transaction` + `query`; alias transaction so the
// existing withTransaction(...) call sites below keep working.
const { transaction: withTransaction, query } = require("../../config/database");
const repo = require("./documents.esign.repo");
const documentsEvents = require("./documents.events");
const { audit } = require("../../middleware/audit");
const {
  NotFoundError,
  ValidationError,
  ConflictError,
} = require("../../utils/errors");

const sha256 = (s) =>
  crypto.createHash("sha256").update(String(s)).digest("hex");
const newToken = () => crypto.randomBytes(32).toString("base64url");

/**
 * Short, human-readable verification code derived from the full audit hash.
 * 12 hex chars grouped in threes — e.g. "A4F8-E2C9-1B3D". Printed on the
 * signed document and resolvable on the public verify page. The full
 * 256-bit audit_hash remains the security boundary; this is a lookup aid.
 */
const codeFromHash = (hash) =>
  hash
    .slice(0, 12)
    .toUpperCase()
    .match(/.{1,4}/g)
    .join("-");

/**
 * Content-integrity hash for a signature: binds WHO signed WHICH document
 * WHEN with WHICH signature image. Recomputed on the verify page to prove
 * the record hasn't been altered. Deliberately excludes IP (INET normalises
 * on round-trip) — IP is still logged on the audit event separately.
 */
const signatureHash = ({ signer_id, document_id, signature, signed_at }) =>
  sha256([signer_id, document_id, signature, signed_at].join("|"));

/** Append a tamper-evident audit event, chaining off the previous event's hash. */
async function appendEvent(client, request_id, event_type, extra = {}) {
  const prev = await repo.lastAuditHash({ client, request_id });
  const occurred_at = new Date().toISOString();
  const event_hash = sha256(
    [
      prev || "GENESIS",
      request_id,
      extra.signer_id || "",
      event_type,
      occurred_at,
    ].join("|"),
  );
  return repo.addAuditEvent({
    client,
    event: {
      request_id,
      signer_id: extra.signer_id || null,
      event_type,
      ip_address: extra.ip || null,
      user_agent: extra.ua || null,
      device: extra.device || null,
      metadata: extra.metadata || null,
      prev_event_hash: prev,
      event_hash,
    },
  });
}

/** Create a signature request against an existing document, with its signers. */
async function createRequest({ brand, user, request_id, input }) {
  if (!input.signers || input.signers.length === 0)
    throw new ValidationError("At least one signer is required");
  return withTransaction(async (client) => {
    const request = await repo.createRequest({
      client,
      row: {
        business: brand,
        document_id: input.document_id,
        request_type: input.request_type,
        reference_type: input.reference_type,
        reference_id: input.reference_id,
        signing_order: input.signing_order,
        subject: input.subject,
        message: input.message,
        expires_at: input.expires_at,
        created_by: user?.user_id,
      },
    });
    let step = 1;
    const signers = [];
    for (const s of input.signers) {
      signers.push(
        await repo.addSigner({
          client,
          signer: {
            request_id: request.request_id,
            user_id: s.user_id,
            contact_id: s.contact_id,
            external_name: s.external_name,
            external_email: s.external_email,
            external_phone: s.external_phone,
            display_name_snapshot:
              s.display_name || s.external_name || "Signer",
            display_email_snapshot: s.display_email || s.external_email || "",
            signer_role: s.signer_role,
            signing_step: input.signing_order === "parallel" ? 1 : step++,
            signing_token: newToken(),
            signing_token_expires_at: input.expires_at,
          },
        }),
      );
    }
    await appendEvent(client, request.request_id, "request_created", {
      metadata: { created_by: user?.user_id, signer_count: signers.length },
    });
    await audit({
      business: brand,
      user_id: user?.user_id,
      request_id,
      action_key: "signature_request.create",
      target_type: "signature_request",
      target_id: request.request_id,
      metadata: { request_type: request.request_type, signers: signers.length },
    });
    return { ...request, signers };
  });
}

/** Move a draft to 'sent' — emails go out to the first step (sequential) or all (parallel). */
async function sendRequest({ brand, user, request_id, id }) {
  return withTransaction(async (client) => {
    const req = await repo.getRequest({ client, brand, id });
    if (!req) throw new NotFoundError("Signature request not found");
    if (req.status !== "draft")
      throw new ConflictError(`Cannot send a request in '${req.status}' state`);
    await repo.setRequestStatus({
      client,
      id,
      status: "sent",
      extra: { sent_at: new Date().toISOString() },
    });
    // sequential: activate step 1 only; parallel: activate everyone.
    const activate =
      req.signing_order === "parallel"
        ? req.signers
        : req.signers.filter((s) => s.signing_step === 1);
    for (const s of activate)
      await repo.setSignerStatus({
        client,
        signer_id: s.signer_id,
        status: "sent",
      });
    await appendEvent(client, id, "request_sent", {
      metadata: { activated: activate.length },
    });
    await audit({
      business: brand,
      user_id: user?.user_id,
      request_id,
      action_key: "signature_request.send",
      target_type: "signature_request",
      target_id: id,
    });
    return repo.getRequest({ client, brand, id });
  });
}

/** Record a signature for the signer identified by token (external) — public-facing. */
async function signByToken({
  token,
  ip,
  ua,
  device,
  signature_data_url,
  pin,
  save_signature,
  // Legacy media-path flow (stylist portal persists the image to storage and
  // passes its key). Kept working alongside the inline draw/PIN flow.
  captured_signature_path,
  signature_image_byte_size,
}) {
  const result = await signByTokenTx({
    token,
    ip,
    ua,
    device,
    signature_data_url,
    pin,
    save_signature,
    captured_signature_path,
    signature_image_byte_size,
  });
  // Post-commit domain event so cross-module reactions (e.g. the Stylist
  // Programme issuing a badge when the partner contract is fully signed)
  // never act on an uncommitted signature.
  if (result && result.status === "fully_signed")
    documentsEvents.emit("signature.fully_signed", {
      request_id: result.request_id,
      business: result.business,
      document_id: result.document_id,
      reference_type: result.reference_type,
      reference_id: result.reference_id,
    });
  return result;
}

/**
 * Resolve the signature image to apply, honouring the product owner's model:
 *   • Anyone can sign by drawing a signature (one-off).
 *   • Setting a PIN *stores* the drawn signature on file (keyed by email), so
 *     future documents only need the PIN — no re-drawing.
 *   • A returning signer enters their PIN and the saved signature is applied.
 * Returns { signature, saved } or throws a ValidationError/ConflictError.
 */
async function resolveSignature({
  client,
  signer,
  signature_data_url,
  pin,
  save_signature,
}) {
  const email = signer.display_email_snapshot;
  const saved = email
    ? await repo.getSignerSignatureByEmail({ client, email })
    : null;

  if (saved) {
    if (pin) {
      if (saved.pin_locked_until && new Date(saved.pin_locked_until) > new Date())
        throw new ConflictError(
          "Too many incorrect PIN attempts. Please try again in a few minutes.",
        );
      const ok = await argon2.verify(saved.pin_hash, String(pin));
      if (!ok) {
        const state = await repo.recordSignerPinFail({ client, email });
        const left = state ? Math.max(0, 5 - state.pin_failed_count) : 0;
        throw new ValidationError(
          left > 0
            ? `Incorrect PIN. ${left} attempt${left === 1 ? "" : "s"} left.`
            : "Incorrect PIN. Your saved signature is locked for a few minutes.",
        );
      }
      await repo.recordSignerPinSuccess({ client, email });
      // Re-drew while unlocked → update the stored signature; else use saved.
      if (signature_data_url) {
        await repo.upsertSignerSignature({
          client,
          email,
          user_id: signer.user_id,
          signature_data_url,
          pin_hash: saved.pin_hash,
        });
        return { signature: signature_data_url, saved: true };
      }
      return { signature: saved.signature_data_url, saved: true };
    }
    // Forgot the PIN? Drawing a fresh signature signs one-off; saved untouched.
    if (signature_data_url) return { signature: signature_data_url, saved: false };
    throw new ValidationError(
      "Enter your PIN, or draw your signature to sign this document.",
    );
  }

  // No signature on file → the signer must draw one.
  if (!signature_data_url)
    throw new ValidationError("Please draw your signature to sign.");
  if (pin && save_signature) {
    const pin_hash = await argon2.hash(String(pin));
    await repo.upsertSignerSignature({
      client,
      email,
      user_id: signer.user_id,
      signature_data_url,
      pin_hash,
    });
    return { signature: signature_data_url, saved: true };
  }
  return { signature: signature_data_url, saved: false };
}

async function signByTokenTx({
  token,
  ip,
  ua,
  device,
  signature_data_url,
  pin,
  save_signature,
  captured_signature_path,
  signature_image_byte_size,
}) {
  return withTransaction(async (client) => {
    const signer = await repo.getSignerByToken({ client, token });
    if (!signer) throw new NotFoundError("Invalid signing link");
    // Load the request WITH its signers (getRequest is brand-scoped, so resolve
    // the business first). The signers list drives sequential-order enforcement.
    const { rows: br } = await client.query(
      `SELECT business FROM shared.signature_requests WHERE request_id = $1`,
      [signer.request_id],
    );
    if (!br[0]) throw new NotFoundError("Signature request not found");
    const req = await repo.getRequest({
      client,
      brand: br[0].business,
      id: signer.request_id,
    });
    if (!req) throw new NotFoundError("Signature request not found");
    if (
      ["fully_signed", "declined", "cancelled", "expired", "voided"].includes(
        req.status,
      )
    )
      throw new ConflictError(`Request is ${req.status}`);
    if (signer.status === "signed") throw new ConflictError("Already signed");
    if (
      signer.signing_token_expires_at &&
      new Date(signer.signing_token_expires_at) < new Date()
    ) {
      await repo.setSignerStatus({
        client,
        signer_id: signer.signer_id,
        status: "expired",
      });
      throw new ConflictError("Signing link has expired");
    }
    // sequential enforcement: only the current lowest unsigned step may sign.
    if (req.signing_order === "sequential") {
      const pending = req.signers.filter(
        (s) => s.status !== "signed" && s.status !== "declined",
      );
      const current = Math.min(...pending.map((s) => s.signing_step));
      if (signer.signing_step !== current)
        throw new ConflictError("It is not yet this signer's turn to sign");
    }

    // Resolve the signature artifact. Two flows share this path:
    //   • Legacy: the caller already stored the image and passes its media key.
    //   • Signer page: the signature is drawn inline (optionally unlocked/saved
    //     with a PIN) and captured as a base64 data URL.
    let artifact;
    if (captured_signature_path) {
      artifact = {
        path: captured_signature_path,
        data_url: null,
        byte_size: signature_image_byte_size || null,
        hashInput: captured_signature_path,
        saved: false,
      };
    } else {
      const resolved = await resolveSignature({
        client,
        signer,
        signature_data_url,
        pin,
        save_signature,
      });
      artifact = {
        path: null,
        data_url: resolved.signature,
        byte_size: Buffer.byteLength(resolved.signature, "utf8"),
        hashInput: resolved.signature,
        saved: resolved.saved,
      };
    }
    const saved = artifact.saved;

    const signed_at = new Date().toISOString();
    const audit_hash = signatureHash({
      signer_id: signer.signer_id,
      document_id: req.document_id,
      signature: artifact.hashInput,
      signed_at,
    });
    const verification_code = codeFromHash(audit_hash);
    await repo.setSignerStatus({
      client,
      signer_id: signer.signer_id,
      status: "signed",
      extra: {
        signed_at,
        signed_ip: ip || null,
        signed_user_agent: ua || null,
        signed_device: device || null,
        audit_hash,
        verification_code,
        captured_signature_path: artifact.path,
        signature_data_url: artifact.data_url,
        signature_image_byte_size: artifact.byte_size,
      },
    });
    await appendEvent(client, req.request_id, "signed", {
      signer_id: signer.signer_id,
      ip,
      ua,
      device,
      metadata: { verification_code, saved_signature: saved },
    });

    const counts = await repo.countSigners({
      client,
      request_id: req.request_id,
    });
    if (counts.signed >= counts.total) {
      await repo.setRequestStatus({
        client,
        id: req.request_id,
        status: "fully_signed",
        extra: { fully_signed_at: new Date().toISOString() },
      });
      await appendEvent(client, req.request_id, "fully_signed", {});
    } else {
      await repo.setRequestStatus({
        client,
        id: req.request_id,
        status: "partially_signed",
      });
      // sequential: advance the next step's signer to 'sent'.
      if (req.signing_order === "sequential") {
        const next = req.signers
          .filter((s) => s.status === "pending")
          .sort((a, b) => a.signing_step - b.signing_step)[0];
        if (next)
          await repo.setSignerStatus({
            client,
            signer_id: next.signer_id,
            status: "sent",
          });
      }
    }
    const updated = await repo.getRequest({
      client,
      brand: req.business,
      id: req.request_id,
    });
    // Carry the just-signed proof back to the caller for the confirmation screen.
    return {
      ...updated,
      signed: {
        verification_code,
        signed_at,
        display_name: signer.display_name_snapshot,
        signer_role: signer.signer_role,
        saved_signature: saved,
      },
    };
  });
}

/** Decline by token (external) — fails the whole request. */
async function declineByToken({ token, ip, ua, reason }) {
  return withTransaction(async (client) => {
    const signer = await repo.getSignerByToken({ client, token });
    if (!signer) throw new NotFoundError("Invalid signing link");
    if (signer.status === "signed")
      throw new ConflictError("Already signed; cannot decline");
    await repo.setSignerStatus({
      client,
      signer_id: signer.signer_id,
      status: "declined",
      extra: {
        declined_at: new Date().toISOString(),
        decline_reason: reason || null,
      },
    });
    await repo.setRequestStatus({
      client,
      id: signer.request_id,
      status: "declined",
    });
    await appendEvent(client, signer.request_id, "declined", {
      signer_id: signer.signer_id,
      ip,
      ua,
      metadata: { reason },
    });
    const { rows } = await client.query(
      `SELECT business FROM shared.signature_requests WHERE request_id = $1`,
      [signer.request_id],
    );
    return repo.getRequest({
      client,
      brand: rows[0]?.business,
      id: signer.request_id,
    });
  });
}

/** Cancel a not-yet-complete request (creator action). */
async function cancelRequest({ brand, user, request_id, id }) {
  return withTransaction(async (client) => {
    const req = await repo.getRequest({ client, brand, id });
    if (!req) throw new NotFoundError("Signature request not found");
    if (["fully_signed", "voided", "cancelled"].includes(req.status))
      throw new ConflictError(`Cannot cancel a ${req.status} request`);
    await repo.setRequestStatus({
      client,
      id,
      status: "cancelled",
      extra: { cancelled_at: new Date().toISOString() },
    });
    await appendEvent(client, id, "cancelled", {
      metadata: { by: user?.user_id },
    });
    await audit({
      business: brand,
      user_id: user?.user_id,
      request_id,
      action_key: "signature_request.cancel",
      target_type: "signature_request",
      target_id: id,
    });
    return repo.getRequest({ client, brand, id });
  });
}

/** Void a fully-signed request (CEO action, post-signing). */
async function voidRequest({ brand, user, request_id, id, reason }) {
  return withTransaction(async (client) => {
    const req = await repo.getRequest({ client, brand, id });
    if (!req) throw new NotFoundError("Signature request not found");
    await repo.setRequestStatus({
      client,
      id,
      status: "voided",
      extra: {
        voided_at: new Date().toISOString(),
        void_reason: reason || null,
      },
    });
    await appendEvent(client, id, "voided", {
      metadata: { by: user?.user_id, reason },
    });
    await audit({
      business: brand,
      user_id: user?.user_id,
      request_id,
      action_key: "signature_request.void",
      target_type: "signature_request",
      target_id: id,
      metadata: { reason },
    });
    return repo.getRequest({ client, brand, id });
  });
}

/** Verify the audit chain is intact (recompute hashes, compare). */
async function verifyChain({ brand, id }) {
  const req = await repo.getRequest({ client: null, brand, id });
  if (!req) throw new NotFoundError("Signature request not found");
  let prev = null,
    intact = true,
    brokenAt = null;
  for (const e of req.events) {
    const expected = sha256(
      [
        prev || "GENESIS",
        req.request_id,
        e.signer_id || "",
        e.event_type,
        new Date(e.occurred_at).toISOString(),
      ].join("|"),
    );
    if (e.prev_event_hash !== prev || e.event_hash !== expected) {
      intact = false;
      brokenAt = e.event_id;
      break;
    }
    prev = e.event_hash;
  }
  return {
    request_id: id,
    event_count: req.events.length,
    intact,
    broken_at: brokenAt,
  };
}

const getRequest = ({ brand, id }) =>
  repo.getRequest({ client: null, brand, id }).then((r) => {
    if (!r) throw new NotFoundError("Signature request not found");
    return r;
  });
const listRequests = ({ brand, filters, page, page_size }) =>
  repo.listRequests({
    client: null,
    brand,
    filters,
    page,
    page_size,
    offset: (page - 1) * page_size,
  });
const viewByToken = async ({ token, ip, ua }) => {
  const signer = await repo.getSignerByToken({ client: null, token });
  if (!signer) throw new NotFoundError("Invalid signing link");
  await withTransaction(async (client) => {
    if (signer.status === "sent")
      await repo.setSignerStatus({
        client,
        signer_id: signer.signer_id,
        status: "viewed",
      });
    await appendEvent(client, signer.request_id, "signing_link_opened", {
      signer_id: signer.signer_id,
      ip,
      ua,
    });
  });
  const { rows } = await query(
    `SELECT r.request_id, r.business, r.subject, r.message, r.status,
            r.request_type, r.expires_at, r.signing_order, r.document_id,
            d.title AS document_title, d.document_number, d.mime_type
       FROM shared.signature_requests r
       LEFT JOIN shared.documents d ON d.document_id = r.document_id
      WHERE r.request_id = $1`,
    [signer.request_id],
  );
  const request = rows[0] || {};

  // Whose turn is it? For sequential requests only the lowest unsigned step
  // may sign; parallel requests let everyone sign at once.
  let canSign = signer.status !== "signed";
  if (request.signing_order === "sequential") {
    const { rows: pend } = await query(
      `SELECT MIN(signing_step) AS step
         FROM shared.signature_request_signers
        WHERE request_id = $1 AND status NOT IN ('signed','declined')`,
      [signer.request_id],
    );
    const nextStep = pend[0]?.step;
    canSign =
      nextStep !== null &&
      nextStep !== undefined &&
      Number(signer.signing_step) === Number(nextStep);
  }

  const saved = await repo.getSignerSignatureByEmail({
    client: null,
    email: signer.display_email_snapshot,
  });

  return {
    request: {
      request_id: request.request_id,
      business: request.business,
      subject: request.subject,
      message: request.message,
      status: request.status,
      request_type: request.request_type,
      expires_at: request.expires_at,
      document_id: request.document_id,
      document_title: request.document_title,
      document_number: request.document_number,
      mime_type: request.mime_type,
    },
    signer: {
      display_name: signer.display_name_snapshot,
      email: signer.display_email_snapshot,
      signer_role: signer.signer_role,
      status: signer.status,
      signed_at: signer.signed_at,
      verification_code: signer.verification_code,
      can_sign: canSign,
    },
    has_saved_signature: !!saved,
    saved_signature_locked: !!(
      saved &&
      saved.pin_locked_until &&
      new Date(saved.pin_locked_until) > new Date()
    ),
  };
};

/**
 * Public verification: resolve a signature by its verification code and
 * recompute the integrity hash to prove the record is intact.
 */
const verifyByCode = async ({ code }) => {
  const row = await repo.getSignerByVerificationCode({
    client: null,
    code: String(code || "").trim().toUpperCase(),
  });
  if (!row)
    throw new NotFoundError("No signature found for that verification code");
  const recomputed = signatureHash({
    signer_id: row.signer_id,
    document_id: row.document_id,
    signature: row.signature_data_url,
    signed_at: new Date(row.signed_at).toISOString(),
  });
  return {
    verification_code: row.verification_code,
    intact: recomputed === row.audit_hash,
    signed_at: row.signed_at,
    status: row.status,
    document: {
      title: row.subject,
      request_type: row.request_type,
    },
    signer: {
      display_name: row.display_name_snapshot,
      signer_role: row.signer_role,
    },
  };
};

/** Resolve the document bytes for a signer's request (token-scoped preview). */
const documentForToken = async ({ token }) => {
  const signer = await repo.getSignerByToken({ client: null, token });
  if (!signer) throw new NotFoundError("Invalid signing link");
  const { rows } = await query(
    `SELECT business, document_id FROM shared.signature_requests WHERE request_id = $1`,
    [signer.request_id],
  );
  if (!rows[0]) throw new NotFoundError("Signature request not found");
  return require("./documents.service").download({
    brand: rows[0].business,
    id: rows[0].document_id,
  });
};

module.exports = {
  createRequest,
  sendRequest,
  signByToken,
  declineByToken,
  cancelRequest,
  voidRequest,
  verifyChain,
  getRequest,
  listRequests,
  viewByToken,
  verifyByCode,
  documentForToken,
  // Pure helpers exported for unit tests / reuse (e.g. PDF stamping, verify tooling).
  codeFromHash,
  signatureHash,
};
