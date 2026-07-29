import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBusinessStore } from "@/stores/business";
import { toast } from "@/stores/toast";
import * as api from "./api";

function useBrand() {
  return useBusinessStore((s) => s.activeKey);
}

/** Server error message (ApiError.message) or a safe fallback. */
function errText(e: unknown): string {
  return e instanceof Error && e.message
    ? e.message
    : "Something went wrong. Please try again.";
}

/**
 * Toast a failed write. Production writes fail for reasons the operator can
 * act on — no FX rate configured, over-receipt, a missing stock permission —
 * so the server's message is surfaced verbatim rather than swallowed.
 */
const onWriteError = (action: string) => (e: unknown) =>
  toast.error(`Couldn't ${action}`, {
    description: errText(e),
    report: { area: "Production", action, message: errText(e) },
  });

// ── Factory Accounts ──────────────────────────────────────

export function useFactoryAccounts() {
  const brand = useBrand();
  return useQuery({
    queryKey: ["factory-accounts", brand],
    queryFn: () => api.listFactoryAccounts(),
  });
}

export function useFactoryAccount(id: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["factory-account", id, brand],
    queryFn: () => api.getFactoryAccount(id!),
    enabled: !!id,
  });
}

export function useCreateFactoryAccount() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: api.createFactoryAccount,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory-accounts", brand] });
    },
  });
}

export function useUpdateFactoryAccount(id: string) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.updateFactoryAccount>[1]) =>
      api.updateFactoryAccount(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory-accounts", brand] });
      qc.invalidateQueries({ queryKey: ["factory-account", id, brand] });
    },
  });
}

// ── Ledger ────────────────────────────────────────────────

export function useLedger(
  accountId: string | null,
  params?: { limit?: number; offset?: number },
) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["ledger", accountId, params, brand],
    queryFn: () => api.listLedger(accountId!, params),
    enabled: !!accountId,
  });
}

export function useAddLedgerEntry(accountId: string) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.addLedgerEntry>[1]) =>
      api.addLedgerEntry(accountId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ledger", accountId] });
      qc.invalidateQueries({ queryKey: ["factory-accounts", brand] });
      qc.invalidateQueries({ queryKey: ["factory-account", accountId, brand] });
    },
  });
}

export function useReconcileEntries(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entryIds: string[]) =>
      api.reconcileEntries(accountId, entryIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ledger", accountId] });
    },
  });
}

// ── Shipments ─────────────────────────────────────────────

export function useShipments(params?: {
  account_id?: string;
  status?: string;
}) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["shipments", params, brand],
    queryFn: () => api.listShipments(params),
  });
}

export function useShipment(id: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["shipment", id, brand],
    queryFn: () => api.getShipment(id!),
    enabled: !!id,
  });
}

export function useCreateShipment() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: api.createShipment,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shipments"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
      qc.invalidateQueries({ queryKey: ["factory-accounts", brand] });
    },
  });
}

export function useAdvanceShipment(id: string) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.advanceShipment>[1]) =>
      api.advanceShipment(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shipments"] });
      qc.invalidateQueries({ queryKey: ["shipment", id, brand] });
    },
  });
}

// ── Production Runs ───────────────────────────────────────

export function useProductionRuns(params?: { status?: string }) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["production-runs", params, brand],
    queryFn: () => api.listProductionRuns(params),
  });
}

export function useProductionRun(id: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["production-run", id, brand],
    queryFn: () => api.getProductionRun(id!),
    enabled: !!id,
  });
}

export function useCreateProductionRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createProductionRun,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production-runs"] });
    },
    onError: onWriteError("create the run"),
  });
}

export function useAdvanceProductionRun(id: string) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (status: string) => api.advanceProductionRun(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production-runs"] });
      qc.invalidateQueries({ queryKey: ["production-run", id, brand] });
    },
    onError: onWriteError("advance the run"),
  });
}

/** Every write that changes a run's cost or units refreshes the same set. */
function useRunInvalidator(runId: string) {
  const qc = useQueryClient();
  const brand = useBrand();
  return () => {
    qc.invalidateQueries({ queryKey: ["production-run", runId, brand] });
    qc.invalidateQueries({ queryKey: ["production-runs"] });
  };
}

export function useAddCostComponent(runId: string) {
  const invalidate = useRunInvalidator(runId);
  return useMutation({
    mutationFn: (input: Parameters<typeof api.addCostComponent>[1]) =>
      api.addCostComponent(runId, input),
    onSuccess: invalidate,
    onError: onWriteError("add the cost"),
  });
}

export function useAddProducts(runId: string) {
  const invalidate = useRunInvalidator(runId);
  return useMutation({
    mutationFn: (input: Parameters<typeof api.addProducts>[1]) =>
      api.addProducts(runId, input),
    onSuccess: invalidate,
    onError: onWriteError("add the products"),
  });
}

export function useReceiveProduction(runId: string) {
  const qc = useQueryClient();
  const invalidate = useRunInvalidator(runId);
  return useMutation({
    mutationFn: (input: Parameters<typeof api.receiveProduction>[1]) =>
      api.receiveProduction(runId, input),
    onSuccess: () => {
      invalidate();
      // Receiving posts a production_in movement — the stock screens are stale.
      qc.invalidateQueries({ queryKey: ["stock"] });
    },
    onError: onWriteError("receive the units"),
  });
}

/**
 * The pre-fill rate for a currency. Kept fresh for 5 minutes: the operator is
 * mid-form, and a rate that changes under them mid-typing is worse than a
 * slightly stale one they can see and override.
 */
export function useFxRate(currency: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["production-fx-rate", currency, brand],
    queryFn: () => api.getFxRate(currency!),
    enabled: !!currency && currency !== "NGN",
    staleTime: 5 * 60 * 1000,
  });
}
