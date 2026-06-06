/**
 * Sales Campaigns — NOTIFICATIONS & REPORT (V2.2 §6.22).
 *
 *   fireGoLiveBlast(): on go-live, fan out to the pre-launch signup list
 *     via email (Nodemailer) and WhatsApp (Meta Cloud API), per each
 *     signup's notify_via. Idempotent — only un-notified signups are sent,
 *     and each is marked notified.
 *
 *   generatePostCampaignReport(): on end, render a PDF summary (pdfkit),
 *     store it via the storage abstraction, return its URL.
 */

"use strict";

const PDFDocument = require("pdfkit");
const repo = require("./campaigns.repo");
const main = require("./campaigns.service");
const businessConfig = require("../business_setup/business-config.repo");
const email = require("../../services/email.service");
const whatsapp = require("../../services/whatsapp.service");
const documents = require("../../shared/documents/documents.service");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");

async function fireGoLiveBlast({ brand, campaign_id }) {
  const campaign = await repo.findById({ brand, id: campaign_id });
  if (!campaign) return { sent: 0 };

  const cfg = await businessConfig.findByKey(brand);
  const kit = main.buildShareKit
    ? main.buildShareKit({ brand, brand_config: cfg, campaign })
    : null;
  const base =
    cfg && cfg.storefront_domain
      ? `https://${cfg.storefront_domain}`
      : config.APP_URL;
  const url = `${base}/sale/${campaign.slug}?utm_source=blast&utm_medium=launch&utm_campaign=${encodeURIComponent(campaign.slug)}`;

  const signups = await repo.listPendingSignups({ brand, campaign_id });
  let sent = 0;

  for (const s of signups) {
    try {
      const wantsEmail =
        (s.notify_via === "email" || s.notify_via === "both") && s.email;
      const wantsWa =
        (s.notify_via === "whatsapp" || s.notify_via === "both") && s.phone;

      if (wantsEmail) {
        await email.send({
          to: s.email,
          subject: `${campaign.name} is live 🎉`,
          html: `<p>${campaign.name} is now live. Shop before it ends:</p><p><a href="${url}">${url}</a></p>`,
          text: `${campaign.name} is now live. Shop here: ${url}`,
        });
      }
      if (wantsWa) {
        await whatsapp.sendText({
          to: s.phone,
          body: `🔥 ${campaign.name} is LIVE! Shop now: ${url}`,
        });
      }
      if (wantsEmail || wantsWa) {
        await repo.markSignupNotified({ brand, signup_id: s.signup_id });
        sent++;
      }
    } catch (err) {
      logger.error(
        { err, signup_id: s.signup_id },
        "campaign blast send failed",
      );
    }
  }
  logger.info(
    { brand, campaign_id, sent, total: signups.length },
    "go-live blast complete",
  );
  return { sent, total: signups.length, share_url: url, kit };
}

async function buildReportData({ brand, campaign_id }) {
  const metrics = await main.getMetrics({ brand, id: campaign_id });
  const campaign = await repo.findById({ brand, id: campaign_id });
  const products = await repo.listProducts({ brand, campaign_id });
  return {
    campaign: {
      campaign_id: campaign.campaign_id,
      name: campaign.name,
      slug: campaign.slug,
      starts_at: campaign.starts_at,
      ends_at: campaign.ends_at,
      status: campaign.status,
    },
    rollups: metrics.rollups,
    top_products: products
      .filter((p) => p.include_exclude !== "exclude")
      .slice(0, 10)
      .map((p) => ({
        name: p.product_name || p.category_name,
        is_featured: p.is_featured,
        campaign_price_ngn: p.campaign_price_ngn,
      })),
  };
}

async function renderReportPdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const r = data.rollups;
    const ngn = (v) =>
      `NGN ${Number(v || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;

    doc.fontSize(20).text("Campaign Performance Report", { align: "left" });
    doc.moveDown(0.5);
    doc.fontSize(14).text(data.campaign.name);
    doc
      .fontSize(10)
      .fillColor("#666")
      .text(`/${data.campaign.slug}`)
      .text(
        `${new Date(data.campaign.starts_at).toDateString()} → ${new Date(data.campaign.ends_at).toDateString()}`,
      )
      .text(`Status: ${data.campaign.status}`);
    doc.moveDown();

    doc.fillColor("#000").fontSize(13).text("Headline metrics");
    doc.moveDown(0.3);
    const rows = [
      ["Visitors", r.total_visitors],
      ["Unique visitors", r.total_unique_visitors],
      ["Signups", r.total_signups],
      ["Add to cart", r.total_add_to_cart],
      ["Orders", r.total_orders],
      ["Revenue", ngn(r.total_revenue_ngn)],
      ["Discount given", ngn(r.total_discount_given_ngn)],
      ["Avg order value", ngn(r.average_order_value_ngn)],
      ["Conversion rate", `${(Number(r.conversion_rate) * 100).toFixed(2)}%`],
    ];
    doc.fontSize(11);
    for (const [k, v] of rows) doc.text(`${k}: ${v}`);
    doc.moveDown();

    if (data.top_products.length) {
      doc.fontSize(13).text("Featured / campaign products");
      doc.moveDown(0.3).fontSize(11);
      for (const p of data.top_products) {
        const price = p.campaign_price_ngn
          ? ` — ${ngn(p.campaign_price_ngn)}`
          : "";
        doc.text(
          `• ${p.name || "(unnamed)"}${p.is_featured ? " [featured]" : ""}${price}`,
        );
      }
    }

    doc.moveDown(2);
    doc
      .fontSize(8)
      .fillColor("#999")
      .text(`Generated ${new Date().toISOString()} — Pixie Girl Hub`, {
        align: "center",
      });
    doc.end();
  });
}

async function generatePostCampaignReport({
  brand,
  campaign_id,
  user_id = null,
}) {
  const data = await buildReportData({ brand, campaign_id });
  const pdf = await renderReportPdf(data);
  // Route through the Documents module (6.13) — the single file gateway.
  const doc = await documents.store({
    brand,
    user_id,
    buffer: pdf,
    filename: `campaign-report-${data.campaign.slug}.pdf`,
    mime_type: "application/pdf",
    document_type: "campaign_report",
    title: `${data.campaign.name} — performance report`,
    reference_type: "sales_campaign",
    reference_id: campaign_id,
  });
  logger.info(
    { brand, campaign_id, document_id: doc.document_id },
    "post-campaign report generated",
  );
  return { ...data, document_id: doc.document_id, pdf_url: doc.url };
}

module.exports = {
  fireGoLiveBlast,
  buildReportData,
  generatePostCampaignReport,
};
