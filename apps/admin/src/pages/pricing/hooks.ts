import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBusinessStore } from "@/stores/business";
import * as pricingApi from "./api";
import type {
  ApplyInput,
  ComputeSliderInput,
  CreateFloorInput,
  CreateOverrideInput,
  CreateProposalInput,
  CreateRuleInput,
  CreateScenarioInput,
  RecommendInput,
  UpdateConfigInput,
  UpdateRuleInput,
} from "./types";

function useBrand() {
  return useBusinessStore((s) => s.activeKey);
}

const K = {
  rules: (brand: string, params?: unknown) =>
    ["pricing", "rules", brand, params] as const,
  floors: (brand: string, variantId?: string) =>
    ["pricing", "floors", brand, variantId ?? null] as const,
  overrides: (brand: string, variantId?: string) =>
    ["pricing", "overrides", brand, variantId ?? null] as const,
  scenarios: (brand: string, status?: string) =>
    ["pricing", "scenarios", brand, status ?? ""] as const,
  scenario: (brand: string, id: string | null) =>
    ["pricing", "scenario", brand, id] as const,
  proposals: (brand: string, status?: string) =>
    ["pricing", "proposals", brand, status ?? ""] as const,
  proposal: (brand: string, id: string | null) =>
    ["pricing", "proposal", brand, id] as const,
  config: (brand: string) => ["pricing", "config", brand] as const,
  history: (brand: string, variantId: string | null) =>
    ["pricing", "history", brand, variantId] as const,
};

// ── Advisor ──────────────────────────────────────────────────────────────────
export function useRecommend() {
  return useMutation({
    mutationFn: (input: RecommendInput) => pricingApi.recommend(input),
  });
}

export function useApplyPrice() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (input: ApplyInput) => pricingApi.applyPrice(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pricing", "proposals", brand] });
      qc.invalidateQueries({ queryKey: ["pricing", "history", brand] });
    },
  });
}

export function usePricingConfig() {
  const brand = useBrand();
  return useQuery({
    queryKey: K.config(brand),
    queryFn: pricingApi.getConfig,
    staleTime: 5 * 60_000,
  });
}

export function useUpdateConfig() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (input: UpdateConfigInput) => pricingApi.updateConfig(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: K.config(brand) }),
  });
}

export function useSetVariantUsd() {
  return useMutation({
    mutationFn: ({
      variantId,
      priceUsd,
    }: {
      variantId: string;
      priceUsd: number | null;
    }) => pricingApi.setVariantUsd(variantId, priceUsd),
  });
}

// ── Scenarios ────────────────────────────────────────────────────────────────
export function useScenarios(status?: string) {
  const brand = useBrand();
  return useQuery({
    queryKey: K.scenarios(brand, status),
    queryFn: () => pricingApi.listScenarios(status),
  });
}

export function useScenario(id: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: K.scenario(brand, id),
    queryFn: () => pricingApi.getScenario(id as string),
    enabled: !!id,
  });
}

export function useCreateScenario() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (input: CreateScenarioInput) =>
      pricingApi.createScenario(input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["pricing", "scenarios", brand] }),
  });
}

export function useComputeScenario() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: ({
      id,
      sliders,
    }: {
      id: string;
      sliders?: ComputeSliderInput[];
    }) => pricingApi.computeScenario(id, sliders),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: K.scenario(brand, vars.id) });
      qc.invalidateQueries({ queryKey: ["pricing", "scenarios", brand] });
    },
  });
}

// ── Proposals ────────────────────────────────────────────────────────────────
export function useProposals(status?: string) {
  const brand = useBrand();
  return useQuery({
    queryKey: K.proposals(brand, status),
    queryFn: () => pricingApi.listProposals(status),
    refetchInterval: 30_000,
  });
}

export function useProposal(id: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: K.proposal(brand, id),
    queryFn: () => pricingApi.getProposal(id as string),
    enabled: !!id,
  });
}

export function useProposalMutations() {
  const qc = useQueryClient();
  const brand = useBrand();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["pricing", "proposals", brand] });

  const create = useMutation({
    mutationFn: (input: CreateProposalInput) =>
      pricingApi.createProposal(input),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["pricing", "scenarios", brand] });
    },
  });
  const approve = useMutation({
    mutationFn: (id: string) => pricingApi.approveProposal(id),
    onSuccess: invalidate,
  });
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      pricingApi.rejectProposal(id, reason),
    onSuccess: invalidate,
  });
  const revert = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      pricingApi.revertProposal(id, reason),
    onSuccess: invalidate,
  });

  return { create, approve, reject, revert };
}

// ── Rules ────────────────────────────────────────────────────────────────────
export function useRules(params?: { channel?: string; is_active?: boolean }) {
  const brand = useBrand();
  return useQuery({
    queryKey: K.rules(brand, params),
    queryFn: () => pricingApi.listRules(params),
    staleTime: 60_000,
  });
}

export function useRuleMutations() {
  const qc = useQueryClient();
  const brand = useBrand();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["pricing", "rules", brand] });

  const create = useMutation({
    mutationFn: (input: CreateRuleInput) => pricingApi.createRule(input),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateRuleInput }) =>
      pricingApi.updateRule(id, input),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => pricingApi.deleteRule(id),
    onSuccess: invalidate,
  });

  return { create, update, remove };
}

// ── Floors ───────────────────────────────────────────────────────────────────
export function useFloors(variantId?: string) {
  const brand = useBrand();
  return useQuery({
    queryKey: K.floors(brand, variantId),
    queryFn: () => pricingApi.listFloors(variantId),
    staleTime: 60_000,
  });
}

export function useFloorMutations() {
  const qc = useQueryClient();
  const brand = useBrand();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["pricing", "floors", brand] });

  const create = useMutation({
    mutationFn: (input: CreateFloorInput) => pricingApi.createFloor(input),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => pricingApi.deleteFloor(id),
    onSuccess: invalidate,
  });

  return { create, remove };
}

// ── Overrides ────────────────────────────────────────────────────────────────
export function useOverrides(variantId?: string) {
  const brand = useBrand();
  return useQuery({
    queryKey: K.overrides(brand, variantId),
    queryFn: () => pricingApi.listOverrides(variantId),
    staleTime: 60_000,
  });
}

export function useOverrideMutations() {
  const qc = useQueryClient();
  const brand = useBrand();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["pricing", "overrides", brand] });

  const create = useMutation({
    mutationFn: (input: CreateOverrideInput) =>
      pricingApi.createOverride(input),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => pricingApi.deleteOverride(id),
    onSuccess: invalidate,
  });

  return { create, remove };
}

// ── History ──────────────────────────────────────────────────────────────────
export function useHistory(variantId: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: K.history(brand, variantId),
    queryFn: () => pricingApi.getHistory(variantId as string),
    enabled: !!variantId,
  });
}
