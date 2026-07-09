import { lazy, Suspense, type ComponentType } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "@/components/shell/AppShell";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { CommandCenter } from "@/pages/CommandCenter";
import { ContactsPage } from "@/pages/contacts/ContactsPage";
import { ContactProfilePage } from "@/pages/contacts/ContactProfilePage";
import { EmployeeOnboardingPage } from "@/pages/contacts/EmployeeOnboardingPage";
import { MilestonesPage } from "@/pages/contacts/MilestonesPage";
import { ContactTagsPage } from "@/pages/ContactTagsPage";
import { CrmPage } from "@/pages/crm/CrmPage";
import { ClientProfilePage } from "@/pages/crm/clients/ClientProfilePage";
import { SalesPage } from "@/pages/sales/SalesPage";
import { OrderDetailPage } from "@/pages/sales/OrderDetailPage";
import { DashboardPage } from "@/pages/dashboard/DashboardPage";
import { DealDetailPage } from "@/pages/crm/deals/DealDetailPage";
import { CataloguePage } from "@/pages/catalogue/CataloguePage";
import { BaseProductPage } from "@/pages/catalogue/BaseProductPage";
import { StyledProductPage } from "@/pages/catalogue/StyledProductPage";
import { AppearancePage } from "@/pages/AppearancePage";
import { LoginEditorPage } from "@/pages/LoginEditorPage";
import { ModulePlaceholder } from "@/pages/ModulePlaceholder";
import { RouteFallback } from "@/components/common/RouteFallback";
import { OrgWorkflowPage } from "@/pages/OrgWorkflowPage";
import { LoginPage } from "@/pages/LoginPage";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { SelectEntityPage } from "@/pages/SelectEntityPage";
// Settings (full module)
import { SettingsHome } from "@/pages/SettingsHome";
import { BusinessSetupPage } from "@/pages/BusinessSetupPage";
import { BusinessesPage } from "@/pages/BusinessesPage";
import { CurrenciesPage } from "@/pages/CurrenciesPage";
import { TaxRatesPage } from "@/pages/TaxRatesPage";
import { PaymentGatewaysPage } from "@/pages/PaymentGatewaysPage";
import { BankAccountsPage } from "@/pages/BankAccountsPage";
import { DocumentNumberingPage } from "@/pages/DocumentNumberingPage";
import { CustomFieldsPage } from "@/pages/CustomFieldsPage";
import { PipelineStagesPage } from "@/pages/PipelineStagesPage";
import { DocumentTemplatesPage } from "@/pages/DocumentTemplatesPage";
import { EmailSignaturesPage } from "@/pages/EmailSignaturesPage";
import { NotificationPreferencesPage } from "@/pages/NotificationPreferencesPage";
import { ScheduledReportsPage } from "@/pages/ScheduledReportsPage";
import { IntegrationSecretsPage } from "@/pages/IntegrationSecretsPage";
import { BusinessPoliciesPage } from "@/pages/BusinessPoliciesPage";
// IAM & Security (full module)
import { IamSecurityPage } from "@/pages/IamSecurityPage";
import { IamUsersPage } from "@/pages/IamUsersPage";
import { IamAuditPage } from "@/pages/IamAuditPage";
import { IamSecurityEventsPage } from "@/pages/IamSecurityEventsPage";
import { IamSessionsPage } from "@/pages/IamSessionsPage";
import { IamAccessReviewsPage } from "@/pages/IamAccessReviewsPage";
import { IamMfaPage } from "@/pages/IamMfaPage";
// Notifications
import { NotificationsPage } from "@/pages/NotificationsPage";
// Other module placeholders
import { HelpCenterPage } from "@/pages/HelpCenterPage";
import { HelpArticlePage } from "@/pages/HelpArticlePage";
import { HelpEditorPage } from "@/pages/HelpEditorPage";


/**
 * Lazy-import wrapper that survives a redeploy. When a new build ships, the
 * hashed chunk names change and an import() to an old chunk 404s — React
 * Router then surfaces "Failed to fetch dynamically imported module". We retry
 * once after a short delay, then force a single full reload to fetch the fresh
 * index.html + asset graph. A sessionStorage flag prevents a reload loop.
 */
