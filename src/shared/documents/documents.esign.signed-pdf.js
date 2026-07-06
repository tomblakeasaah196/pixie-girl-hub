/**
 * Documents & Signatures (V2.2 §6.13) — signed-document builder.
 *
 * When a request is fully signed, this stamps the signature certificate page
 * onto the document: it renders the certificate (each signer's drawn signature
 * + timestamp + verification code) via the headless-Chromium PDF pipeline and,
 * when the original is a PDF, appends it with pdf-lib so the signatures ride on
 * the same file. Non-PDF originals get the certificate as a standalone signed
 * copy. The result is stored as a new document and linked via
 * signature_requests.signed_document_id.
 *
 * Runs post-commit (never inside the signing transaction) and is non-fatal:
 * a PDF-render outage must never fail or unwind a completed signature.
 */

"use strict";

const { PDFDocument } = require("pdf-lib");
const { logger } = require("../../config/logger");
const repo = require("./documents.esign.repo");
const documents = require("./documents.service");
const storage = require("../../services/storage.service");
const pdf = require("../../services/pdf.service");
const { signatureCertificateHtml } = require("./documents.esign.certificate");

/** Resolve a signer's signature image as a data URL (inline draw or media path). */
async function signatureSrc(signer) {
  if (signer.signature_data_url) return signer.signature_data_url;
  if (signer.captured_signature_path) {
    try {
      const buf = await storage.get(signer.captured_signature_path);
      const ext = String(signer.captured_signature_path)
        .split(".")
        .pop()
        .toLowerCase();
      const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
      return `data:${mime};base64,${buf.toString("base64")}`;
    } catch (err) {
      logger.warn(
        { err: err.message },
        "esign: could not load captured signature image for certificate",
      );
      return null;
    }
  }
  return null;
}

/**
 * Build (or return the existing) signed document for a fully-signed request.
 * @returns {Promise<{signed_document_id:string}|null>}
 */
async function generateSignedDocument({ brand, request_id }) {
  const request = await repo.getRequest({ client: null, brand, id: request_id });
  if (!request) return null;
  if (request.status !== "fully_signed") return null;
  if (request.signed_document_id)
    return { signed_document_id: request.signed_document_id };

  if (!pdf.isEnabled()) {
    logger.warn(
      { request_id },
      "esign: PDF rendering disabled — skipping signed-document generation",
    );
    return null;
  }

  // Original document bytes + metadata (best effort).
  let original = null;
  try {
    original = await documents.download({ brand, id: request.document_id });
  } catch (err) {
    logger.warn(
      { err: err.message, request_id },
      "esign: original document unavailable; certificate will stand alone",
    );
  }

  // Certificate page.
  const signers = [];
  for (const s of request.signers) {
    signers.push({
      display_name: s.display_name_snapshot,
      signer_role: s.signer_role,
      signed_at: s.signed_at,
      signed_ip: s.signed_ip,
      verification_code: s.verification_code,
      signature_src: await signatureSrc(s),
    });
  }
  const html = signatureCertificateHtml({
    brand,
    request: {
      subject: request.subject,
      request_type: request.request_type,
      request_id: request.request_id,
      fully_signed_at: request.fully_signed_at,
    },
    document: { title: original?.title, document_number: null },
    signers,
  });
  const certBuffer = await pdf.renderHtmlToPdf(html, { format: "A4" });

  // Append the certificate to the original when it's a PDF; otherwise the
  // certificate is the signed copy on its own.
  let outBuffer = certBuffer;
  if (original && /pdf/i.test(original.mime_type || "")) {
    try {
      const base = await PDFDocument.load(original.buffer, {
        ignoreEncryption: true,
      });
      const cert = await PDFDocument.load(certBuffer);
      const pages = await base.copyPages(cert, cert.getPageIndices());
      pages.forEach((p) => base.addPage(p));
      outBuffer = Buffer.from(await base.save());
    } catch (err) {
      logger.warn(
        { err: err.message, request_id },
        "esign: PDF merge failed; storing certificate only",
      );
      outBuffer = certBuffer;
    }
  }

  const title = `${original?.title || request.subject || "Document"} (signed)`;
  const stored = await documents.store({
    brand,
    buffer: outBuffer,
    filename: `${title.replace(/[^\w.-]+/g, "_")}.pdf`,
    mime_type: "application/pdf",
    document_type: "signed_document",
    title,
    reference_type: "signature_request",
    reference_id: request.request_id,
  });

  await repo.setSignedDocument({
    client: null,
    request_id: request.request_id,
    document_id: stored.document_id,
  });
  logger.info(
    { request_id, signed_document_id: stored.document_id },
    "esign: signed document generated",
  );
  return { signed_document_id: stored.document_id };
}

module.exports = { generateSignedDocument };
