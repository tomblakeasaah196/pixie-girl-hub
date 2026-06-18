import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBusinessStore } from "@/stores/business";
import * as pricingApi from "./api";
import type {
  CreateRuleInput,
  UpdateRuleInput,
  CreateFloorInput,
  CreateScenarioInput,
  ComputeScenarioInput,
  CreateProposalInput
} from "./types";

/** * Assumes you have a store managing the active brand/tenant ID 
 * required for your multi-tenant DB structure.
 */
function useBrand() {
  return useBusinessStore((s) => s.activeKey);
}

// ── Pricing Rules ─────────────────────────────────────────────────────────────

export function usePricingRules(params?: { channel?: string; is_active?: boolean; page?: number }) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["pricing-rules", brand, params],
    queryFn: () => pricingApi.listRules(params),
    staleTime: 60_000,
  });
}

export function usePricingRuleMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["pricing-rules"] });

  const create = useMutation({
    mutationFn: (input: CreateRuleInput) => pricingApi.createRule(input),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateRuleInput }) =>
      pricingApi.updateRule(id, input),
    onSuccess: invalidate,
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => pricingApi.deactivateRule(id),
    onSuccess: invalidate,
  });

  return { create, update, deactivate };
}

// ── Price Floors ──────────────────────────────────────────────────────────────

export function usePriceFloors(params?: { variant_id?: string; page?: number }) {
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
    mutationFn: (input: CreateFloorInput) => pricingApi.createFloor(input),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => pricingApi.removeFloor(id),
    onSuccess: invalidate,
  });

  return { create, remove };
}

// ── Scenarios (Goal-Seek / Sensitivity) ───────────────────────────────────────

export function useScenarioMutations() {
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: (input: CreateScenarioInput) => pricingApi.createScenario(input),
  });

  const compute = useMutation({
    mutationFn: ({ id, input }: { id: string; input?: ComputeScenarioInput }) =>
      pricingApi.computeScenario(id, input),
    // Invalidating scenarios list to keep the UI in sync after computation completes
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pricing-scenarios"] }),
  });

  return { create, compute };
}

export function useScenarios(params?: { status?: string; page?: number }) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["pricing-scenarios", brand, params],
    queryFn: () => pricingApi.listScenarios(params),
    staleTime: 60_000,
  });
}

// ── Proposals ─────────────────────────────────────────────────────────────────

export function useProposals(params?: { status?: string; page?: number }) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["pricing-proposals", brand, params],
    queryFn: () => pricingApi.listProposals(params),
    refetchInterval: 30_000, // Poll for CEO approval changes
  });
}

export function useProposalMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["pricing-proposals"] });

  const create = useMutation({
    mutationFn: (input: CreateProposalInput) => pricingApi.createProposal(input),
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
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      pricingApi.revertProposal(id, reason),
    onSuccess: invalidate,
  });

  return { create, approve, reject, revert };
}
