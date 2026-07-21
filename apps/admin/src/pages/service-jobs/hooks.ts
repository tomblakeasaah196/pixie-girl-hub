import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBusinessStore } from "@/stores/business";
import * as api from "./api";

function useBrand() {
  return useBusinessStore((s) => s.activeKey);
}

// ── Service types ──────────────────────────────────────────

export function useServiceTypes(isActive?: boolean) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["service-types", brand, isActive],
    queryFn: () =>
      api.listServiceTypes(
        isActive !== undefined ? { is_active: isActive } : undefined,
      ),
  });
}

export function useServiceTypeMutations() {
  const qc = useQueryClient();
  const brand = useBrand();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["service-types", brand] });
  return {
    create: useMutation({
      mutationFn: api.createServiceType,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ([id, patch]: Parameters<typeof api.updateServiceType>) =>
        api.updateServiceType(id, patch),
      onSuccess: invalidate,
    }),
  };
}

// ── Recipes ────────────────────────────────────────────────

export function useRecipes(isActive?: boolean) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["service-recipes", brand, isActive],
    queryFn: () =>
      api.listRecipes(
        isActive !== undefined ? { is_active: isActive } : undefined,
      ),
  });
}

export function useRecipe(id: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["service-recipe", id, brand],
    queryFn: () => api.getRecipe(id!),
    enabled: !!id,
  });
}

export function useRecipeMutations() {
  const qc = useQueryClient();
  const brand = useBrand();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["service-recipes", brand] });
  return {
    create: useMutation({
      mutationFn: api.createRecipe,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ([id, patch]: Parameters<typeof api.updateRecipe>) =>
        api.updateRecipe(id, patch),
      onSuccess: invalidate,
    }),
  };
}

// ── Jobs ───────────────────────────────────────────────────

export function useJobs(params?: Parameters<typeof api.listJobs>[0]) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["service-jobs", params, brand],
    queryFn: () => api.listJobs(params),
  });
}

export function useJob(id: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["service-job", id, brand],
    queryFn: () => api.getJob(id!),
    enabled: !!id,
  });
}

/**
 * The stylist's currently-open time session (or null). Polls every 30s so
 * the "Working on Job X" strip reflects a start/pause done elsewhere (e.g.
 * from another tab, or from the per-job card lifecycle mutations).
 * `enabled` gates the poll so we don't burn a request on users who aren't
 * own-scope (Ops don't have a personal work clock).
 */
export function useMyCurrentSession(enabled: boolean) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["service-jobs-my-current", brand],
    queryFn: api.getMyCurrentSession,
    enabled,
    refetchInterval: enabled ? 30_000 : false,
    // A background tab shouldn't keep pinging — the strip will refresh when
    // the user comes back to focus this window.
    refetchIntervalInBackground: false,
  });
}

export function useCreateJob() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: api.createJob,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["service-jobs", brand] }),
  });
}

// Drives the drawer's "Assign to" picker. Kept scoped to brand so a business
// switch re-fetches; short stale time is fine because the picker opens on
// user gesture and workload changes only when a job moves.
export function useAssignableStylists(enabled = true) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["service-jobs-stylists", brand],
    queryFn: api.listAssignableStylists,
    enabled,
    staleTime: 30_000,
  });
}

// ── Scorecards (internal Stylist Studio only) ────────────────

export function useStylistScorecards() {
  const brand = useBrand();
  return useQuery({
    queryKey: ["stylist-scorecards", brand],
    queryFn: api.listStylistScorecards,
  });
}

export function useStylistScorecard(userId: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["stylist-scorecard", userId, brand],
    queryFn: () => api.getStylistScorecard(userId!),
    enabled: !!userId,
  });
}

export function useSummarizeJob(jobId: string) {
  return useMutation({
    mutationFn: () => api.summarizeJob(jobId),
  });
}

export function useJobActions(jobId: string) {
  const qc = useQueryClient();
  const brand = useBrand();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["service-jobs"] });
    qc.invalidateQueries({ queryKey: ["service-job", jobId, brand] });
  };
  return {
    update: useMutation({
      mutationFn: (patch: Parameters<typeof api.updateJob>[1]) =>
        api.updateJob(jobId, patch),
      onSuccess: invalidate,
    }),
    advance: useMutation({
      mutationFn: ({
        status,
        actual_cost_ngn,
      }: {
        status: string;
        actual_cost_ngn?: number;
      }) => api.advanceJob(jobId, status, actual_cost_ngn),
      onSuccess: invalidate,
    }),
    assign: useMutation({
      mutationFn: (userId: string) => api.assignStaff(jobId, userId),
      onSuccess: invalidate,
    }),
    unassign: useMutation({
      mutationFn: () => api.unassignStaff(jobId),
      onSuccess: invalidate,
    }),
    outcome: useMutation({
      mutationFn: (input: Parameters<typeof api.recordOutcome>[1]) =>
        api.recordOutcome(jobId, input),
      onSuccess: invalidate,
    }),
    linkIntercompany: useMutation({
      mutationFn: (icTransactionId: string) =>
        api.linkIntercompany(jobId, icTransactionId),
      onSuccess: invalidate,
    }),
  };
}

