/**
 * Settings — data layer. Typed TanStack Query hooks for every Settings
 * concern. Per-brand resources include the active brand key in their
 * query key so switching brands refetches; the API attaches the brand
 * via X-Brand-Context (see lib/api.ts).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useBusinessStore } from "@/stores/business";

function useBrand() {
  return useBusinessStore((s) => s.activeKey);
}

// ════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════
export interface BusinessConfig {
  config_id: string;
  business_key: string;
  display_name: string;
  legal_name: string;
  trading_currency: string;
  settlement_currency: string;
  document_prefix: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  tin: string | null;
  cac_number: string | null;
  vat_number: string | null;
  vat_rate: string;
  wht_rate: string;
  fiscal_year_start: number;
  mission_statement: string | null;
  loyalty_settings: Record<string, unknown>;
  cancellation_settings: Record<string, unknown>;
  quantity_discount_rules: unknown[];
  intercompany_settings: Record<string, unknown>;
  fx_settings: Record<string, unknown>;
  payment_gateway_fees: Record<string, unknown>;
  installment_settings: Record<string, unknown>;
  allow_staff_recorded_manual_payments: boolean;
  is_active: boolean;
}

export interface Currency {
  currency_code: string;
  display_name: string;
  symbol: string;
  decimal_places: number;
  rounding_unit: string;
  is_settlement: boolean;
  is_active: boolean;
  display_order: number;
}
export interface FxRate {
  rate_id: string;
  from_currency: string;
  to_currency: string;
  rate: string;
  source: string | null;
  is_manual_override: boolean;
  valid_at: string;
  created_at: string;
}
export interface TaxRate {
  tax_id: string;
  business: string;
  tax_name: string;
  tax_type: "sales" | "purchases" | "payroll";
  rate: string;
  applies_to: string;
  is_active: boolean;
  effective_from: string;
  effective_to: string | null;
  excluded_modules: string[];
}
export interface DocSequence {
  seq_id: string;
  business: string;
  document_type: string;
  prefix: string;
  next_number: number;
  padding: number;
}
export interface CustomField {
  field_id: string;
  business: string;
  entity_type: string;
  field_key: string;
  field_label: string;
  field_type: string;
  options: unknown[];
  is_required: boolean;
  is_searchable: boolean;
  is_filterable: boolean;
  visible_to_roles: string[];
  display_order: number;
  is_active: boolean;
}
export interface PipelineStage {
  stage_id: string;
  business: string;
  pipeline_type: string;
  stage_key: string;
  stage_label: string;
  display_order: number;
  is_terminal: boolean;
  is_positive_terminal: boolean | null;
  colour: string;
}
export interface BankAccount {
  account_id: string;
  business: string;
  bank_name: string;
  account_name: string;
  account_number: string;
  account_number_masked?: string;
  account_number_last4?: string;
  sort_code: string | null;
  currency: string;
  is_primary: boolean;
  paystack_recipient_code: string | null;
  opay_account_id: string | null;
  is_active: boolean;
}
export interface PaymentGateway {
  gateway_id?: string;
  business: string;
  provider: "paystack" | "opay" | "nomba" | "stripe";
  is_active: boolean;
  role: "primary" | "fallback" | "standalone";
  supported_currencies: string[];
  display_label: string | null;
  has_credentials: boolean;
}
export interface DocumentTemplate {
  template_id: string;
  business: string;
  doc_type: string;
  name: string;
  version: number;
  status: "draft" | "published" | "archived";
  header_html: string | null;
  body_html: string | null;
  footer_html: string | null;
  css_vars: Record<string, string>;
  is_default: boolean;
  updated_at: string;
}
export interface NotificationPref {
  pref_id: string;
  user_id: string;
  channel: "email" | "sms" | "push" | "in_app";
  category: string;
  enabled: boolean;
  config: Record<string, unknown>;
}
export interface ScheduledReport {
  report_id: string;
  business: string;
  name: string;
  source_module: string;
  trigger_event: string | null;
  params: Record<string, unknown>;
  cadence: "daily" | "weekly" | "monthly" | "quarterly" | "on_event";
  recipients: string[];
  formats: string[];
  is_active: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
}
export interface IntegrationSecret {
  secret_id: string;
  business: string | null;
  provider: string;
  key_name: string;
  last4: string | null;
  is_active: boolean;
  updated_at: string;
}
export interface EmailSignature {
  user_id: string;
  display_name?: string;
  html?: string;
  is_custom?: boolean;
}

// ════════════════════════════════════════════════════════════
// Business config
// ════════════════════════════════════════════════════════════
export function useBusinessConfig() {
  const brand = useBrand();
  return useQuery<BusinessConfig>({
    queryKey: ["bs-config", brand],
    queryFn: () => api.get<BusinessConfig>("/business-setup/config"),
  });
}
export function useSaveBusinessConfig() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (patch: Partial<BusinessConfig>) =>
      api.patch<BusinessConfig>("/business-setup/config", patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bs-config", brand] }),
  });
}

// ════════════════════════════════════════════════════════════
// Currencies + FX
// ════════════════════════════════════════════════════════════
export function useCurrencies() {
  return useQuery<Currency[]>({
    queryKey: ["currencies"],
    queryFn: () => api.get<Currency[]>("/business-setup/currencies"),
  });
}
export function useSaveCurrency() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (row: Partial<Currency> & { currency_code: string }) =>
      api.post("/business-setup/currencies", row),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["currencies"] }),
  });
}
export function useUpdateCurrency() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ code, patch }: { code: string; patch: Partial<Currency> }) =>
      api.patch(`/business-setup/currencies/${code}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["currencies"] }),
  });
}
export function useFxRates(params?: { from?: string; to?: string }) {
  const qs = new URLSearchParams();
  if (params?.from) qs.set("from", params.from);
  if (params?.to) qs.set("to", params.to);
  const q = qs.toString();
  return useQuery<FxRate[]>({
    queryKey: ["fx-rates", q],
    queryFn: () => api.get<FxRate[]>(`/business-setup/fx-rates${q ? `?${q}` : ""}`),
  });
}
export function useSetFxRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (row: {
      from_currency: string;
      to_currency?: string;
      rate: number;
      valid_at?: string;
      source?: string;
    }) => api.post("/business-setup/fx-rates", row),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fx-rates"] }),
  });
}

// ════════════════════════════════════════════════════════════
// Tax rates
// ════════════════════════════════════════════════════════════
export function useTaxRates(taxType?: string) {
  const brand = useBrand();
  const q = taxType ? `?tax_type=${taxType}` : "";
  return useQuery<TaxRate[]>({
    queryKey: ["tax-rates", brand, taxType ?? "all"],
    queryFn: () => api.get<TaxRate[]>(`/business-setup/tax-rates${q}`),
  });
}
export function useCreateTaxRate() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (row: Partial<TaxRate>) =>
      api.post("/business-setup/tax-rates", row),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tax-rates", brand] }),
  });
}
export function useUpdateTaxRate() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<TaxRate> }) =>
      api.patch(`/business-setup/tax-rates/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tax-rates", brand] }),
  });
}

// ════════════════════════════════════════════════════════════
// Document numbering
// ════════════════════════════════════════════════════════════
export function useDocSequences() {
  const brand = useBrand();
  return useQuery<DocSequence[]>({
    queryKey: ["doc-numbering", brand],
    queryFn: () => api.get<DocSequence[]>("/business-setup/document-numbering"),
  });
}
export function useUpdateDocSequence() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { prefix?: string; padding?: number } }) =>
      api.patch(`/business-setup/document-numbering/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doc-numbering", brand] }),
  });
}

// ════════════════════════════════════════════════════════════
// Custom fields
// ════════════════════════════════════════════════════════════
export function useCustomFields(entityType?: string) {
  const brand = useBrand();
  const q = entityType ? `?entity_type=${entityType}` : "";
  return useQuery<CustomField[]>({
    queryKey: ["custom-fields", brand, entityType ?? "all"],
    queryFn: () => api.get<CustomField[]>(`/business-setup/custom-fields${q}`),
  });
}
export function useCreateCustomField() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (row: Partial<CustomField>) =>
      api.post("/business-setup/custom-fields", row),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["custom-fields", brand] }),
  });
}
export function useUpdateCustomField() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CustomField> }) =>
      api.patch(`/business-setup/custom-fields/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["custom-fields", brand] }),
  });
}

// ════════════════════════════════════════════════════════════
// Pipeline stages
// ════════════════════════════════════════════════════════════
export function usePipelineStages(pipelineType?: string) {
  const brand = useBrand();
  const q = pipelineType ? `?pipeline_type=${pipelineType}` : "";
  return useQuery<PipelineStage[]>({
    queryKey: ["pipeline-stages", brand, pipelineType ?? "all"],
    queryFn: () => api.get<PipelineStage[]>(`/business-setup/pipeline-stages${q}`),
  });
}
export function useCreatePipelineStage() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (row: Partial<PipelineStage>) =>
      api.post("/business-setup/pipeline-stages", row),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipeline-stages", brand] }),
  });
}
export function useUpdatePipelineStage() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<PipelineStage> }) =>
      api.patch(`/business-setup/pipeline-stages/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipeline-stages", brand] }),
  });
}
export function useDeletePipelineStage() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/business-setup/pipeline-stages/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipeline-stages", brand] }),
  });
}

// ════════════════════════════════════════════════════════════
// Bank accounts
// ════════════════════════════════════════════════════════════
export function useBankAccounts() {
  const brand = useBrand();
  return useQuery<BankAccount[]>({
    queryKey: ["bank-accounts", brand],
    queryFn: () => api.get<BankAccount[]>("/business-setup/bank-accounts"),
  });
}
export function useCreateBankAccount() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (row: Partial<BankAccount>) =>
      api.post("/business-setup/bank-accounts", row),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bank-accounts", brand] }),
  });
}
export function useUpdateBankAccount() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<BankAccount> }) =>
      api.patch(`/business-setup/bank-accounts/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bank-accounts", brand] }),
  });
}

// ════════════════════════════════════════════════════════════
// Payment gateways
// ════════════════════════════════════════════════════════════
export function usePaymentGateways() {
  const brand = useBrand();
  return useQuery<PaymentGateway[]>({
    queryKey: ["payment-gateways", brand],
    queryFn: () => api.get<PaymentGateway[]>("/business-setup/payment-gateways"),
  });
}
export function useConfigureGateway() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (row: {
      provider: string;
      credentials?: Record<string, string>;
      supported_currencies?: string[];
      display_label?: string;
      role?: string;
    }) => api.post("/business-setup/payment-gateways", row),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payment-gateways", brand] }),
  });
}
export function useSetGatewayActive() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: ({ provider, is_active }: { provider: string; is_active: boolean }) =>
      api.patch(`/business-setup/payment-gateways/${provider}/active`, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payment-gateways", brand] }),
  });
}
export function useSetGatewayRole() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: ({ provider, role }: { provider: string; role: string }) =>
      api.patch(`/business-setup/payment-gateways/${provider}/role`, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payment-gateways", brand] }),
  });
}

// ════════════════════════════════════════════════════════════
// Businesses
// ════════════════════════════════════════════════════════════
export interface BusinessRow {
  config_id: string;
  business_key: string;
  display_name: string;
  legal_name: string;
  is_active: boolean;
  document_prefix: string;
}
export function useBusinesses() {
  return useQuery<BusinessRow[]>({
    queryKey: ["bs-businesses"],
    queryFn: () => api.get<BusinessRow[]>("/business-setup/businesses"),
  });
}
export function useProvisionBusiness() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (row: {
      business_key: string;
      display_name: string;
      legal_name: string;
      document_prefix: string;
    }) => api.post("/business-setup/businesses", row),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bs-businesses"] }),
  });
}

// ════════════════════════════════════════════════════════════
// Email signatures
// ════════════════════════════════════════════════════════════
export function useSignatureTemplate() {
  const brand = useBrand();
  return useQuery<{ html: string }>({
    queryKey: ["signature-template", brand],
    queryFn: () => api.get("/business-setup/email-signature-template"),
  });
}
export function useSaveSignatureTemplate() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (html: string) =>
      api.put("/business-setup/email-signature-template", { html }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["signature-template", brand] }),
  });
}

// ════════════════════════════════════════════════════════════
// Document templates (settings module)
// ════════════════════════════════════════════════════════════
export function useDocumentTemplates(docType?: string) {
  const brand = useBrand();
  const q = docType ? `?doc_type=${docType}` : "";
  return useQuery<DocumentTemplate[]>({
    queryKey: ["doc-templates", brand, docType ?? "all"],
    queryFn: () => api.get<DocumentTemplate[]>(`/settings/document-templates${q}`),
  });
}
export function useCreateDocumentTemplate() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (row: Partial<DocumentTemplate>) =>
      api.post("/settings/document-templates", row),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doc-templates", brand] }),
  });
}
export function useUpdateDocumentTemplate() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<DocumentTemplate> }) =>
      api.patch(`/settings/document-templates/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doc-templates", brand] }),
  });
}
export function useSetDefaultTemplate() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) =>
      api.post(`/settings/document-templates/${id}/set-default`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doc-templates", brand] }),
  });
}
export function useDeleteDocumentTemplate() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/settings/document-templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doc-templates", brand] }),
  });
}

// ════════════════════════════════════════════════════════════
// Notification preferences (self)
// ════════════════════════════════════════════════════════════
export function useNotificationPrefs() {
  return useQuery<NotificationPref[]>({
    queryKey: ["notification-prefs"],
    queryFn: () => api.get<NotificationPref[]>("/settings/notification-preferences"),
  });
}
export function useUpsertNotificationPref() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (row: {
      channel: string;
      category: string;
      enabled?: boolean;
      config?: Record<string, unknown>;
    }) => api.put("/settings/notification-preferences", row),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notification-prefs"] }),
  });
}

// ════════════════════════════════════════════════════════════
// Scheduled reports
// ════════════════════════════════════════════════════════════
export function useScheduledReports() {
  const brand = useBrand();
  return useQuery<ScheduledReport[]>({
    queryKey: ["scheduled-reports", brand],
    queryFn: () => api.get<ScheduledReport[]>("/settings/scheduled-reports"),
  });
}
export function useCreateReport() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (row: Partial<ScheduledReport>) =>
      api.post("/settings/scheduled-reports", row),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scheduled-reports", brand] }),
  });
}
export function useUpdateReport() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ScheduledReport> }) =>
      api.patch(`/settings/scheduled-reports/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scheduled-reports", brand] }),
  });
}
export function useDeleteReport() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/settings/scheduled-reports/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scheduled-reports", brand] }),
  });
}

// ════════════════════════════════════════════════════════════
// Integration secrets (write-only)
// ════════════════════════════════════════════════════════════
export function useIntegrationSecrets() {
  const brand = useBrand();
  return useQuery<IntegrationSecret[]>({
    queryKey: ["integration-secrets", brand],
    queryFn: () => api.get<IntegrationSecret[]>("/settings/integration-secrets"),
  });
}
export function useSetSecret() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (row: { provider: string; key_name: string; secret: string }) =>
      api.put("/settings/integration-secrets", row),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integration-secrets", brand] }),
  });
}
export function useDeleteSecret() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/settings/integration-secrets/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integration-secrets", brand] }),
  });
}
