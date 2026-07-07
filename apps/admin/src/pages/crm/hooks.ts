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

// ── Today feed (server-computed buckets) ──────────────────────────────────

export function useTodayMilestones() {
  const biz = useBiz();
  return useQuery({
    queryKey: ["contacts", biz, "milestones", 7],
    queryFn: () => crmApi.listUpcomingMilestones({ days: 7 }),
    staleTime: 10 * 60_000,
  });
}

export function useCrmToday() {
  const biz = useBiz();
  return useQuery({
    queryKey: ["crm", biz, "today"],
    queryFn: crmApi.getCrmToday,
    staleTime: 5 * 60_000,
  });
}

// ── Clients (contacts + commercial roll-up) ───────────────────────────────

export function useCrmClients(params: crmApi.CrmClientsParams) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["crm", biz, "clients", params],
    queryFn: () => crmApi.listCrmClients(params),
    placeholderData: keepPreviousData,
  });
}

// ── Contact-level activity log + win-back ─────────────────────────────────

export function useContactCrmActivities(contactId: string | null) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["crm", biz, "contact-activities", contactId],
    queryFn: () => crmApi.listContactCrmActivities(contactId!),
    enabled: !!contactId,
  });
}

export function useLogContactActivity(contactId: string) {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (input: Parameters<typeof crmApi.addContactCrmActivity>[1]) =>
      crmApi.addContactCrmActivity(contactId, input),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["crm", biz, "contact-activities", contactId],
      });
      qc.invalidateQueries({ queryKey: ["contacts", biz] });
    },
  });
}

export function useTriggerWinBack() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (contactId: string) => crmApi.triggerWinBack(contactId),
    onSuccess: (_res, contactId) => {
      qc.invalidateQueries({ queryKey: ["crm", biz, "today"] });
      qc.invalidateQueries({
        queryKey: ["crm", biz, "contact-activities", contactId],
      });
    },
  });
}

// ── Reports ───────────────────────────────────────────────────────────────

export function useReportLtv(page = 1, pageSize = 25) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["crm", biz, "report-ltv", page, pageSize],
    queryFn: () => crmApi.getReportLtv({ page, page_size: pageSize }),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}

export function useReportCohorts(months = 12) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["crm", biz, "report-cohorts", months],
    queryFn: () => crmApi.getReportCohorts(months),
    staleTime: 10 * 60_000,
  });
}

export function useReportWinLoss(months = 12) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["crm", biz, "report-winloss", months],
    queryFn: () => crmApi.getReportWinLoss(months),
    staleTime: 10 * 60_000,
  });
}

export function useReportVelocity() {
  const biz = useBiz();
  return useQuery({
    queryKey: ["crm", biz, "report-velocity"],
    queryFn: crmApi.getReportVelocity,
    staleTime: 10 * 60_000,
  });
}

export function useReportForecast() {
  const biz = useBiz();
  return useQuery({
    queryKey: ["crm", biz, "report-forecast"],
    queryFn: crmApi.getReportForecast,
    staleTime: 10 * 60_000,
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
