import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBusinessStore } from "@/stores/business";
import * as cashApi from "./api";
import type { Decision, DocumentRole } from "./types";

function useBrand() {
  return useBusinessStore((s) => s.activeKey);
}

// ── Cash Requests ────────────────────────────────────────

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
  });

  const submit = useMutation({
    mutationFn: (id: string) => cashApi.submitCashRequest(id),
    onSuccess: invalidate,
  });

  const finance = useMutation({
    mutationFn: (v: { id: string; decision: Decision; notes?: string }) =>
      cashApi.financeDecision(v.id, v.decision, v.notes),
    onSuccess: invalidate,
  });

  const ceo = useMutation({
    mutationFn: (v: { id: string; decision: Decision; notes?: string }) =>
      cashApi.ceoDecision(v.id, v.decision, v.notes),
    onSuccess: invalidate,
  });

  const disburse = useMutation({
    mutationFn: (v: {
      id: string;
      input: Parameters<typeof cashApi.disburseCashRequest>[1];
    }) => cashApi.disburseCashRequest(v.id, v.input),
    onSuccess: invalidate,
  });

  const settle = useMutation({
    mutationFn: (v: {
      id: string;
      input: Parameters<typeof cashApi.settleCashRequest>[1];
    }) => cashApi.settleCashRequest(v.id, v.input),
    onSuccess: invalidate,
  });

  const cancel = useMutation({
    mutationFn: (v: { id: string; reason?: string }) =>
      cashApi.cancelCashRequest(v.id, v.reason),
    onSuccess: invalidate,
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

// ── Expenses ─────────────────────────────────────────────

export function useExpenses(filters: { status?: string; page?: number }) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["expenses", brand, filters],
    queryFn: () => cashApi.listExpenses(filters),
    refetchInterval: 30_000,
  });
}

export function useExpense(id: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["expense", brand, id],
    queryFn: () => cashApi.getExpense(id!),
    enabled: !!id,
  });
}

export function useExpenseKpis() {
  const brand = useBrand();
  return useQuery({
    queryKey: ["expense-kpis", brand],
    queryFn: () => cashApi.getExpenseKpis(),
    refetchInterval: 60_000,
  });
}

export function useExpenseCategories() {
  const brand = useBrand();
  return useQuery({
    queryKey: ["expense-categories", brand],
    queryFn: () => cashApi.listExpenseCategories(),
    staleTime: 5 * 60_000,
  });
}

export function useExpenseMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["expenses"] });
    qc.invalidateQueries({ queryKey: ["expense"] });
    qc.invalidateQueries({ queryKey: ["expense-kpis"] });
  };

  const create = useMutation({
    mutationFn: cashApi.createExpense,
    onSuccess: invalidate,
  });

  const submitExpense = useMutation({
    mutationFn: (id: string) => cashApi.submitExpense(id),
    onSuccess: invalidate,
  });

  const approve = useMutation({
    mutationFn: (id: string) => cashApi.approveExpense(id),
    onSuccess: invalidate,
  });

  const reject = useMutation({
    mutationFn: (v: { id: string; reason: string }) =>
      cashApi.rejectExpense(v.id, v.reason),
    onSuccess: invalidate,
  });

  return { create, submitExpense, approve, reject };
}
