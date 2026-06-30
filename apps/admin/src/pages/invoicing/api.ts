import { api } from "@/lib/api";
import type {
  Invoice,
  InvoiceCreateInput,
  InvoiceSendInput,
  PaymentApplyInput,
  CreditNote,
  CreditNoteCreateInput,
  Receipt,
  ReceiptIssueInput,
  InvoiceReminder,
  InvoiceDelivery,
  ReceiptDelivery,
  ArAgeingReport,
  PaginatedResponse,
} from "./types";

const S = "/invoicing";
const ACC = "/accounting";

function qs(params: Record<string, unknown>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "" && v !== null) q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

// ── Invoices ────────────────────────────────────────────────

export interface InvoiceListParams {
  status?: string;
  contact_id?: string;
  order_id?: string;
  overdue?: boolean;
  search?: string;
  page?: number;
  page_size?: number;
}

export const listInvoices = ({ ...rest }: InvoiceListParams = {}) =>
  api.get<PaginatedResponse<Invoice>>(`${S}/invoices${qs(rest)}`);

export const getInvoice = (id: string) =>
  api.get<Invoice>(`${S}/invoices/${id}`);

export const createInvoice = (input: InvoiceCreateInput) =>
  api.post<Invoice>(`${S}/invoices`, input);

export const invoicePdf = (id: string) =>
  api.post<{ url: string }>(`${S}/invoices/${id}/pdf`);

export const sendInvoice = (id: string, input: InvoiceSendInput = {}) =>
  api.post<Invoice>(`${S}/invoices/${id}/send`, input);

export const recordPayment = (id: string, input: PaymentApplyInput) =>
  api.post<Invoice>(`${S}/invoices/${id}/payments`, input);

export const voidInvoice = (id: string) =>
  api.post<Invoice>(`${S}/invoices/${id}/void`);

export const listInvoiceReceipts = (id: string) =>
  api.get<Receipt[]>(`${S}/invoices/${id}/receipts`);

export const getInvoiceDelivery = (id: string) =>
  api.get<InvoiceDelivery>(`${S}/invoices/${id}/delivery`);

// ── Credit notes ────────────────────────────────────────────

export interface CreditNoteListParams {
  status?: string;
  invoice_id?: string;
  page?: number;
  page_size?: number;
}

export const listCreditNotes = ({ ...rest }: CreditNoteListParams = {}) =>
  api.get<PaginatedResponse<CreditNote>>(`${S}/credit-notes${qs(rest)}`);

export const getCreditNote = (id: string) =>
  api.get<CreditNote>(`${S}/credit-notes/${id}`);

export const createCreditNote = (input: CreditNoteCreateInput) =>
  api.post<CreditNote>(`${S}/credit-notes`, input);

export const issueCreditNote = (id: string) =>
  api.post<CreditNote>(`${S}/credit-notes/${id}/issue`);

// ── Receipts ────────────────────────────────────────────────

export const issueReceipt = (input: ReceiptIssueInput) =>
  api.post<Receipt>(`${S}/receipts`, input);

export const sendReceipt = (
  id: string,
  input: { sent_via?: string } = {},
) => api.post<Receipt>(`${S}/receipts/${id}/send`, input);

export const getReceiptDelivery = (id: string) =>
  api.get<ReceiptDelivery>(`${S}/receipts/${id}/delivery`);

// ── Reminders ───────────────────────────────────────────────

export const listReminders = (invoiceId: string) =>
  api.get<InvoiceReminder[]>(`${S}/invoices/${invoiceId}/reminders`);

export const cancelReminder = (invoiceId: string, reminderId: string) =>
  api.delete<InvoiceReminder>(
    `${S}/invoices/${invoiceId}/reminders/${reminderId}`,
  );

// ── AR ageing (accounting module) ──────────────────────────

export const getArAgeing = (as_of?: string) =>
  api.get<ArAgeingReport>(`${ACC}/reports/ar-ageing${qs({ as_of })}`);

// ── Contact search (reused contact picker) ─────────────────

export const searchContacts = (search: string) =>
  api.get<
    PaginatedResponse<{
      contact_id: string;
      display_name: string;
      email: string | null;
      primary_phone: string | null;
    }>
  >(`/contacts${qs({ q: search, page_size: 6 })}`);
