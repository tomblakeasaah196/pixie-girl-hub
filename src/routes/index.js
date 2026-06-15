/**
 * Top-level route mounting.
 *
 * URL convention:
 *   /api/v1/<module>/...
 *
 * Brand context is resolved from the X-Brand-Context header (preferred)
 * or path prefix. CEO-level cross-brand views live under /api/v1/group/*.
 *
 * Public/storefront endpoints (no auth) live under /api/public/*.
 * Webhook receivers live under /api/webhooks/*.
 */

"use strict";

const express = require("express");
const path = require("path");

const { config } = require("../config/env");
const { authMiddleware } = require("../middleware/auth");
const { brandContextMiddleware } = require("../middleware/brand-context");
const { publicWriteLimiter } = require("../middleware");

// Auth & user-management
const authRouter = require("../shared/hr_payroll/auth.routes");

// Module routers — each exports an Express Router
const crmRouter = require("../modules/crm/crm.routes");
const catalogueRouter = require("../modules/catalogue/catalogue.routes");
const salesRouter = require("../modules/sales/sales.routes");
const posRouter = require("../modules/pos/pos.routes");
const storefrontRouter = require("../modules/storefront/storefront.routes");
const invoicingRouter = require("../modules/invoicing/invoicing.routes");
const accountingRouter = require("../modules/accounting/accounting.routes");
const expensesRouter = require("../modules/expenses/expenses.routes");
const purchasingRouter = require("../modules/purchasing/purchasing.routes");
const stockRouter = require("../modules/stock/stock.routes");
const logisticsRouter = require("../modules/logistics/logistics.routes");
const hrPayrollRouter = require("../shared/hr_payroll/hr.routes");
const attendanceRouter = require("../shared/attendance/attendance.routes");
const contactsRouter = require("../shared/contacts/contacts.routes");
const documentsRouter = require("../shared/documents/documents.routes");
const socialMediaRouter = require("../modules/social_media/social.routes");
const marketingRouter = require("../modules/marketing/marketing.routes");
const emailCampaignsRouter = require("../modules/email_campaigns/email-campaigns.routes");
const smartcommRouter = require("../modules/smartcomm/smartcomm.routes");
const calendarRouter = require("../shared/calendar/calendar.routes");
const tasksRouter = require("../shared/tasks/tasks.routes");
const dashboardsRouter = require("../modules/dashboards/dashboards.routes");
const businessSetupRouter = require("../modules/business_setup/business-setup.routes");
const platformSettingsRouter = require("../modules/platform_settings/platform-settings.routes");
const settingsRouter = require("../modules/settings/settings.routes");
const brandingPublicRouter = require("../modules/platform_settings/branding.public.routes");
const geoPublicRouter = require("../modules/platform_settings/geo.public.routes");
const salesCampaignsRouter = require("../modules/sales_campaigns/campaigns.routes");
const retentionRouter = require("../modules/retention/retention.routes");
const productionRouter = require("../modules/production/production.routes");
const serviceJobsRouter = require("../modules/service_jobs/service-jobs.routes");
const pricingRouter = require("../modules/pricing/pricing.routes");
const stylistRouter = require("../modules/stylist_programme/stylist.routes");
const stylistPortalRouter = require("../modules/stylist_programme/stylist.portal.routes");
const orgWorkflowRouter = require("../shared/org_workflow/org.routes");
const storefrontStudioRouter = require("../modules/storefront_studio/studio.routes");
const intercompanyRouter = require("../modules/intercompany/intercompany.routes");
const praxisRouter = require("../modules/praxis_ai/praxis.routes");
const aiInsightsRouter = require("../modules/ai_insights/insights.routes");
const aiGovernanceRouter = require("../modules/ai_governance/governance.routes");
const retailPartnersRouter = require("../modules/retail_partners/partners.routes");
const cashRequestRouter = require("../modules/cash_request/cash-request.routes");
const auditRouter = require("../shared/audit/audit.routes");
const accessRouter = require("../shared/access/access.routes");
const notificationsRouter = require("../shared/notifications/notifications.routes");

const {
  cartRouter,
  wishlistRouter,
} = require("../modules/storefront/cart.routes");

const {
  adminRouter: staffInvitationsAdminRouter,
  publicRouter: staffInvitationsPublicRouter,
} = require("../shared/hr_payroll/invitations.routes");

const {
  adminRouter: walkinAdminRouter,
  publicRouter: walkinPublicRouter,
} = require("../modules/storefront/walkin.routes");

// Public (storefront-facing, no auth)
const publicCatalogueRouter = require("../modules/storefront/public.routes");
const publicTrackingRouter = require("../modules/logistics/tracking.routes");
const publicOrderTimelineRouter = require("../modules/sales/order-timeline.routes");
const publicPayLinkRouter = require("../modules/sales/payment-link.public.routes");
const publicOrderFormRouter = require("../modules/storefront/order-form.routes");
const publicInstallHubRouter = require("../modules/storefront/install-hub.routes");
const publicStylistVerifyRouter = require("../modules/stylist_programme/verify.routes");
const publicReferralRouter = require("../modules/retention/referral.routes");
const publicHairQuizRouter = require("../modules/retention/hair-quiz.routes");
const publicCampaignRouter = require("../modules/sales_campaigns/campaigns.public.routes");
const publicSignRouter = require("../shared/documents/documents.esign.public.routes");
const publicNewsletterRouter = require("../modules/email_campaigns/newsletter.routes");
const publicEmailTrackingRouter = require("../modules/email_campaigns/tracking.routes");

