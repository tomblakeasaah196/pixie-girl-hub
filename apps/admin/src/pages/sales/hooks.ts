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
  CancellationRequestInput,
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
      qc.invalidateQueries({ queryKey: ["sales-quotations", biz, "detail", id] });
    },
  });
}

export function useAcceptQuotation() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (id: string) => salesApi.acceptQuotation(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["sales-quotations", biz] });
      qc.invalidateQueries({ queryKey: ["sales-quotations", biz, "detail", id] });
    },
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
      qc.invalidateQueries({ queryKey: ["sales-orders", biz, "detail", orderId] });
    },
  });
}

// ── Delivery pending orders ──────────────────────────────────

export function useDeliveryPendingOrders(params: salesApi.OrderListParams = {}) {
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
