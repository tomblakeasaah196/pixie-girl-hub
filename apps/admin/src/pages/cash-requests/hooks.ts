import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBusinessStore } from "@/stores/business";
import { toast } from "@/stores/toast";
import * as cashApi from "./api";
import type { Decision, DocumentRole } from "./types";

function useBrand() {
  return useBusinessStore((s) => s.activeKey);
}

/** Server error message (ApiError.message) or a safe fallback. */
function errText(e: unknown): string {
  return e instanceof Error && e.message
    ? e.message
    : "Something went wrong. Please try again.";
}

/** Toast a failed write so it never looks like "nothing happened". */
const onWriteError = (action: string) => (e: unknown) =>
  toast.error(`Couldn't ${action}`, {
    description: errText(e),
    report: { area: "Cash Requests", action, message: errText(e) },
  });

export function useCashRequests(filters: { status?: string; page?: number }) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["cash-requests", brand, filters],
    queryFn: () => cashApi.listCashRequests(filters),
    refetchInterval: 30_000,
  });
}

export function useCashRequest(id: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["cash-request", brand, id],
    queryFn: () => cashApi.getCashRequest(id!),
    enabled: !!id,
  });
}

export function useCashRequestKpis() {
  const brand = useBrand();
  return useQuery({
    queryKey: ["cash-request-kpis", brand],
    queryFn: () => cashApi.getCashRequestKpis(),
    refetchInterval: 60_000,
  });
}

export function useCashRequestHistory(id: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["cash-request-history", brand, id],
    queryFn: () => cashApi.getCashRequestHistory(id!),
    enabled: !!id,
  });
}

export function useCashRequestDocuments(id: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["cash-request-docs", brand, id],
    queryFn: () => cashApi.listCashRequestDocuments(id!),
    enabled: !!id,
  });
}

export function useCashRequestMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["cash-requests"] });
    qc.invalidateQueries({ queryKey: ["cash-request"] });
    qc.invalidateQueries({ queryKey: ["cash-request-kpis"] });
    qc.invalidateQueries({ queryKey: ["cash-request-history"] });
  };

  const create = useMutation({
    mutationFn: cashApi.createCashRequest,
    onSuccess: invalidate,
    onError: onWriteError("create the request"),
  });

  const submit = useMutation({
    mutationFn: (id: string) => cashApi.submitCashRequest(id),
    onSuccess: invalidate,
    onError: onWriteError("submit the request"),
  });

  const finance = useMutation({
    mutationFn: (v: { id: string; decision: Decision; notes?: string }) =>
      cashApi.financeDecision(v.id, v.decision, v.notes),
    onSuccess: invalidate,
    onError: onWriteError("record the decision"),
  });

  const ceo = useMutation({
    mutationFn: (v: { id: string; decision: Decision; notes?: string }) =>
      cashApi.ceoDecision(v.id, v.decision, v.notes),
    onSuccess: invalidate,
    onError: onWriteError("record the decision"),
  });

  const disburse = useMutation({
    mutationFn: (v: {
      id: string;
      input: Parameters<typeof cashApi.disburseCashRequest>[1];
    }) => cashApi.disburseCashRequest(v.id, v.input),
    onSuccess: () => {
      invalidate();
      toast.success("Disbursed");
    },
    onError: onWriteError("disburse"),
  });

  const settle = useMutation({
    mutationFn: (v: {
      id: string;
      input: Parameters<typeof cashApi.settleCashRequest>[1];
    }) => cashApi.settleCashRequest(v.id, v.input),
    onSuccess: invalidate,
    onError: onWriteError("settle the advance"),
  });

  const cancel = useMutation({
    mutationFn: (v: { id: string; reason?: string }) =>
      cashApi.cancelCashRequest(v.id, v.reason),
    onSuccess: invalidate,
    onError: onWriteError("cancel the request"),
  });

  const addDocument = useMutation({
    mutationFn: (v: {
      id: string;
      document_id: string;
      document_role?: DocumentRole;
      notes?: string;
    }) => cashApi.addCashRequestDocument(v.id, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cash-request-docs"] }),
  });

  return {
    create,
    submit,
    finance,
    ceo,
    disburse,
    settle,
    cancel,
    addDocument,
  };
}