function lazyWithRetry<T extends ComponentType<any>>( // eslint-disable-line @typescript-eslint/no-explicit-any
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    const FLAG = "pgh-chunk-reloaded";
    try {
      const mod = await factory();
      sessionStorage.removeItem(FLAG);
      return mod;
    } catch {
      // One quiet retry first — covers a transient network blip.
      try {
        await new Promise((r) => setTimeout(r, 350));
        const mod = await factory();
        sessionStorage.removeItem(FLAG);
        return mod;
      } catch (err) {
        if (!sessionStorage.getItem(FLAG)) {
          sessionStorage.setItem(FLAG, "1");
          window.location.reload();
          return new Promise<{ default: T }>(() => {}); // never resolves; page reloads
        }
        throw err;
      }
    }
  });
}

const CashRequestsPage = lazyWithRetry(
  () => import("@/pages/cash-requests/CashRequestsPage"),
);
const ExpensesPage = lazyWithRetry(
  () => import("@/pages/expenses/ExpensesPage"),
);
const AccountingPage = lazyWithRetry(
  () => import("@/pages/accounting/AccountingPage"),
);
const ProductionPage = lazyWithRetry(() =>
  import("@/pages/production/ProductionPage").then((m) => ({
    default: m.ProductionPage,
  })),
);
const PricingPage = lazyWithRetry(() =>
  import("@/pages/pricing/PricingPage").then((m) => ({
    default: m.PricingPage,
  })),
);
const PurchasingPage = lazyWithRetry(() =>
  import("@/pages/purchasing/PurchasingPage").then((m) => ({
    default: m.PurchasingPage,
  })),
);
const ServiceJobsPage = lazyWithRetry(() =>
  import("@/pages/service-jobs/ServiceJobsPage").then((m) => ({
    default: m.ServiceJobsPage,
  })),
);
const StylistsPage = lazyWithRetry(() =>
  import("@/pages/stylists/StylistsPage").then((m) => ({
    default: m.StylistsPage,
  })),
);
const FactoryLanguagePage = lazyWithRetry(() =>
  import("@/pages/FactoryLanguagePage").then((m) => ({
    default: m.FactoryLanguagePage,
  })),
);
const SmartCommPage = lazyWithRetry(() =>
  import("@/pages/smartcomm/SmartCommPage").then((m) => ({
    default: m.SmartCommPage,
  })),
);
const MessagingAccountsPage = lazyWithRetry(() =>
  import("@/pages/settings/MessagingAccountsPage").then((m) => ({
    default: m.MessagingAccountsPage,
  })),
);
const WhatsAppTemplatesPage = lazyWithRetry(() =>
  import("@/pages/settings/WhatsAppTemplatesPage").then((m) => ({
    default: m.WhatsAppTemplatesPage,
  })),
);
const CustomerOnboardingPublic = lazyWithRetry(() =>
  import("@/pages/onboarding/CustomerOnboardingPublic").then((m) => ({
    default: m.CustomerOnboardingPublic,
  })),
);
const WalkInPublic = lazyWithRetry(() =>
  import("@/pages/walkin/WalkInPublic").then((m) => ({
    default: m.WalkInPublic,
  })),
);
const OrderCapturePublic = lazyWithRetry(() =>
  import("@/pages/order-capture/OrderCapturePublic").then((m) => ({
    default: m.OrderCapturePublic,
  })),
);
const SignDocumentPage = lazyWithRetry(() =>
  import("@/pages/sign/SignDocumentPage").then((m) => ({
    default: m.SignDocumentPage,
  })),
);
const VerifyDocumentPage = lazyWithRetry(() =>
  import("@/pages/sign/VerifyDocumentPage").then((m) => ({
    default: m.VerifyDocumentPage,
  })),
);
const AiControlPage = lazyWithRetry(() =>
  import("@/pages/ai-control/AiControlPage").then((m) => ({
    default: m.AiControlPage,
  })),
);
const BrandVoicePage = lazyWithRetry(() =>
  import("@/pages/ai-control/BrandVoicePage").then((m) => ({
    default: m.BrandVoicePage,
  })),
);
const StockPage = lazyWithRetry(() =>
  import("@/pages/stock/StockPage").then((m) => ({ default: m.StockPage })),
);
const SalesCampaignsListPage = lazyWithRetry(() =>
  import("@/pages/sales-campaigns/SalesCampaignsListPage").then((m) => ({
    default: m.SalesCampaignsListPage,
  })),
);
const CampaignBuilderPage = lazyWithRetry(() =>
  import("@/pages/sales-campaigns/CampaignBuilderPage").then((m) => ({
    default: m.CampaignBuilderPage,
  })),
);
const CampaignDetailPage = lazyWithRetry(() =>
  import("@/pages/sales-campaigns/CampaignDetailPage").then((m) => ({
    default: m.CampaignDetailPage,
  })),
);
const CampaignBundlesPage = lazyWithRetry(() =>
  import("@/pages/sales-campaigns/CampaignBundlesPage").then((m) => ({
    default: m.CampaignBundlesPage,
  })),
);
const SpecialCodesPage = lazyWithRetry(() =>
  import("@/pages/sales-campaigns/SpecialCodesPage").then((m) => ({
    default: m.SpecialCodesPage,
  })),
);
const LandingStudioPage = lazyWithRetry(() =>
  import("@/pages/sales-campaigns/landing/LandingStudioPage").then((m) => ({
    default: m.LandingStudioPage,
  })),
);
const LandingPreviewPage = lazyWithRetry(() =>
  import("@/pages/sales-campaigns/landing/LandingPreviewPage").then((m) => ({
    default: m.LandingPreviewPage,
  })),
);
const StorefrontStudioPage = lazyWithRetry(() =>
  import("@/pages/storefront-studio/StorefrontStudioPage").then((m) => ({
    default: m.StorefrontStudioPage,
  })),
);
const ModelsAndVendorsPage = lazyWithRetry(() =>
  import("@/pages/ai-control/ModelsAndVendorsPage").then((m) => ({
    default: m.ModelsAndVendorsPage,
  })),
);
const ChannelPolicyPage = lazyWithRetry(() =>
  import("@/pages/settings/ChannelPolicyPage").then((m) => ({
    default: m.ChannelPolicyPage,
  })),
);
const QuickRepliesPage = lazyWithRetry(() =>
  import("@/pages/settings/QuickRepliesPage").then((m) => ({
    default: m.QuickRepliesPage,
  })),
);
const WorkspacePage = lazyWithRetry(() =>
  import("@/pages/workspace/WorkspacePage").then((m) => ({
    default: m.WorkspacePage,
  })),
);
const PraxisPage = lazyWithRetry(() => import("@/pages/praxis/PraxisPage"));
const InsightsPage = lazyWithRetry(() =>
  import("@/pages/insights/InsightsPage").then((m) => ({
    default: m.InsightsPage,
  })),
);
const AiInsightsControlPage = lazyWithRetry(() =>
  import("@/pages/ai-control/AiInsightsControlPage").then((m) => ({
    default: m.AiInsightsControlPage,
  })),
);
const TrainPraxisPage = lazyWithRetry(() =>
  import("@/pages/ai-control/TrainPraxisPage").then((m) => ({
    default: m.TrainPraxisPage,
  })),
);
const AiHealthLogsPage = lazyWithRetry(() =>
  import("@/pages/ai-control/AiHealthLogsPage").then((m) => ({
    default: m.AiHealthLogsPage,
  })),
);
const SpendBudgetPage = lazyWithRetry(() =>
  import("@/pages/ai-control/SpendBudgetPage").then((m) => ({
    default: m.SpendBudgetPage,
  })),
);
const FeatureFlagsPage = lazyWithRetry(() =>
  import("@/pages/ai-control/FeatureFlagsPage").then((m) => ({
    default: m.FeatureFlagsPage,
  })),
);
const InvoicingPage = lazyWithRetry(() =>
  import("@/pages/invoicing/InvoicingPage").then((m) => ({
    default: m.InvoicingPage,
  })),
);
const SocialPage = lazyWithRetry(() =>
  import("@/pages/social/SocialPage").then((m) => ({
    default: m.SocialPage,
  })),
);
const MarketingPage = lazyWithRetry(() =>
  import("@/pages/marketing/MarketingPage").then((m) => ({
    default: m.MarketingPage,
  })),
);
const RetentionPage = lazyWithRetry(() =>
  import("@/pages/retention/RetentionPage").then((m) => ({
    default: m.RetentionPage,
  })),
);
const StrategyBuilderPage = lazyWithRetry(() =>
  import("@/pages/retention/StrategyBuilderPage").then((m) => ({
    default: m.StrategyBuilderPage,
  })),
);
const DocumentsPage = lazyWithRetry(() =>
  import("@/pages/documents/DocumentsPage").then((m) => ({
    default: m.DocumentsPage,
  })),
);
const LogisticsPage = lazyWithRetry(() =>
  import("@/pages/logistics/LogisticsPage").then((m) => ({
    default: m.LogisticsPage,
  })),
);
const RetailPartnersPage = lazyWithRetry(() =>
  import("@/pages/retail-partners/RetailPartnersPage").then((m) => ({
    default: m.RetailPartnersPage,
  })),
);
const HrStaffPage = lazyWithRetry(() => import("@/pages/hr/HrStaffPage"));
const EmployeeProfilePage = lazyWithRetry(() => import("@/pages/hr/EmployeeProfilePage"));
const PayrollPage = lazyWithRetry(() => import("@/pages/hr/PayrollPage"));
const PerformancePage = lazyWithRetry(() => import("@/pages/hr/PerformancePage"));

