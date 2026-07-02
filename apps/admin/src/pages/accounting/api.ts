import { api } from "@/lib/api";
import type {
  Account,
  AccountGroup,
  Ageing,
  BalanceSheet,
  BankReconciliation,
  BankStatement,
  CashFlow,
  FiscalPeriod,
  JournalEntry,
  ManualJournalInput,
  PaginatedResponse,
  ProfitAndLoss,
  TaxComputation,
  TaxFiling,
  TaxType,
  TrialBalance,
} from "./types";

const ACC = "/accounting";

const qs = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
};

// ── Chart of accounts ────────────────────────────────────
export const listAccountGroups = () =>
  api.get<AccountGroup[]>(`${ACC}/account-groups`);
export const listAccounts = (params: { group_id?: string; q?: string } = {}) =>
  api.get<Account[]>(`${ACC}/accounts${qs(params)}`);

// ── Fiscal periods ───────────────────────────────────────
export const listPeriods = () => api.get<FiscalPeriod[]>(`${ACC}/periods`);
export const closePeriod = (id: string) =>
  api.post<FiscalPeriod>(`${ACC}/periods/${id}/close`, {});

// ── Journals ─────────────────────────────────────────────
export const listJournals = (params: {
  status?: string;
  source_type?: string;
  from?: string;
  to?: string;
  page?: number;
  page_size?: number;
}) => api.get<PaginatedResponse<JournalEntry>>(`${ACC}/journals${qs(params)}`);
export const getJournal = (id: string) =>
  api.get<JournalEntry>(`${ACC}/journals/${id}`);
export const createManualJournal = (input: ManualJournalInput) =>
  api.post<JournalEntry>(`${ACC}/journals`, input);
export const postOpeningBalance = (input: ManualJournalInput) =>
  api.post<JournalEntry>(`${ACC}/opening-balance`, input);
export const reverseJournal = (id: string, reason?: string) =>
  api.post<JournalEntry>(`${ACC}/journals/${id}/reverse`, { reason });

// ── Reports ──────────────────────────────────────────────
export const getTrialBalance = (as_of?: string) =>
  api.get<TrialBalance>(`${ACC}/reports/trial-balance${qs({ as_of })}`);
export const getProfitAndLoss = (from?: string, to?: string) =>
  api.get<ProfitAndLoss>(`${ACC}/reports/profit-and-loss${qs({ from, to })}`);
export const getBalanceSheet = (as_of?: string) =>
  api.get<BalanceSheet>(`${ACC}/reports/balance-sheet${qs({ as_of })}`);
export const getCashFlow = (from?: string, to?: string) =>
  api.get<CashFlow>(`${ACC}/reports/cash-flow${qs({ from, to })}`);
export const getArAgeing = () => api.get<Ageing>(`${ACC}/reports/ar-ageing`);
export const getApAgeing = () => api.get<Ageing>(`${ACC}/reports/ap-ageing`);

// ── Tax Center ───────────────────────────────────────────
export const getTaxComputation = (tax_type: TaxType, period_id: string) =>
  api.get<TaxComputation>(`${ACC}/tax/computation${qs({ tax_type, period_id })}`);
export const listTaxFilings = (params: { status?: string; page?: number }) =>
  api.get<PaginatedResponse<TaxFiling>>(`${ACC}/tax-filings${qs(params)}`);
export const draftFilingFromPeriod = (input: {
  tax_type: TaxType;
  fiscal_period_id: string;
}) => api.post<TaxFiling>(`${ACC}/tax-filings/draft-from-period`, input);
export const reviewFiling = (id: string) =>
  api.post<TaxFiling>(`${ACC}/tax-filings/${id}/review`, {});
export const fileFiling = (id: string, filing_reference?: string) =>
  api.post<TaxFiling>(`${ACC}/tax-filings/${id}/file`, { filing_reference });
export const payFiling = (id: string, payment_reference?: string) =>
  api.post<TaxFiling & { journal_entry_id: string }>(
    `${ACC}/tax-filings/${id}/pay`,
    { payment_reference },
  );

// ── Bank ─────────────────────────────────────────────────
export const listBankStatements = (params: { page?: number } = {}) =>
  api.get<PaginatedResponse<BankStatement>>(`${ACC}/bank-statements${qs(params)}`);
export const listBankReconciliations = (params: { page?: number } = {}) =>
  api.get<PaginatedResponse<BankReconciliation>>(
    `${ACC}/bank-reconciliations${qs(params)}`,
  );
