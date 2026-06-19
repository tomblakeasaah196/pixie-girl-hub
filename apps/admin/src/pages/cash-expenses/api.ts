import { api } from "@/lib/api";
import type {
  CashRequest,
  CashRequestDocument,
  CashRequestKpis,
  StateHistoryEntry,
  PaginatedResponse,
  Decision,
  DocumentRole,
  Expense,
  ExpenseCategory,
  ExpenseKpis,
} from "./types";

// ── Cash Requests ────────────────────────────────────────

const CR = "/cash-request";

export function listCashRequests(params: {
  status?: string;
  page?: number;
  page_size?: number;
}) {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.page) qs.set("page", String(params.page));
  if (params.page_size) qs.set("page_size", String(params.page_size));
  const q = qs.toString();
  return api.get<PaginatedResponse<CashRequest>>(`${CR}${q ? `?${q}` : ""}`);
}

export function getCashRequest(id: string) {
  return api.get<CashRequest>(`${CR}/${id}`);
}

export function getCashRequestKpis() {
  return api.get<CashRequestKpis>(`${CR}/kpis/summary`);
}

export function createCashRequest(input: {
  category_key: string;
  category_display: string;
  purpose: string;
  needed_by_date?: string;
  urgency?: string;
  amount_requested_ngn: number;
  currency_code?: string;
  fx_rate_used?: number;
  display_amount?: number;
  recipient_type: string;
  recipient_name?: string;
  recipient_bank_name?: string;
  recipient_account_number?: string;
  recipient_account_name?: string;
  requires_settlement?: boolean;
  settlement_required_by?: string;
}) {
  return api.post<CashRequest>(CR, input);
}

export function submitCashRequest(id: string) {
  return api.post<CashRequest>(`${CR}/${id}/submit`);
}

export function financeDecision(
  id: string,
  decision: Decision,
  notes?: string,
) {
  return api.post<CashRequest>(`${CR}/${id}/finance-decision`, {
    decision,
    notes,
  });
}

export function ceoDecision(id: string, decision: Decision, notes?: string) {
  return api.post<CashRequest>(`${CR}/${id}/ceo-decision`, { decision, notes });
}

export function disburseCashRequest(
  id: string,
  input: {
    bank_transaction_id: string;
    bank_transaction_date?: string;
    bank_name?: string;
    amount_disbursed_ngn?: number;
    disbursement_notes?: string;
  },
) {
  return api.post<CashRequest>(`${CR}/${id}/disburse`, input);
}

export function settleCashRequest(
  id: string,
  input: { settled_total_receipts_ngn: number; notes?: string },
) {
  return api.post<CashRequest>(`${CR}/${id}/settle`, input);
}

export function cancelCashRequest(id: string, reason?: string) {
  return api.post<CashRequest>(`${CR}/${id}/cancel`, { reason });
}

export function listCashRequestDocuments(id: string) {
  return api.get<CashRequestDocument[]>(`${CR}/${id}/documents`);
}

export function addCashRequestDocument(
  id: string,
  input: { document_id: string; document_role?: DocumentRole; notes?: string },
) {
  return api.post<CashRequestDocument>(`${CR}/${id}/documents`, input);
}

export function getCashRequestHistory(id: string) {
  return api.get<StateHistoryEntry[]>(`${CR}/${id}/history`);
}

// ── Expenses ─────────────────────────────────────────────

const EX = "/expenses";

export function listExpenses(params: {
  status?: string;
  page?: number;
  page_size?: number;
}) {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.page) qs.set("page", String(params.page));
  if (params.page_size) qs.set("page_size", String(params.page_size));
  const q = qs.toString();
  return api.get<PaginatedResponse<Expense>>(`${EX}${q ? `?${q}` : ""}`);
}

export function getExpense(id: string) {
  return api.get<Expense>(`${EX}/${id}`);
}

export function getExpenseKpis() {
  return api.get<ExpenseKpis>(`${EX}/kpis`);
}

export function listExpenseCategories() {
  return api.get<ExpenseCategory[]>(`${EX}/categories`);
}

export function createExpense(input: {
  category_key: string;
  expense_type: string;
  amount_ngn: number;
  description: string;
  expense_date: string;
  vendor_name?: string;
  lines: { amount_ngn: number; description?: string; account_id?: string }[];
}) {
  return api.post<Expense>(EX, input);
}

export function submitExpense(id: string) {
  return api.post<Expense>(`${EX}/${id}/submit`);
}

export function approveExpense(id: string) {
  return api.post<Expense>(`${EX}/${id}/approve`);
}

export function rejectExpense(id: string, reason: string) {
  return api.post<Expense>(`${EX}/${id}/reject`, { reason });
}