/**
 * Two trees:
 *  - Public, pre-auth routes (/login, /reset-password) render standalone.
 *  - Everything else sits behind <RequireAuth/>, which restores the session
 *    from the refresh cookie before rendering. /select-entity is authed but
 *    lives OUTSIDE the AppShell (it's a full-screen chooser); the shell and
 *    its module routes are the authenticated app.
 *
 * `/settings` is the landing (card grid); each sub-page is a focused tile.
 * Audit and IAM live in /iam-security; help in /help.
 */
export const router = createBrowserRouter(
  [
    { path: "/login", element: <LoginPage /> },
    { path: "/reset-password", element: <ResetPasswordPage /> },
    // Public Walk-in registration (the counter QR opens this; no auth). The
    // brand rides in the path; the form POSTs to /api/public/walk-in.
    {
      path: "/walkin/:brand",
      element: (
        <Suspense fallback={<RouteFallback />}>
          <WalkInPublic />
        </Suspense>
      ),
    },
    // Public Online QR welcome form (token-protected, no auth required).
    {
      path: "/welcome/:business/:token",
      element: (
        <Suspense fallback={<RouteFallback />}>
          <CustomerOnboardingPublic />
        </Suspense>
      ),
    },
    // Public Order Capture consumer (the staffer mints, customer opens).
    {
      path: "/order/capture/:token",
      element: (
        <Suspense fallback={<RouteFallback />}>
          <OrderCapturePublic />
        </Suspense>
      ),
    },
    // Public document signing (emailed token link; no auth). Draw a signature
    // or unlock a saved one with a PIN.
    {
      path: "/sign/:token",
      element: (
        <Suspense fallback={<RouteFallback />}>
          <SignDocumentPage />
        </Suspense>
      ),
    },
    // Public signature verification (the code printed on a signed document).
    {
      path: "/verify/:code",
      element: (
        <Suspense fallback={<RouteFallback />}>
          <VerifyDocumentPage />
        </Suspense>
      ),
    },
    {
      element: <RequireAuth />,
      children: [
        { path: "/select-entity", element: <SelectEntityPage /> },
        // Landing Studio — standalone full-screen editor + chrome-less
        // preview tab. Authed (session restored by RequireAuth) but outside
        // the AppShell so it owns the whole viewport.
        {
          path: "/landing-studio",
          element: (
            <Suspense fallback={<RouteFallback />}>
              <LandingStudioPage />
            </Suspense>
          ),
        },
        {
          path: "/landing-studio/preview",
          element: (
            <Suspense fallback={<RouteFallback />}>
              <LandingPreviewPage />
            </Suspense>
          ),
        },
        {
          path: "/",
          element: <AppShell />,
          children: [
            { index: true, element: <CommandCenter /> },
            { path: "dashboard", element: <DashboardPage /> },
            {
              path: "insights",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <InsightsPage />
                </Suspense>
              ),
            },
            { path: "sales", element: <SalesPage /> },
            { path: "sales/orders/:orderId", element: <OrderDetailPage /> },
            // Storefront Studio - renders inside the app shell like other modules.
            {
              path: "storefront-studio",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <StorefrontStudioPage />
                </Suspense>
              ),
            },
            { path: "contacts", element: <ContactsPage /> },
            { path: "contacts/milestones", element: <MilestonesPage /> },
            { path: "contacts/staff/new", element: <EmployeeOnboardingPage /> },
            { path: "contacts/:id", element: <ContactProfilePage /> },
            {
              // My HR moved into Workspace as a tab (module consolidation) —
              // redirect old bookmarks/links rather than 404ing them.
              path: "my-hr",
              element: <Navigate to="/workspace?tab=my-hr" replace />,
            },
            {
              path: "hr",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <HrStaffPage />
                </Suspense>
              ),
            },
            {
              path: "hr/employees/:profileId",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <EmployeeProfilePage />
                </Suspense>
              ),
            },
            {
              path: "payroll",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <PayrollPage />
                </Suspense>
              ),
            },
            {
              path: "performance",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <PerformancePage />
                </Suspense>
              ),
            },
            { path: "crm", element: <CrmPage /> },
            { path: "crm/clients/:contactId", element: <ClientProfilePage /> },
            { path: "crm/deals/:id", element: <DealDetailPage /> },
            {
              path: "expenses",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <ExpensesPage />
                </Suspense>
              ),
            },
            {
              path: "accounting",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <AccountingPage />
                </Suspense>
              ),
            },
            {
              path: "cash-requests",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <CashRequestsPage />
                </Suspense>
              ),
            },

            // Catalogue — base/styled product model, categories, collections,
            // bundles. Detail/create live on their own routes.
            { path: "catalogue", element: <CataloguePage /> },
            { path: "catalogue/base/:id", element: <BaseProductPage /> },
            { path: "catalogue/styled/:id", element: <StyledProductPage /> },

            // Workspace (Tasks + Calendar + My Day)
            // Praxis AI agent (§6.29) — full workspace; the drawer opens
            // from the FloatingLauncher on every screen.
            {
              path: "praxis",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <PraxisPage />
                </Suspense>
              ),
            },
            {
              path: "workspace",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <WorkspacePage />
                </Suspense>
              ),
            },

            // Stock & Inventory
            {
              path: "stock",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <StockPage />
                </Suspense>
              ),
            },

            // Sales Campaigns & Landing Pages (V2.2 §6.22).
            {
              path: "sales-campaigns",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <SalesCampaignsListPage />
                </Suspense>
              ),
            },
            {
              path: "sales-campaigns/bundles",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <CampaignBundlesPage />
                </Suspense>
              ),
            },
            {
              path: "sales-campaigns/codes",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <SpecialCodesPage />
                </Suspense>
              ),
            },
            {
              path: "sales-campaigns/:id",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <CampaignDetailPage />
                </Suspense>
              ),
            },
            {
              path: "sales-campaigns/:id/edit",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <CampaignBuilderPage />
                </Suspense>
              ),
            },

            // Social Media, Marketing & Email Campaigns, Documents & Signatures.
            {
              path: "social",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <SocialPage />
                </Suspense>
              ),
            },
            {
              path: "marketing",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <MarketingPage />
                </Suspense>
              ),
            },

            // Customer Retention & Loyalty (V2.2 §6.23).
            {
              path: "retention",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <RetentionPage />
                </Suspense>
              ),
            },
            {
              path: "retention/strategies/new",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <StrategyBuilderPage />
                </Suspense>
              ),
            },
            {
              path: "retention/strategies/:id/edit",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <StrategyBuilderPage />
                </Suspense>
              ),
            },
            {
              path: "documents",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <DocumentsPage />
                </Suspense>
              ),
            },
            {
              path: "logistics",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <LogisticsPage />
                </Suspense>
              ),
            },

            // Service Jobs (Faitlyn hair assignment register)
            {
              path: "service-jobs",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <ServiceJobsPage />
                </Suspense>
              ),
            },

            // Stylist Partner Programme (§6.26 — PXG partner network)
            {
              path: "stylists",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <StylistsPage />
                </Suspense>
              ),
            },

            // Production (China factory account + production runs)
            {
              path: "production",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <ProductionPage />
                </Suspense>
              ),
            },
            // Pricing Engine
            {
              path: "pricing",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <PricingPage />
                </Suspense>
              ),
            },
            // Purchasing (PO lifecycle + GRN + invoices)
            {
              path: "purchasing",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <PurchasingPage />
                </Suspense>
              ),
            },
            // Invoicing & Billing (V2.2 §6.5) — invoices, credit notes, AR ageing.
            {
              path: "invoicing",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <InvoicingPage />
                </Suspense>
              ),
            },
            // Retail / Consignment Partners (V2.2 §6.29, guide §2.21).
            {
              path: "retail-partners",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <RetailPartnersPage />
                </Suspense>
              ),
            },

            // Settings — landing + sub-pages.
            { path: "settings", element: <SettingsHome /> },
            { path: "settings/appearance", element: <AppearancePage /> },
            { path: "settings/login", element: <LoginEditorPage /> },
            { path: "settings/business-setup", element: <BusinessSetupPage /> },
            { path: "settings/businesses", element: <BusinessesPage /> },
            { path: "settings/currencies", element: <CurrenciesPage /> },
            { path: "settings/tax-rates", element: <TaxRatesPage /> },
            {
              path: "settings/payment-gateways",
              element: <PaymentGatewaysPage />,
            },
            { path: "settings/bank-accounts", element: <BankAccountsPage /> },
            {
              path: "settings/document-numbering",
              element: <DocumentNumberingPage />,
            },
            { path: "settings/custom-fields", element: <CustomFieldsPage /> },
            {
              path: "settings/pipeline-stages",
              element: <PipelineStagesPage />,
            },
            {
              path: "settings/document-templates",
              element: <DocumentTemplatesPage />,
            },
            {
              path: "settings/email-signatures",
              element: <EmailSignaturesPage />,
            },
            {
              path: "settings/notifications",
              element: <NotificationPreferencesPage />,
            },
            {
              path: "settings/scheduled-reports",
              element: <ScheduledReportsPage />,
            },
            {
              path: "settings/integration-secrets",
              element: <IntegrationSecretsPage />,
            },
            { path: "settings/policies", element: <BusinessPoliciesPage /> },
            { path: "settings/contact-tags", element: <ContactTagsPage /> },
            {
              path: "settings/factory-languages",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <FactoryLanguagePage />
                </Suspense>
              ),
            },

            // Org & Workflow (roles / approvals / permission matrix).
            { path: "org-workflow", element: <OrgWorkflowPage /> },

            // IAM & Security — landing + sub-pages.
            { path: "iam-security", element: <IamSecurityPage /> },
            { path: "iam-security/users", element: <IamUsersPage /> },
            { path: "iam-security/audit", element: <IamAuditPage /> },
            { path: "iam-security/events", element: <IamSecurityEventsPage /> },
            { path: "iam-security/sessions", element: <IamSessionsPage /> },
            { path: "iam-security/reviews", element: <IamAccessReviewsPage /> },
            { path: "iam-security/mfa", element: <IamMfaPage /> },

            // Notifications inbox.
            { path: "notifications", element: <NotificationsPage /> },

            // Help Center.
            { path: "help", element: <HelpCenterPage /> },
            { path: "help/editor", element: <HelpEditorPage /> },
            { path: "help/:slug", element: <HelpArticlePage /> },

            // Smart Comm (Messaging).
            {
              path: "smartcomm",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <SmartCommPage />
                </Suspense>
              ),
            },

            // AI Control + Brand Voice editor (PR 3).
            {
              path: "ai-control",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <AiControlPage />
                </Suspense>
              ),
            },
            {
              path: "ai-control/brand-voice",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <BrandVoicePage />
                </Suspense>
              ),
            },
            {
              path: "ai-control/insights",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <AiInsightsControlPage />
                </Suspense>
              ),
            },
            {
              path: "ai-control/vendors",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <ModelsAndVendorsPage />
                </Suspense>
              ),
            },
            {
              path: "ai-control/training",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <TrainPraxisPage />
                </Suspense>
              ),
            },
            {
              path: "ai-control/health",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <AiHealthLogsPage />
                </Suspense>
              ),
            },
            {
              path: "ai-control/budget",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <SpendBudgetPage />
                </Suspense>
              ),
            },
            {
              path: "ai-control/governance",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <FeatureFlagsPage />
                </Suspense>
              ),
            },

            // Channel Policy + Quick Replies (PR 3 — Settings).
            {
              path: "settings/channel-policy",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <ChannelPolicyPage />
                </Suspense>
              ),
            },
            {
              path: "settings/quick-replies",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <QuickRepliesPage />
                </Suspense>
              ),
            },
            {
              path: "settings/whatsapp-templates",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <WhatsAppTemplatesPage />
                </Suspense>
              ),
            },
            {
              path: "settings/messaging-accounts",
              element: (
                <Suspense fallback={<RouteFallback />}>
                  <MessagingAccountsPage />
                </Suspense>
              ),
            },

            { path: "*", element: <ModulePlaceholder /> },
          ],
        },
      ],
    },
  ],
  {
    future: {
      v7_relativeSplatPath: true,
    },
  },
);