// ── Job chemicals ──────────────────────────────────────────

export function useJobChemicals(jobId: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["job-chemicals", jobId, brand],
    queryFn: () => api.listJobChemicals(jobId!),
    enabled: !!jobId,
  });
}

export function useRecordChemical(jobId: string) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.recordJobChemical>[1]) =>
      api.recordJobChemical(jobId, input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["job-chemicals", jobId, brand] }),
  });
}

// ── Reconciliations ────────────────────────────────────────

export function useReconciliations(
  params?: Parameters<typeof api.listReconciliations>[0],
) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["chem-reconciliations", params, brand],
    queryFn: () => api.listReconciliations(params),
  });
}

export function useRunReconciliation() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: api.runReconciliation,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["chem-reconciliations", brand] }),
  });
}

// ── Stylist Studio lifecycle (PR4) ─────────────────────────

export function useStudioLifecycle(jobId: string) {
  const qc = useQueryClient();
  const brand = useBrand();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["service-jobs"] });
    qc.invalidateQueries({ queryKey: ["service-job", jobId, brand] });
    qc.invalidateQueries({ queryKey: ["studio-accountability", brand] });
  };
  return {
    start: useMutation({
      mutationFn: () => api.startJob(jobId),
      onSuccess: invalidate,
    }),
    pause: useMutation({
      mutationFn: () => api.pauseJob(jobId),
      onSuccess: invalidate,
    }),
    resume: useMutation({
      mutationFn: () => api.resumeJob(jobId),
      onSuccess: invalidate,
    }),
    returnForQc: useMutation({
      mutationFn: () => api.returnJob(jobId),
      onSuccess: invalidate,
    }),
    // QC pass auto-completes the job + creates the Logistics delivery in one
    // call — no separate dispatch / hand-to-sales mutations any more (those
    // flows now live on the Logistics + Sales Order side).
    qc: useMutation({
      mutationFn: (input: Parameters<typeof api.qcJob>[1]) =>
        api.qcJob(jobId, input),
      onSuccess: invalidate,
    }),
    writeOff: useMutation({
      mutationFn: (reason: string) => api.writeOffWig(jobId, reason),
      onSuccess: invalidate,
    }),
  };
}

// ── Materials / references / time logs ─────────────────────

export function useJobMaterials(jobId: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["job-materials", jobId, brand],
    queryFn: () => api.listMaterials(jobId!),
    enabled: !!jobId,
  });
}

export function useLogMaterial(jobId: string) {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.logMaterial>[1]) =>
      api.logMaterial(jobId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job-materials", jobId, brand] });
    },
  });
}

export function useJobReferences(jobId: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["job-references", jobId, brand],
    queryFn: () => api.listReferences(jobId!),
    enabled: !!jobId,
  });
}

export function useReferenceMutations(jobId: string) {
  const qc = useQueryClient();
  const brand = useBrand();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["job-references", jobId, brand] });
  return {
    add: useMutation({
      mutationFn: (input: Parameters<typeof api.addReference>[1]) =>
        api.addReference(jobId, input),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (refId: string) => api.deleteReference(jobId, refId),
      onSuccess: invalidate,
    }),
  };
}

export function useJobTimeLogs(jobId: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["job-time-logs", jobId, brand],
    queryFn: () => api.listTimeLogs(jobId!),
    enabled: !!jobId,
  });
}

export function useJobActivity(jobId: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["job-activity", jobId, brand],
    queryFn: () => api.listJobActivity(jobId!),
    enabled: !!jobId,
  });
}

// ── Wig accountability ─────────────────────────────────────

export function useAccountability() {
  const brand = useBrand();
  return useQuery({
    queryKey: ["studio-accountability", brand],
    queryFn: () => api.getAccountability(),
  });
}

export function useJobCustody(jobId: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["job-custody", jobId, brand],
    queryFn: () => api.listCustodyLedger({ job_id: jobId! }),
    enabled: !!jobId,
  });
}
