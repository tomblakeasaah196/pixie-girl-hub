/**
 * PDF rendering service (J-7 / X-1) — headless-Chromium HTML→PDF.
 *
 * The single owner of a Puppeteer browser for the whole process: one Chromium
 * instance is launched lazily and reused across renders (cheap per-page),
 * closed on graceful shutdown. Consumers pass an HTML string and get back a
 * Buffer; persisting it (and getting a document_id) is done via
 * shared/documents/documents.service `store()` — see `renderAndStore`.
 *
 * Degrades cleanly: if PDF_ENABLED is false or puppeteer/Chromium cannot launch
 * (e.g. the dependency isn't installed yet), renders throw a clean
 * AppError('PDF_UNAVAILABLE', …, 503) instead of crashing the process — so the
 * rest of the app boots and runs regardless.
 */

"use strict";

const { config } = require("../config/env");
const { logger } = require("../config/logger");
const { AppError } = require("../utils/errors");

let browserPromise = null;

async function getBrowser() {
  if (!config.PDF_ENABLED)
    throw new AppError("PDF_UNAVAILABLE", "PDF rendering is disabled", 503);

  if (!browserPromise) {
    browserPromise = (async () => {
      let puppeteer;
      try {
        puppeteer = require("puppeteer");
      } catch (err) {
        throw new AppError(
          "PDF_UNAVAILABLE",
          "puppeteer is not installed — run `npm install` to enable PDF rendering",
          503,
          { metadata: { cause: err.message } },
        );
      }
      const launchOpts = {
        headless: "new",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      };
      if (config.PUPPETEER_EXECUTABLE_PATH)
        launchOpts.executablePath = config.PUPPETEER_EXECUTABLE_PATH;
      return puppeteer.launch(launchOpts);
    })().catch((err) => {
      browserPromise = null; // allow a later retry
      if (err instanceof AppError) throw err;
      logger.error({ err: err.message }, "chromium launch failed");
      throw new AppError(
        "PDF_UNAVAILABLE",
        "Could not launch Chromium for PDF rendering",
        503,
        { metadata: { cause: err.message } },
      );
    });
  }
  return browserPromise;
}

/**
 * Render an HTML string to a PDF Buffer.
 * @param {string} html  Full HTML document (inline CSS recommended).
 * @param {object} [opts]
 * @param {string} [opts.format="A4"]
 * @param {boolean} [opts.landscape=false]
 * @param {object} [opts.margin]  e.g. { top:'12mm', bottom:'12mm', left:'10mm', right:'10mm' }
 * @param {string} [opts.headerTemplate] / [opts.footerTemplate]
 * @returns {Promise<Buffer>}
 */
async function renderHtmlToPdf(html, opts = {}) {
  if (!html || typeof html !== "string")
    throw new AppError(
      "INVALID_HTML",
      "renderHtmlToPdf requires an HTML string",
      400,
    );

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, {
      waitUntil: "networkidle0",
      timeout: config.PDF_RENDER_TIMEOUT_MS,
    });
    const displayHeaderFooter = Boolean(
      opts.headerTemplate || opts.footerTemplate,
    );
    const pdf = await page.pdf({
      format: opts.format || "A4",
      landscape: Boolean(opts.landscape),
      printBackground: true,
      displayHeaderFooter,
      headerTemplate: opts.headerTemplate || "<span></span>",
      footerTemplate:
        opts.footerTemplate ||
        '<div style="font-size:8px;width:100%;text-align:center;color:#888;">' +
          '<span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      margin: opts.margin || {
        top: "14mm",
        bottom: "16mm",
        left: "12mm",
        right: "12mm",
      },
    });
    return Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Render HTML to PDF and persist it via the documents gateway, returning the
 * stored document (incl. document_id + url). Pass a `client` to enrol the
 * document write in an open transaction.
 */
async function renderAndStore({
  brand,
  user_id = null,
  html,
  title,
  document_type = "document",
  reference_type = null,
  reference_id = null,
  pdfOptions,
  client,
  request_id = null,
}) {
  // Required lazily to avoid a circular import (documents → … → pdf).
  const documents = require("../shared/documents/documents.service");
  const buffer = await renderHtmlToPdf(html, pdfOptions);
  return documents.store({
    brand,
    user_id,
    buffer,
    filename: `${(title || document_type).replace(/[^\w.-]+/g, "_")}.pdf`,
    mime_type: "application/pdf",
    document_type,
    title,
    reference_type,
    reference_id,
    client,
    request_id,
  });
}

async function shutdown() {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch {
    // ignore
  } finally {
    browserPromise = null;
  }
}

function isEnabled() {
  return Boolean(config.PDF_ENABLED);
}

module.exports = { renderHtmlToPdf, renderAndStore, shutdown, isEnabled };
