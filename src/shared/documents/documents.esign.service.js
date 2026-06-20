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
// config/database exports `transaction`; alias it so the existing
// withTransaction(...) call sites below keep working.
const { transaction: withTransaction } = require("../../config/database");
const repo = require("./documents.esign.repo");
const { audit } = require("../../middleware/audit");
const {
  NotFoundError,
  ValidationError,
  ConflictError,
} = require("../../utils/errors");

const sha256 = (s) =>
  crypto.createHash("sha256").update(String(s)).digest("hex");
const newToken = () => crypto.randomBytes(32).toString("base64url");

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
  captured_signature_path,
  signature_image_byte_size,
}) {
  return withTransaction(async (client) => {
    const signer = await repo.getSignerByToken({ client, token });
    if (!signer) throw new NotFoundError("Invalid signing link");
    const req =
      (await repo.getRequest({
        client,
        brand: undefined,
        id: signer.request_id,
      })) ||
      (
        await client.query(
          `SELECT * FROM shared.signature_requests WHERE request_id = $1`,
          [signer.request_id],
        )
      ).rows[0];
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
    const audit_hash = sha256(
      [signer.signer_id, ip || "", ua || "", new Date().toISOString()].join(
        "|",
      ),
    );
    await repo.setSignerStatus({
      client,
      signer_id: signer.signer_id,
      status: "signed",
      extra: {
        signed_at: new Date().toISOString(),
        signed_ip: ip || null,
        signed_user_agent: ua || null,
        signed_device: device || null,
        audit_hash,
        captured_signature_path: captured_signature_path || null,
        signature_image_byte_size: signature_image_byte_size || null,
      },
    });
    await appendEvent(client, req.request_id, "signed", {
      signer_id: signer.signer_id,
      ip,
      ua,
      device,
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
    return repo.getRequest({ client, brand: req.business, id: req.request_id });
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
  const { rows } = await require("../../config/database").query(
    `SELECT business, subject, status, document_id FROM shared.signature_requests WHERE request_id = $1`,
    [signer.request_id],
  );
  return {
    request: rows[0],
    signer: {
      display_name: signer.display_name_snapshot,
      signer_role: signer.signer_role,
      status: signer.status,
    },
  };
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
};
