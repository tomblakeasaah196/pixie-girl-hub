import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { useBusinessStore } from "@/stores/business";
import * as salesApi from "./api";
import type {
  OrderCreateInput,
  PaymentCreateInput,
  PaymentLinkInput,
  QuotationCreateInput,
  QuotationSendInput,
  QuotationConvertInput,
  QuotationAcceptInput,
  CancellationRequestInput,
  FlexiPaySettingsPatch,
  AmendmentInput,
  AmendmentPreviewInput,
} from "./types";

function useBiz() {
  return useBusinessStore((s) => s.activeKey);
}

// ── Orders ──────────────────────────────────────────────────

export function useOrders(params: salesApi.OrderListParams = {}) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["sales-orders", biz, params],
    queryFn: () => salesApi.listOrders(params),
    placeholderData: keepPreviousData,
  });
}

export function useOrder(id: string | null) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["sales-orders", biz, "detail", id],
    queryFn: () => salesApi.getOrder(id!),
    enabled: !!id,
  });
}

/**
 * Watch an order's payment state at the counter. Polls every 3s while the
 * balance is still outstanding, then stops the moment the gateway webhook
 * clears it — so the cashier's screen flips to "Paid" on its own without any
 * manual (and pocketable) payment entry.
 */
export function useOrderPaymentWatch(id: string | null) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["sales-orders", biz, "detail", id],
    queryFn: () => salesApi.getOrder(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      const o = query.state.data;
      if (!o) return 3000;
      const paid =
        Number(o.balance_due_ngn) <= 0 ||
        !["draft", "pending_payment"].includes(o.status);
      return paid ? false : 3000;
    },
  });
}

export function useCreateOrder() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (input: OrderCreateInput) => salesApi.createOrder(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales-orders", biz] });
      qc.invalidateQueries({ queryKey: ["sales-kpis", biz] });
    },
  });
}

export function useAddPayment(orderId: string) {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (input: PaymentCreateInput) =>
      salesApi.addPayment(orderId, input),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["sales-orders", biz, "detail", orderId],
      });
      qc.invalidateQueries({ queryKey: ["sales-orders", biz] });
      qc.invalidateQueries({ queryKey: ["sales-kpis", biz] });
      // The payment lands on the order's invoice in the same commit — refresh
      // Invoicing too, so the two screens never disagree on the balance.
      qc.invalidateQueries({ queryKey: ["invoices", biz] });
      qc.invalidateQueries({ queryKey: ["ar-ageing", biz] });
    },
  });
}

export function useCreatePaymentLink(orderId: string) {
  return useMutation({
    mutationFn: (input: PaymentLinkInput = {}) =>
      salesApi.createPaymentLink(orderId, input),
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (id: string) => salesApi.cancelOrder(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["sales-orders", biz] });
      qc.invalidateQueries({ queryKey: ["sales-orders", biz, "detail", id] });
      qc.invalidateQueries({ queryKey: ["sales-kpis", biz] });
    },
  });
}

/**
 * Un-cancel an archived order. Call with `confirm: false` first — if the result
 * has `requires_confirmation`, show its `short_lines` warning and call again
 * with `confirm: true` to restore those lines as pre-orders.
 */
export function useRestoreOrder() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: ({ id, confirm }: { id: string; confirm: boolean }) =>
      salesApi.restoreOrder(id, confirm),
    onSuccess: (data, { id }) => {
      // A dry run changed nothing — don't churn the caches for it.
      if (data.requires_confirmation) return;
      qc.invalidateQueries({ queryKey: ["sales-orders", biz] });
      qc.invalidateQueries({ queryKey: ["sales-orders", biz, "detail", id] });
      qc.invalidateQueries({ queryKey: ["sales-kpis", biz] });
    },
  });
}

// ── Change Order (§6.2 amendments) ──────────────────────────

