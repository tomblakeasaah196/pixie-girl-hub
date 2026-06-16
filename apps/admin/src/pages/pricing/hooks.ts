import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBusinessStore } from "@/stores/business";
import * as pricingApi from "./api";
import type { ScenarioComputeInput } from "./types";

function useBrand() {
  return useBusinessStore((s) => s.activeKey);
}

// ── Pricing Rules ─────────────────────────────────────────────────────────────

export function usePricingRules(params?: { page?: number; is_active?: boolean }) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["pricing-rules", brand, params],
    queryFn: () => pricingApi.listRules(params),
    staleTime: 60_000,
  });
}

export function usePricingRule(id: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["pricing-rule", brand, id],
    queryFn: () => pricingApi.getRule(id!),
    enabled: !!id,
  });
}

export function usePricingRuleMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["pricing-rules"] });

  const create = useMutation({
    mutationFn: pricingApi.createRule,
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof pricingApi.updateRule>[1] }) =>
      pricingApi.updateRule(id, input),
    onSuccess: invalidate,
  });

  return { create, update };
}

// ── Price Floors ──────────────────────────────────────────────────────────────

export function usePriceFloors(params?: { page?: number }) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["price-floors", brand, params],
    queryFn: () => pricingApi.listFloors(params),
    staleTime: 60_000,
  });
}

export function usePriceFloorMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["price-floors"] });

  const create = useMutation({
    mutationFn: pricingApi.createFloor,
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof pricingApi.updateFloor>[1] }) =>
      pricingApi.updateFloor(id, input),
    onSuccess: invalidate,
  });

  return { create, update };
}

// ── Scenario ──────────────────────────────────────────────────────────────────

export function useComputeScenario() {
  return useMutation({
    mutationFn: (input: ScenarioComputeInput) => pricingApi.computeScenario(input),
  });
}

// ── Proposals ─────────────────────────────────────────────────────────────────

export function useProposals(params?: { page?: number; status?: string }) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["pricing-proposals", brand, params],
    queryFn: () => pricingApi.listProposals(params),
    refetchInterval: 30_000,
  });
}

export function useProposalMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["pricing-proposals"] });

  const create = useMutation({
    mutationFn: pricingApi.createProposal,
    onSuccess: invalidate,
  });

  const approve = useMutation({
    mutationFn: (id: string) => pricingApi.approveProposal(id),
    onSuccess: invalidate,
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      pricingApi.rejectProposal(id, reason),
    onSuccess: invalidate,
  });

  const revert = useMutation({
    mutationFn: (id: string) => pricingApi.revertProposal(id),
    onSuccess: invalidate,
  });

  return { create, approve, reject, revert };
}
