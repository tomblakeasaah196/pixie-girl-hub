import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";
import { AppShell } from "@/components/shell/AppShell";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { CommandCenter } from "@/pages/CommandCenter";
import { SalesPage } from "@/pages/SalesPage";
import { ContactsPage } from "@/pages/contacts/ContactsPage";
import { MilestonesPage } from "@/pages/contacts/MilestonesPage";
import { ContactTagsPage } from "@/pages/ContactTagsPage";
import { CrmPage } from "@/pages/crm/CrmPage";
import { DealDetailPage } from "@/pages/crm/deals/DealDetailPage";
import { CataloguePage } from "@/pages/catalogue/CataloguePage";
import { BaseProductPage } from "@/pages/catalogue/BaseProductPage";
import { StyledProductPage } from "@/pages/catalogue/StyledProductPage";

const CashExpensesHome = lazy(() => import("@/pages/cash-expenses/CashExpensesHome"));
import { AppearancePage } from "@/pages/AppearancePage";
import { LoginEditorPage } from "@/pages/LoginEditorPage";
import { ModulePlaceholder } from "@/pages/ModulePlaceholder";
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
    {
      element: <RequireAuth />,
      children: [
        { path: "/select-entity", element: <SelectEntityPage /> },
        {
          path: "/",
          element: <AppShell />,
          children: [
            { index: true, element: <CommandCenter /> },
            { path: "sales", element: <SalesPage /> },
            { path: "contacts", element: <ContactsPage /> },
            { path: "contacts/milestones", element: <MilestonesPage /> },
            { path: "crm", element: <CrmPage /> },
            { path: "crm/deals/:id", element: <DealDetailPage /> },
            { path: "expenses", element: <Suspense fallback={null}><CashExpensesHome defaultTab="expenses" /></Suspense> },
            { path: "cash-requests", element: <Suspense fallback={null}><CashExpensesHome defaultTab="my-requests" /></Suspense> },

            // Catalogue — base/styled product model, categories, collections,
            // bundles. Detail/create live on their own routes.
            { path: "catalogue", element: <CataloguePage /> },
            { path: "catalogue/base/:id", element: <BaseProductPage /> },
            { path: "catalogue/styled/:id", element: <StyledProductPage /> },

            // Settings — landing + sub-pages.
            { path: "settings", element: <SettingsHome /> },
            { path: "settings/appearance", element: <AppearancePage /> },
            { path: "settings/login", element: <LoginEditorPage /> },
            { path: "settings/business-setup", element: <BusinessSetupPage /> },
            { path: "settings/businesses", element: <BusinessesPage /> },
            { path: "settings/currencies", element: <CurrenciesPage /> },
            { path: "settings/tax-rates", element: <TaxRatesPage /> },
            { path: "settings/payment-gateways", element: <PaymentGatewaysPage /> },
            { path: "settings/bank-accounts", element: <BankAccountsPage /> },
            { path: "settings/document-numbering", element: <DocumentNumberingPage /> },
            { path: "settings/custom-fields", element: <CustomFieldsPage /> },
            { path: "settings/pipeline-stages", element: <PipelineStagesPage /> },
            { path: "settings/document-templates", element: <DocumentTemplatesPage /> },
            { path: "settings/email-signatures", element: <EmailSignaturesPage /> },
            { path: "settings/notifications", element: <NotificationPreferencesPage /> },
            { path: "settings/scheduled-reports", element: <ScheduledReportsPage /> },
            { path: "settings/integration-secrets", element: <IntegrationSecretsPage /> },
            { path: "settings/policies", element: <BusinessPoliciesPage /> },
            { path: "settings/contact-tags", element: <ContactTagsPage /> },

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