/** Every change made to this order, newest first — the history card. */
export function useOrderAmendments(orderId: string | null) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["sales-orders", biz, "amendments", orderId],
    queryFn: async () => {
      const res = await salesApi.listAmendments(orderId!);
      return res.data ?? [];
    },
    enabled: !!orderId,
  });
}

/** Dry run. A mutation rather than a query: the modal drives it explicitly as
 *  the operator edits, and it must never be cached or refetched behind them. */
export function usePreviewAmendment(orderId: string | null) {
  return useMutation({
    mutationFn: (input: AmendmentPreviewInput) =>
      salesApi.previewAmendment(orderId!, input),
  });
}

/**
 * Commit the change. An amendment reaches into stock, the GL, the invoice,
 * Stylist Studio and Logistics in one transaction, so the invalidation sweep
 * has to be just as wide — anything narrower leaves one of those screens
 * showing the pre-change order.
 */
export function useAmendOrder(orderId: string | null) {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (input: AmendmentInput) => salesApi.amendOrder(orderId!, input),
    onSuccess: (data) => {
      // The dry run wrote nothing — don't churn the caches for it.
      if (data.requires_confirmation) return;
      qc.invalidateQueries({ queryKey: ["sales-orders", biz] });
      qc.invalidateQueries({ queryKey: ["sales-kpis", biz] });
      qc.invalidateQueries({ queryKey: ["invoices", biz] });
      qc.invalidateQueries({ queryKey: ["ar-ageing", biz] });
      qc.invalidateQueries({ queryKey: ["service-jobs", biz] });
      qc.invalidateQueries({ queryKey: ["deliveries", biz] });
      qc.invalidateQueries({ queryKey: ["stock", biz] });
    },
  });
}

export function useSetOrderStatus() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      salesApi.setOrderStatus(id, status),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ["sales-orders", biz] });
      qc.invalidateQueries({ queryKey: ["sales-orders", biz, "detail", id] });
      qc.invalidateQueries({ queryKey: ["sales-kpis", biz] });
    },
  });
}

/**
 * Live on/off state of the customer messages a manual status move fires, so
 * the drawer's impact modal can show a definite "will send"/"won't send".
 * Brand-scoped and cached (5-min staleTime) — the CEO's Messaging toggles
 * change rarely, so opening the modal repeatedly reuses one fetch rather than
 * hitting the API per open. Gate on `enabled` so it only loads while a drawer
 * is actually open.
 */
export function useStatusAutomations(enabled = true) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["sales-status-automations", biz],
    queryFn: salesApi.getStatusAutomations,
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function useOrderTimeline(orderId: string | null) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["sales-orders", biz, "timeline", orderId],
    queryFn: () => salesApi.getOrderTimeline(orderId!),
    enabled: !!orderId,
  });
}

export function useOrderInvoice(orderId: string | null) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["sales-orders", biz, "invoice", orderId],
    queryFn: async () => {
      const res = await salesApi.getOrderInvoice(orderId!);
      return res.data?.[0] ?? null;
    },
    enabled: !!orderId,
  });
}

/** The Stylist Studio job opened for this order (null while none exists). */
export function useOrderServiceJob(orderId: string | null) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["sales-orders", biz, "service-job", orderId],
    queryFn: async () => {
      const res = await salesApi.getOrderServiceJob(orderId!);
      return res.data?.[0] ?? null;
    },
    enabled: !!orderId,
  });
}

/** The logistics delivery opened for this order (null when not dispatched). */
export function useOrderDelivery(orderId: string | null) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["sales-orders", biz, "delivery", orderId],
    queryFn: async () => {
      const res = await salesApi.getOrderDelivery(orderId!);
      return res.data?.[0] ?? null;
    },
    enabled: !!orderId,
  });
}

/**
 * The customer's recent orders (excluding the one on screen). Powers the
 * "N orders · ₦LTV" strip on OrderDetail. contactId comes from the loaded
 * order, so gate on it.
 */
