export type CashRequestStatus =
  | "draft"
  | "pending_finance"
  | "pending_ceo"
  | "approved"
  | "rejected"
  | "sent_back"
  | "disbursed"
  | "settled"
  | "cancelled";

export type RecipientType =
  | "self_bank"
  | "self_cash"
  | "third_party_bank"
  | "petty_cash"
  | "supplier_direct";

export type Urgency = "normal" | "urgent" | "critical";

export type Decision = "approve" | "reject" | "send_back";

export type MatchStatus =
  | "unmatched"
  | "matched"
  | "mismatch"
  | "manual_review"
  | "not_applicable";

export type DocumentRole =
  | "quote"
  | "pro_forma_invoice"
  | "screenshot"
  | "authorisation"
  | "bank_transfer_receipt"
  | "settlement_receipt"
  | "other";

export type SettlementEntryType =
  | "receipt"
  | "cash_returned"
  | "foreign_fx_adjustment";

export interface CashRequest {
  cash_request_id: string;
  business: string;
  request_number: string;
  submitted_by: string;
  submitted_at: string | null;
  category_key: string;
  category_display: string;
  purpose: string;
  needed_by_date: string | null;
  urgency: Urgency;
  amount_requested_ngn: string;
  currency_code: string;
  fx_rate_used: string | null;
  display_amount: string | null;
  recipient_type: RecipientType;
  recipient_name: string | null;
  recipient_bank_name: string | null;
  recipient_account_number: string | null;
  recipient_account_name: string | null;
  status: CashRequestStatus;
  finance_reviewed_by: string | null;
  finance_reviewed_at: string | null;
  finance_decision: Decision | null;
  finance_notes: string | null;
  requires_ceo_approval: boolean | null;
  ceo_threshold_at_submit_ngn: string | null;
  ceo_decided_by: string | null;
  ceo_decided_at: string | null;
  ceo_decision: Decision | null;
  ceo_notes: string | null;
  disbursed_by: string | null;
  disbursed_at: string | null;
  bank_transaction_id: string | null;
  bank_transaction_date: string | null;
  bank_name: string | null;
  amount_disbursed_ngn: string | null;
  disbursement_notes: string | null;
  match_status: MatchStatus;
  requires_settlement: boolean;
  settled_at: string | null;
  settlement_required_by: string | null;
  settled_total_receipts_ngn: string | null;
  unsettled_balance_ngn: string | null;
  linked_expense_id: string | null;
  linked_journal_entry_id: string | null;
  workflow_instance_id: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CashRequestDocument {
  cash_request_document_id: string;
  cash_request_id: string;
  document_id: string;
  document_role: DocumentRole;
  uploaded_by: string;
  uploaded_at: string;
  notes: string | null;
  filename?: string;
  mime_type?: string;
  file_size_bytes?: number;
}

export interface StateHistoryEntry {
  history_id: string;
  cash_request_id: string;
  from_status: CashRequestStatus | null;
  to_status: CashRequestStatus;
  changed_by: string | null;
  changed_by_name?: string;
  changed_at: string;
  notes: string | null;
  amount_snapshot_ngn: string | null;
  decision_snapshot: string | null;
  metadata: Record<string, unknown> | null;
}

export interface CashRequestKpis {
  pending_approval: number;
  approved_awaiting_disbursement: number;
  unsettled_advances: number;
  disbursed_this_month: number;
  pending_finance: number;
  pending_ceo: number;
  total: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  page_size: number;
  total: number;
}

// ── Expense types ────────────────────────────────────────

export type ExpenseStatus =
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "partially_paid"
  | "paid";

export type ExpenseType =
  | "reimbursement"
  | "petty_cash"
  | "direct_payment"
  | "direct_invoice"
  | "cash_advance_retirement";

export interface ExpenseCategory {
  category_id: string;
  category_key: string;
  category_display: string;
  default_account_id: string | null;
  is_active: boolean;
}

export interface Expense {
  expense_id: string;
  expense_number: string;
  expense_type: ExpenseType;
  category_key: string;
  category_display: string;
  title: string;
  description: string | null;
  expense_date: string;
  submitted_by: string;
  submitted_by_name?: string;
  total_amount_ngn: string;
  vat_amount_ngn: string | null;
  wht_amount_ngn: string | null;
  net_amount_ngn: string | null;
  amount_paid_ngn: string | null;
  balance_ngn: string | null;
  status: ExpenseStatus;
  approved_by: string | null;
  approved_at: string | null;
  journal_entry_id: string | null;
  vendor_name: string | null;
  vendor_contact_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpenseKpis {
  paid_this_month: number;
  pending_amount: number;
  pending_count: number;
  reimbursements_outstanding: number;
  top_category_this_month: string | null;
  spend_by_category: { category: string; total: number }[];
}
