import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { useBusinessStore } from "@/stores/business";
import * as invoicingApi from "./api";
import type {
  InvoiceCreateInput,
  InvoiceSendInput,
  PaymentApplyInput,
  CreditNoteCreateInput,
  ReceiptIssueInput,
} from "./types";

function useBiz() {
  return useBusinessStore((s) => s.activeKey);
}

// ── Invoices ────────────────────────────────────────────────

export function useInvoices(params: invoicingApi.InvoiceListParams = {}) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["invoices", biz, params],
    queryFn: () => invoicingApi.listInvoices(params),
    placeholderData: keepPreviousData,
  });
}

export function useInvoice(id: string | null) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["invoices", biz, "detail", id],
    queryFn: () => invoicingApi.getInvoice(id!),
    enabled: !!id,
  });
}

export function useCreateInvoice() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (input: InvoiceCreateInput) =>
      invoicingApi.createInvoice(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices", biz] }),
  });
}

export function useInvoicePdf(id: string) {
  return useMutation({
    mutationFn: () => invoicingApi.invoicePdf(id),
  });
}

export function useSendInvoice(id: string) {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (input: InvoiceSendInput = {}) =>
      invoicingApi.sendInvoice(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices", biz, "detail", id] });
      qc.invalidateQueries({ queryKey: ["invoices", biz] });
    },
  });
}

export function useRecordPayment(id: string) {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (input: PaymentApplyInput) =>
      invoicingApi.recordPayment(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices", biz, "detail", id] });
      qc.invalidateQueries({ queryKey: ["invoices", biz] });
      qc.invalidateQueries({ queryKey: ["ar-ageing", biz] });
    },
  });
}

export function useVoidInvoice() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (id: string) => invoicingApi.voidInvoice(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["invoices", biz, "detail", id] });
      qc.invalidateQueries({ queryKey: ["invoices", biz] });
      qc.invalidateQueries({ queryKey: ["ar-ageing", biz] });
    },
  });
}

export function useInvoiceReceipts(invoiceId: string | null) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["invoices", biz, "receipts", invoiceId],
    queryFn: () => invoicingApi.listInvoiceReceipts(invoiceId!),
    enabled: !!invoiceId,
  });
}

export function useInvoiceReminders(invoiceId: string | null) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["invoices", biz, "reminders", invoiceId],
    queryFn: () => invoicingApi.listReminders(invoiceId!),
    enabled: !!invoiceId,
  });
}

export function useCancelReminder(invoiceId: string) {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (reminderId: string) =>
      invoicingApi.cancelReminder(invoiceId, reminderId),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["invoices", biz, "reminders", invoiceId],
      }),
  });
}

// ── Credit notes ────────────────────────────────────────────

export function useCreditNotes(
  params: invoicingApi.CreditNoteListParams = {},
) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["credit-notes", biz, params],
    queryFn: () => invoicingApi.listCreditNotes(params),
    placeholderData: keepPreviousData,
  });
}

export function useCreditNote(id: string | null) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["credit-notes", biz, "detail", id],
    queryFn: () => invoicingApi.getCreditNote(id!),
    enabled: !!id,
  });
}

export function useCreateCreditNote() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (input: CreditNoteCreateInput) =>
      invoicingApi.createCreditNote(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["credit-notes", biz] }),
  });
}

export function useIssueCreditNote() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (id: string) => invoicingApi.issueCreditNote(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["credit-notes", biz, "detail", id] });
      qc.invalidateQueries({ queryKey: ["credit-notes", biz] });
      qc.invalidateQueries({ queryKey: ["invoices", biz] });
      qc.invalidateQueries({ queryKey: ["ar-ageing", biz] });
    },
  });
}

// ── Receipts ────────────────────────────────────────────────

export function useIssueReceipt() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (input: ReceiptIssueInput) => invoicingApi.issueReceipt(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices", biz] }),
  });
}

// ── AR ageing ───────────────────────────────────────────────

export function useArAgeing(as_of?: string) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["ar-ageing", biz, as_of],
    queryFn: () => invoicingApi.getArAgeing(as_of),
  });
}