export function useContactRecentOrders(
  contactId: string | null,
  excludeOrderId?: string | null,
) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["sales-orders", biz, "by-contact", contactId],
    queryFn: async () => {
      const res = await salesApi.getContactRecentOrders(contactId!, 12);
      const all = res.data ?? [];
      const others = excludeOrderId
        ? all.filter((o) => o.order_id !== excludeOrderId)
        : all;
      return {
        orders: others.slice(0, 5),
        total: res.meta?.total ?? all.length,
      };
    },
    enabled: !!contactId,
  });
}

/** Reminders + sends for this order's invoice (powers the Comms log). */
export function useInvoiceReminders(invoiceId: string | null) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["invoicing", biz, "reminders", invoiceId],
    queryFn: async () => {
      const res = await salesApi.getInvoiceReminders(invoiceId!);
      return res.data ?? [];
    },
    enabled: !!invoiceId,
  });
}

/** Send / resend the order's invoice to the customer (email / WhatsApp). */
export function useSendOrderInvoice(orderId: string | null) {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: ({
      invoiceId,
      sent_via,
    }: {
      invoiceId: string;
      sent_via?: string;
    }) => salesApi.sendOrderInvoice(invoiceId, { sent_via }),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["sales-orders", biz, "invoice", orderId],
      });
      qc.invalidateQueries({ queryKey: ["invoices", biz] });
    },
  });
}

// ── Quotations ──────────────────────────────────────────────

export function useQuotations(params: salesApi.QuoteListParams = {}) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["sales-quotations", biz, params],
    queryFn: () => salesApi.listQuotations(params),
    placeholderData: keepPreviousData,
  });
}

export function useQuotation(id: string | null) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["sales-quotations", biz, "detail", id],
    queryFn: () => salesApi.getQuotation(id!),
    enabled: !!id,
  });
}

export function useCreateQuotation() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (input: QuotationCreateInput) =>
      salesApi.createQuotation(input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["sales-quotations", biz] }),
  });
}

export function useSendQuotation() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: QuotationSendInput }) =>
      salesApi.sendQuotation(id, input),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ["sales-quotations", biz] });
      qc.invalidateQueries({
        queryKey: ["sales-quotations", biz, "detail", id],
      });
    },
  });
}

export function useAcceptQuotation() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input?: QuotationAcceptInput }) =>
      salesApi.acceptQuotation(id, input),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ["sales-quotations", biz] });
      qc.invalidateQueries({
        queryKey: ["sales-quotations", biz, "detail", id],
      });
      // Accept-and-convert mints an order, so the orders list is stale too.
      qc.invalidateQueries({ queryKey: ["sales-orders", biz] });
    },
  });
}

/**
 * The quote's customer-facing pay link. Fetched on demand (when staff open the
 * share control) rather than with the quote, because the GET mints the token as
 * a side effect — we don't want every quote that's merely viewed to acquire a
 * public link.
 */
export function useQuotationPayLink(id: string | null, enabled: boolean) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["sales-quotations", biz, "pay-link", id],
    queryFn: () => salesApi.getQuotationPayLink(id!),
    enabled: !!id && enabled,
    staleTime: Infinity,
  });
}

export function useConvertQuotation() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: QuotationConvertInput }) =>
      salesApi.convertQuotation(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales-quotations", biz] });
      qc.invalidateQueries({ queryKey: ["sales-orders", biz] });
    },
  });
}

// ── Cancellations ───────────────────────────────────────────

export function useRequestCancellation() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: ({
      orderId,
      input,
    }: {
      orderId: string;
      input: CancellationRequestInput;
    }) => salesApi.requestCancellation(orderId, input),
    onSuccess: (_data, { orderId }) => {
      qc.invalidateQueries({ queryKey: ["sales-orders", biz] });
      qc.invalidateQueries({
        queryKey: ["sales-orders", biz, "detail", orderId],
      });
    },
  });
}

// ── Delivery pending orders ──────────────────────────────────

