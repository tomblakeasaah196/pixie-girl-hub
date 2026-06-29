import { api } from "@/lib/api";
import type {
  Expense,
  ExpenseCategory,
  ExpenseKpis,
  PaginatedResponse,
} from "./types";

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

// The backend stores the label as `display_name`; the rest of the UI reads
// `category_display`. Normalise here so callers get a consistent shape.
type RawCategory = Partial<ExpenseCategory> & {
  category_id: string;
  category_key: string;
  display_name?: string;
  is_active: boolean;
};

export async function listExpenseCategories(): Promise<ExpenseCategory[]> {
  const rows = await api.get<RawCategory[]>(`${EX}/categories`);
  return rows.map((c) => ({
    category_id: c.category_id,
    category_key: c.category_key,
    category_display: c.category_display ?? c.display_name ?? c.category_key,
    default_account_id: c.default_account_id ?? null,
    is_active: c.is_active,
  }));
}

export interface CreateCategoryInput {
  category_key: string;
  display_name: string;
  description?: string;
}

export function createExpenseCategory(input: CreateCategoryInput) {
  return api.post<ExpenseCategory>(`${EX}/categories`, input);
}

/** Optional receipt attached to an existing expense (multipart, field "file"). */
export function uploadExpenseReceipt(id: string, file: File) {
  const fd = new FormData();
  fd.append("file", file);
  return api.postForm<unknown>(`${EX}/${id}/receipts`, fd);
}

export interface ExpenseLineInput {
  category_id: string;
  description: string;
  amount_ngn: number;
  vat_amount_ngn?: number;
  vendor_name?: string;
  receipt_date?: string;
}
export interface CreateExpenseInput {
  title: string;
  expense_date: string;
  expense_type?: string;
  description?: string;
  lines: ExpenseLineInput[];
}

export function createExpense(input: CreateExpenseInput) {
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
