import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBusinessStore } from "@/stores/business";
import * as expApi from "./api";

function useBrand() {
  return useBusinessStore((s) => s.activeKey);
}

export function useExpenses(filters: { status?: string; page?: number }) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["expenses", brand, filters],
    queryFn: () => expApi.listExpenses(filters),
    refetchInterval: 30_000,
  });
}

export function useExpense(id: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["expense", brand, id],
    queryFn: () => expApi.getExpense(id!),
    enabled: !!id,
  });
}

export function useExpenseKpis() {
  const brand = useBrand();
  return useQuery({
    queryKey: ["expense-kpis", brand],
    queryFn: () => expApi.getExpenseKpis(),
    refetchInterval: 60_000,
  });
}

export function useExpenseCategories() {
  const brand = useBrand();
  return useQuery({
    queryKey: ["expense-categories", brand],
    queryFn: () => expApi.listExpenseCategories(),
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
    mutationFn: expApi.createExpense,
    onSuccess: invalidate,
  });

  const submitExpense = useMutation({
    mutationFn: (id: string) => expApi.submitExpense(id),
    onSuccess: invalidate,
  });

  const approve = useMutation({
    mutationFn: (id: string) => expApi.approveExpense(id),
    onSuccess: invalidate,
  });

  const reject = useMutation({
    mutationFn: (v: { id: string; reason: string }) =>
      expApi.rejectExpense(v.id, v.reason),
    onSuccess: invalidate,
  });

  const createCategory = useMutation({
    mutationFn: expApi.createExpenseCategory,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["expense-categories"] }),
  });

  return { create, submitExpense, approve, reject, createCategory };
}