// Webhooks
const webhooksRouter = require("../modules/business_setup/webhooks.routes");

function mountRoutes(app) {
  // ── Health & system ────────────────────────────────────
  app.get("/health", (_req, res) =>
    res.json({ ok: true, ts: new Date().toISOString() }),
  );
  app.get("/version", (_req, res) =>
    res.json({
      version: require("../../package.json").version,
      node: process.version,
    }),
  );

  // ── Public endpoints (no auth) ─────────────────────────
  const publicRouter = express.Router();
  publicRouter.use("/catalogue", publicCatalogueRouter);
  publicRouter.use("/tracking", publicTrackingRouter);
  publicRouter.use("/order-timeline", publicOrderTimelineRouter);
  // Public WRITE endpoints (H-10): stricter per-IP throttle to blunt abuse on
  // unauthenticated record-creating routes.
  publicRouter.use("/order-form", publicWriteLimiter, publicOrderFormRouter);
  publicRouter.use("/install-hub", publicInstallHubRouter);
  publicRouter.use("/stylist-verify", publicStylistVerifyRouter);
  publicRouter.use("/referral", publicWriteLimiter, publicReferralRouter);
  publicRouter.use("/hair-quiz", publicWriteLimiter, publicHairQuizRouter);
  publicRouter.use("/sale", publicCampaignRouter);
  publicRouter.use("/sign", publicWriteLimiter, publicSignRouter);
  publicRouter.use("/newsletter", publicWriteLimiter, publicNewsletterRouter);
  publicRouter.use(
    "/staff-invite",
    publicWriteLimiter,
    staffInvitationsPublicRouter,
  );
  publicRouter.use("/walk-in", publicWriteLimiter, walkinPublicRouter);
  publicRouter.use("/pay", publicWriteLimiter, publicPayLinkRouter);
  publicRouter.use("/email", publicEmailTrackingRouter);
  // Unauthenticated branding feed — the login page calls this before
  // a token exists so the shell can theme itself.
  publicRouter.use("/branding", brandingPublicRouter);
  // Per-IP login greeting ("Welcome from Africa"). Not cached.
  publicRouter.use("/geo-welcome", geoPublicRouter);
  app.use("/api/public", publicRouter);

  // Public branding assets (logos, login background) — served only from
  // the storage root's `branding/` subfolder so private media (documents,
  // product files) is never exposed. Cached for a day.
  app.use(
    "/media/branding",
    express.static(path.join(config.STORAGE_LOCAL_ROOT, "branding"), {
      maxAge: "1d",
      index: false,
    }),
  );

  // ── Webhooks (signed payloads; auth via signature, not JWT) ──
  app.use("/api/webhooks", webhooksRouter);

  // ── Auth (issues JWTs; no auth required to call) ───────
  app.use("/api/v1/auth", authRouter);

  // ── Stylist portal (separate JWT class; self-authenticating) ──
  app.use("/api/v1/stylist-portal", stylistPortalRouter);

  // ── Protected API surface ──────────────────────────────
  // All routes below require an authenticated user and a brand context.
  const api = express.Router();
  api.use(authMiddleware);
  api.use(brandContextMiddleware);

  api.use("/crm", crmRouter);
  api.use("/catalogue", catalogueRouter);
  api.use("/sales", salesRouter);
  api.use("/pos", posRouter);
  api.use("/storefront", storefrontRouter);
  api.use("/invoicing", invoicingRouter);
  api.use("/accounting", accountingRouter);
  api.use("/expenses", expensesRouter);
  api.use("/purchasing", purchasingRouter);
  api.use("/stock", stockRouter);
  api.use("/logistics", logisticsRouter);
  api.use("/hr", hrPayrollRouter);
  api.use("/staff-invitations", staffInvitationsAdminRouter);
  api.use("/walk-in", walkinAdminRouter);
  api.use("/attendance", attendanceRouter);
  api.use("/contacts", contactsRouter);
  api.use("/documents", documentsRouter);
  api.use("/social", socialMediaRouter);
  api.use("/marketing", marketingRouter);
  api.use("/email-campaigns", emailCampaignsRouter);
  api.use("/smartcomm", smartcommRouter);
  api.use("/calendar", calendarRouter);
  api.use("/tasks", tasksRouter);
  api.use("/dashboards", dashboardsRouter);
  api.use("/business-setup", businessSetupRouter);
  api.use("/settings", settingsRouter);
  api.use("/platform-settings", platformSettingsRouter);
  api.use("/sales-campaigns", salesCampaignsRouter);
  api.use("/retention", retentionRouter);
  api.use("/production", productionRouter);
  api.use("/service-jobs", serviceJobsRouter);
  api.use("/pricing", pricingRouter);
  api.use("/stylists", stylistRouter);
  api.use("/org", orgWorkflowRouter);
  api.use("/storefront-studio", storefrontStudioRouter);
  api.use("/intercompany", intercompanyRouter);
  api.use("/praxis", praxisRouter);
  api.use("/insights", aiInsightsRouter);
  api.use("/ai-governance", aiGovernanceRouter);
  api.use("/retail-partners", retailPartnersRouter);
  api.use("/cash-request", cashRequestRouter);
  api.use("/audit", auditRouter);
  api.use("/access", accessRouter);
  api.use("/notifications", notificationsRouter);
  api.use("/cart", cartRouter);
  api.use("/wishlist", wishlistRouter);

  app.use("/api/v1", api);
}

module.exports = { mountRoutes };
