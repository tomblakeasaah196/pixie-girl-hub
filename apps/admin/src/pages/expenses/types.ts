// Expenses module types (independent from Cash Requests).

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

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    page_size: number;
    total: number;
    has_more: boolean;
  };
}
