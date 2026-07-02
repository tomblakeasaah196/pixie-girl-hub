export interface PaginatedResponse<T> {
  data: T[];
  meta: { page: number; page_size: number; total: number; has_more: boolean };
}

export interface AccountGroup {
  group_id: string;
  group_code: string;
  group_name: string;
  group_type: string;
  normal_balance: "debit" | "credit";
  statement: string;
  is_active: boolean;
}

export interface Account {
  account_id: string;
  account_code: string;
  account_name: string;
  group_id: string;
  group_name?: string;
  group_type?: string;
  description?: string | null;
  is_control_account: boolean;
  control_subledger?: string | null;
  account_currency?: string | null;
  allow_posting: boolean;
  is_active: boolean;
}

export interface FiscalPeriod {
  period_id: string;
  fiscal_year: number;
  period_number: number;
  period_name: string;
  starts_on: string;
  ends_on: string;
  status: "future" | "open" | "closing" | "closed" | "adjusted" | "locked";
  is_year_end: boolean;
}

export interface JournalLine {
  line_id: string;
  account_id: string;
  account_code?: string;
  account_name?: string;
  debit_ngn: string;
  credit_ngn: string;
  description?: string | null;
}

export interface JournalEntry {
  entry_id: string;
  entry_number: string;
  source_type: string;
  source_id?: string | null;
  posting_date: string;
  description?: string | null;
  reference?: string | null;
  status: "draft" | "posted" | "reversed";
  reversal_entry_id?: string | null;
  created_at: string;
  lines?: JournalLine[];
  total_debit_ngn?: string;
}

export interface TrialBalanceRow {
  account_code: string;
  account_name: string;
  group_type: string;
  debit_ngn: string;
  credit_ngn: string;
}
export interface TrialBalance {
  as_of: string;
  accounts: TrialBalanceRow[];
  total_debit_ngn: string;
  total_credit_ngn: string;
  balanced: boolean;
}

export interface PnlItem {
  account_code: string;
  account_name: string;
  amount_ngn: string;
}
export interface ProfitAndLoss {
  period: { from?: string; to?: string };
  revenue: PnlItem[];
  total_revenue_ngn: string;
  expenses: PnlItem[];
  total_expenses_ngn: string;
  net_profit_ngn: string;
}

export interface BalanceSheet {
  as_of: string;
  assets: PnlItem[];
  total_assets_ngn: string;
  liabilities: PnlItem[];
  total_liabilities_ngn: string;
  equity: PnlItem[];
  total_equity_ngn: string;
  balanced: boolean;
}

export interface CashFlowBucket {
  lines: { source_type: string; amount_ngn: string }[];
  total_ngn: string;
}
export interface CashFlow {
  period: { from: string | null; to: string | null };
  operating: CashFlowBucket;
  investing: CashFlowBucket;
  financing: CashFlowBucket;
  net_change_ngn: string;
  opening_cash_ngn: string;
  closing_cash_ngn: string;
  reconciled: boolean;
}

export interface AgeingParty {
  party_id: string;
  party_name: string;
  total_ngn: string;
  current_0_30_ngn: string;
  days_31_60_ngn: string;
  days_61_90_ngn: string;
  days_90_plus_ngn: string;
}
export interface Ageing {
  as_of: string;
  parties: AgeingParty[];
  totals: {
    current_0_30_ngn: string;
    days_31_60_ngn: string;
    days_61_90_ngn: string;
    days_90_plus_ngn: string;
    total_ngn: string;
  };
}

export type TaxType = "VAT" | "PAYE" | "WHT" | "CIT" | "EDT" | "other";
export type FilingStatus =
  | "draft"
  | "reviewed"
  | "filed"
  | "paid"
  | "overdue"
  | "disputed"
  | "closed";

export interface TaxFiling {
  filing_id: string;
  filing_number: string;
  tax_type: TaxType;
  fiscal_period_id: string;
  taxable_amount_ngn: string;
  tax_amount_ngn: string;
  status: FilingStatus;
  due_date: string;
  filed_at?: string | null;
  filing_reference?: string | null;
  paid_at?: string | null;
  payment_reference?: string | null;
  notes?: string | null;
}

export interface TaxComputationLine {
  entry_number: string;
  posting_date: string;
  source_type: string;
  reference?: string | null;
  entry_description?: string | null;
  account_code: string;
  debit_ngn: string;
  credit_ngn: string;
  line_description?: string | null;
}
export interface TaxComputation {
  tax_type: TaxType;
  period: { period_id: string; period_name: string; from: string; to: string };
  output_vat_ngn?: string;
  input_vat_ngn?: string;
  tax_amount_ngn: string;
  taxable_amount_ngn: string;
  due_date: string;
  lines: TaxComputationLine[];
}

export interface BankStatement {
  statement_id: string;
  bank_account_id: string;
  source?: string;
  statement_date?: string;
  opening_balance_ngn?: string;
  closing_balance_ngn?: string;
  status: string;
  created_at?: string;
}

export interface BankReconciliation {
  reconciliation_id: string;
  reconciliation_number: string;
  bank_account_id: string;
  statement_id?: string | null;
  book_balance_ngn: string;
  statement_balance_ngn: string;
  reconciled_balance_ngn?: string;
  variance_ngn?: string;
  status: string;
  reconciled_at?: string | null;
}

export interface ManualJournalLineInput {
  account_code: string;
  debit_ngn?: number;
  credit_ngn?: number;
  description?: string;
}
export interface ManualJournalInput {
  description: string;
  reference?: string;
  posting_date?: string;
  lines: ManualJournalLineInput[];
}