export function useDeliveryPendingOrders(
  params: salesApi.OrderListParams = {},
) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["sales-orders-fee-pending", biz, params],
    queryFn: () => salesApi.listDeliveryPendingOrders(params),
    placeholderData: keepPreviousData,
  });
}

export function useSetOrderDeliveryFee() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: ({ id, fee_ngn }: { id: string; fee_ngn: number }) =>
      salesApi.setOrderDeliveryFee(id, fee_ngn),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales-orders-fee-pending", biz] });
      qc.invalidateQueries({ queryKey: ["sales-orders", biz] });
      qc.invalidateQueries({ queryKey: ["sales-kpis", biz] });
    },
  });
}

// ── KPIs ────────────────────────────────────────────────────

export function useSalesKpis() {
  const biz = useBiz();
  return useQuery({
    queryKey: ["sales-kpis", biz],
    queryFn: salesApi.getSalesKpis,
    staleTime: 30_000,
  });
}

// ── Flexi Pay settings (Sales → Payments tab) ───────────────

export function usePaymentSettings() {
  const biz = useBiz();
  return useQuery({
    queryKey: ["sales-payment-settings", biz],
    queryFn: salesApi.getPaymentSettings,
    staleTime: 60_000,
  });
}

export function useSavePaymentSettings() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (patch: FlexiPaySettingsPatch) =>
      salesApi.updatePaymentSettings(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales-payment-settings", biz] });
    },
  });
}

// ── POS Reconciliation ──────────────────────────────────────

const POS_RECON_KEY = "pos-reconciliation";
const POS_RECON_UNRESOLVED_KEY = "pos-reconciliation-unresolved";

/** The active brand's own pending queue. 30s poll — this is real customer
 *  money sitting unclaimed, so the list should feel current without staff
 *  needing to manually refresh (decision 6B extends to the list, not just
 *  the notification). */
export function usePosReconciliation(params: salesApi.PosReconListParams = {}) {
  const biz = useBiz();
  return useQuery({
    queryKey: [POS_RECON_KEY, biz, params],
    queryFn: () => salesApi.listPosReconciliation(params),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
}

/** Cross-brand queue for payments whose terminal brand isn't known yet.
 *  `enabled` should be the caller's CEO check — the backend 403s otherwise. */
export function usePosReconciliationUnresolved(
  enabled: boolean,
  params: salesApi.PosReconListParams = {},
) {
  return useQuery({
    queryKey: [POS_RECON_UNRESOLVED_KEY, params],
    queryFn: () => salesApi.listPosReconciliationUnresolved(params),
    placeholderData: keepPreviousData,
    enabled,
    refetchInterval: 30_000,
  });
}

export function usePosReconciliationSuggestions(
  id: string | null,
  brand?: string,
) {
  return useQuery({
    queryKey: [POS_RECON_KEY, "suggestions", id, brand],
    queryFn: () => salesApi.getPosReconciliationSuggestions(id!, brand),
    enabled: !!id,
  });
}

export function useMatchPosReconciliation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: { brand: string; order_id: string };
    }) => salesApi.matchPosReconciliation(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [POS_RECON_KEY] });
      qc.invalidateQueries({ queryKey: [POS_RECON_UNRESOLVED_KEY] });
      qc.invalidateQueries({ queryKey: ["sales-orders"] });
    },
  });
}

export function useIgnorePosReconciliation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      salesApi.ignorePosReconciliation(id, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [POS_RECON_KEY] });
      qc.invalidateQueries({ queryKey: [POS_RECON_UNRESOLVED_KEY] });
    },
  });
}

/** Manual-search fallback (decision 1A) for when nothing in the smart
 *  suggestions matches — debounced by the caller. */
export function usePosReconcilableOrderSearch(search: string) {
  return useQuery({
    queryKey: [POS_RECON_KEY, "order-search", search],
    queryFn: () => salesApi.searchPosReconcilableOrders(search),
    enabled: search.trim().length > 1,
    placeholderData: keepPreviousData,
  });
}
