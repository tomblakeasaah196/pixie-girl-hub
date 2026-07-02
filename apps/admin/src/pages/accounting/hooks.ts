import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBusinessStore } from "@/stores/business";
import * as accApi from "./api";
import type { ManualJournalInput, TaxType } from "./types";

function useBrand() {
  return useBusinessStore((s) => s.activeKey);
}

// ── Chart of accounts / periods ──────────────────────────
export function useAccountGroups() {
  const brand = useBrand();
  return useQuery({
    queryKey: ["acc-groups", brand],
    queryFn: () => accApi.listAccountGroups(),
  });
}
export function useAccounts() {
  const brand = useBrand();
  return useQuery({
    queryKey: ["acc-accounts", brand],
    queryFn: () => accApi.listAccounts(),
  });
}
export function usePeriods() {
  const brand = useBrand();
  return useQuery({
    queryKey: ["acc-periods", brand],
    queryFn: () => accApi.listPeriods(),
  });
}
export function useClosePeriod() {
  const brand = useBrand();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => accApi.closePeriod(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["acc-periods", brand] }),
  });
}

// ── Journals ─────────────────────────────────────────────
export function useJournals(filters: {
  status?: string;
  source_type?: string;
  page?: number;
}) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["acc-journals", brand, filters],
    queryFn: () => accApi.listJournals({ ...filters, page_size: 25 }),
  });
}
export function useJournal(id: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["acc-journal", brand, id],
    queryFn: () => accApi.getJournal(id!),
    enabled: !!id,
  });
}
export function useCreateJournal() {
  const brand = useBrand();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { input: ManualJournalInput; opening?: boolean }) =>
      args.opening
        ? accApi.postOpeningBalance(args.input)
        : accApi.createManualJournal(args.input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["acc-journals", brand] });
      qc.invalidateQueries({ queryKey: ["acc-report", brand] });
    },
  });
}
export function useReverseJournal() {
  const brand = useBrand();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; reason?: string }) =>
      accApi.reverseJournal(args.id, args.reason),
    onSuccess: (_d, args) => {
      qc.invalidateQueries({ queryKey: ["acc-journals", brand] });
      qc.invalidateQueries({ queryKey: ["acc-journal", brand, args.id] });
      qc.invalidateQueries({ queryKey: ["acc-report", brand] });
    },
  });
}

// ── Reports (all share the acc-report key root for invalidation) ─
export function useTrialBalance(asOf?: string) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["acc-report", brand, "tb", asOf],
    queryFn: () => accApi.getTrialBalance(asOf),
  });
}
export function useProfitAndLoss(from?: string, to?: string) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["acc-report", brand, "pnl", from, to],
    queryFn: () => accApi.getProfitAndLoss(from, to),
  });
}
export function useBalanceSheet(asOf?: string) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["acc-report", brand, "bs", asOf],
    queryFn: () => accApi.getBalanceSheet(asOf),
  });
}
export function useCashFlow(from?: string, to?: string) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["acc-report", brand, "cf", from, to],
    queryFn: () => accApi.getCashFlow(from, to),
  });
}
export function useArAgeing() {
  const brand = useBrand();
  return useQuery({
    queryKey: ["acc-report", brand, "ar"],
    queryFn: () => accApi.getArAgeing(),
  });
}
export function useApAgeing() {
  const brand = useBrand();
  return useQuery({
    queryKey: ["acc-report", brand, "ap"],
    queryFn: () => accApi.getApAgeing(),
  });
}

// ── Tax Center ───────────────────────────────────────────
export function useTaxComputation(taxType: TaxType, periodId: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["acc-tax-comp", brand, taxType, periodId],
    queryFn: () => accApi.getTaxComputation(taxType, periodId!),
    enabled: !!periodId,
  });
}
export function useTaxFilings(filters: { status?: string; page?: number }) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["acc-tax-filings", brand, filters],
    queryFn: () => accApi.listTaxFilings(filters),
  });
}
export function useTaxFilingActions() {
  const brand = useBrand();
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["acc-tax-filings", brand] });
    qc.invalidateQueries({ queryKey: ["acc-report", brand] });
  };
  const draft = useMutation({
    mutationFn: (input: { tax_type: TaxType; fiscal_period_id: string }) =>
      accApi.draftFilingFromPeriod(input),
    onSuccess: invalidate,
  });
  const review = useMutation({
    mutationFn: (id: string) => accApi.reviewFiling(id),
    onSuccess: invalidate,
  });
  const file = useMutation({
    mutationFn: (args: { id: string; reference?: string }) =>
      accApi.fileFiling(args.id, args.reference),
    onSuccess: invalidate,
  });
  const pay = useMutation({
    mutationFn: (args: { id: string; reference?: string }) =>
      accApi.payFiling(args.id, args.reference),
    onSuccess: invalidate,
  });
  return { draft, review, file, pay };
}

// ── Bank ─────────────────────────────────────────────────
export function useBankStatements(page: number) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["acc-bank-statements", brand, page],
    queryFn: () => accApi.listBankStatements({ page }),
  });
}
export function useBankReconciliations(page: number) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["acc-bank-recons", brand, page],
    queryFn: () => accApi.listBankReconciliations({ page }),
  });
}
