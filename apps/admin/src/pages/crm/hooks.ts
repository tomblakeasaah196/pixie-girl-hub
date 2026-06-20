import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { useBusinessStore } from "@/stores/business";
import * as crmApi from "./api";
import type { DealFilter } from "./types";
import type { DealCreateInput } from "@/pages/contacts/types";

function useBiz() {
  return useBusinessStore((s) => s.activeKey);
}

// Re-export contact hooks for convenience
export {
  useContacts,
  useContact,
  useContactSummary,
  usePipelines,
  usePipelineStages,
  useDeals,
  useCreateDeal,
  useMoveDeal,
  useChurnScores,
  useSegments,
} from "@/pages/contacts/hooks";

// ── CRM KPIs ──────────────────────────────────────────────────────────────

export function useCrmKpis() {
  const biz = useBiz();
  return useQuery({
    queryKey: ["crm", biz, "kpis"],
    queryFn: crmApi.getCrmKpis,
    staleTime: 5 * 60_000,
  });
}

// ── Today feed ────────────────────────────────────────────────────────────

export function useTodayMilestones() {
  const biz = useBiz();
  return useQuery({
    queryKey: ["contacts", biz, "milestones", 7],
    queryFn: () => crmApi.listUpcomingMilestones({ days: 7 }),
    staleTime: 10 * 60_000,
  });
}

export function useTodayNewContacts() {
  const biz = useBiz();
  return useQuery({
    queryKey: ["crm", biz, "today-new"],
    queryFn: () => crmApi.getTodayNewContacts(7),
    staleTime: 5 * 60_000,
  });
}

export function useTodayStaleDeals(staleDays = 14) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["crm", biz, "today-stale", staleDays],
    queryFn: () => crmApi.getTodayStaleDeals(staleDays),
    staleTime: 5 * 60_000,
  });
}

// ── Single deal ───────────────────────────────────────────────────────────

export function useDeal(id: string | null) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["crm", biz, "deal", id],
    queryFn: () => crmApi.getDeal(id!),
    enabled: !!id,
  });
}

export function useSetDealStatus() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: ({
      id,
      status,
      lostReason,
    }: {
      id: string;
      status: "won" | "lost" | "cancelled";
      lostReason?: string;
    }) => crmApi.setDealStatus(id, status, lostReason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm", biz, "deals"] });
      qc.invalidateQueries({ queryKey: ["crm", biz, "deal"] });
      qc.invalidateQueries({ queryKey: ["crm", biz, "kpis"] });
    },
  });
}

export function useUpdateDeal(id: string) {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (input: Partial<DealCreateInput>) =>
      crmApi.updateDeal(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm", biz, "deal", id] });
      qc.invalidateQueries({ queryKey: ["crm", biz, "deals"] });
    },
  });
}

// ── Deal pipeline list (with filter) ──────────────────────────────────────

export function usePipelineDeals(filter: DealFilter) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["crm", biz, "pipeline-deals", filter],
    queryFn: () =>
      crmApi.listDeals({
        pipeline_id: filter.pipeline_id,
        stage_id: filter.stage_id,
        status: filter.status || "open",
        assigned_to: filter.assigned_to,
        page_size: 200,
      }),
    placeholderData: keepPreviousData,
  });
}

// ── Deal activities ───────────────────────────────────────────────────────

export function useDealActivities(dealId: string | null) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["crm", biz, "deal-activities", dealId],
    queryFn: () => crmApi.getDealActivities(dealId!),
    enabled: !!dealId,
  });
}

export function useAddDealActivity(dealId: string) {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (input: Parameters<typeof crmApi.addDealActivity>[1]) =>
      crmApi.addDealActivity(dealId, input),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["crm", biz, "deal-activities", dealId],
      });
      qc.invalidateQueries({ queryKey: ["crm", biz, "deal", dealId] });
      qc.invalidateQueries({ queryKey: ["crm", biz, "kpis"] });
    },
  });
}

// ── Deal notes ────────────────────────────────────────────────────────────

export function useDealNotes(dealId: string | null) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["crm", biz, "deal-notes", dealId],
    queryFn: () => crmApi.getDealNotes(dealId!),
    enabled: !!dealId,
  });
}

export function useAddDealNote(dealId: string) {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: ({ body, visibility }: { body: string; visibility?: string }) =>
      crmApi.addDealNote(dealId, body, visibility),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["crm", biz, "deal-notes", dealId] }),
  });
}

// ── AI ────────────────────────────────────────────────────────────────────

export function useAiDealSummary(dealId: string | null, enabled = false) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["crm", biz, "ai-summary", dealId],
    queryFn: () => crmApi.getAiDealSummary(dealId!),
    enabled: enabled && !!dealId,
    staleTime: 15 * 60_000,
    retry: 1,
  });
}

export function useAiNextActions(dealId: string | null, enabled = false) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["crm", biz, "ai-next-actions", dealId],
    queryFn: () => crmApi.getAiNextActions(dealId!),
    enabled: enabled && !!dealId,
    staleTime: 15 * 60_000,
    retry: 1,
  });
}

export function useAiChurnExplainer(contactId: string | null, enabled = false) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["crm", biz, "ai-churn", contactId],
    queryFn: () => crmApi.getAiChurnExplainer(contactId!),
    enabled: enabled && !!contactId,
    staleTime: 30 * 60_000,
    retry: 1,
  });
}

export function useDraftActivity() {
  return useMutation({
    mutationFn: crmApi.draftActivityBody,
  });
}
