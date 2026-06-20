import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBusinessStore } from "@/stores/business";
import * as api from "./api";

function useBrand() {
  return useBusinessStore((s) => s.activeKey);
}

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
  const brand = useBrand();
  return useMutation({
    mutationFn: api.createProductionRun,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production-runs", undefined, brand] });
    },
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
  });
}

export function useAddCostComponent(runId: string) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.addCostComponent>[1]) =>
      api.addCostComponent(runId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production-run", runId, brand] });
      qc.invalidateQueries({ queryKey: ["production-runs"] });
    },
  });
}
