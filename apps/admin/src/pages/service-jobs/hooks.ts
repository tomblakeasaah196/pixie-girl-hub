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
    select: (r) => r.data,
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
    select: (r) => r.data,
  });
}

export function useRecipe(id: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["service-recipe", id, brand],
    queryFn: () => api.getRecipe(id!),
    enabled: !!id,
    select: (r) => r.data,
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
    select: (r) => r.data,
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
    outcome: useMutation({
      mutationFn: (input: Parameters<typeof api.recordOutcome>[1]) =>
        api.recordOutcome(jobId, input),
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
    select: (r) => r.data,
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
    select: (r) => r.data,
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
    qc: useMutation({
      mutationFn: (input: Parameters<typeof api.qcJob>[1]) =>
        api.qcJob(jobId, input),
      onSuccess: invalidate,
    }),
    dispatch: useMutation({
      mutationFn: () => api.dispatchJob(jobId),
      onSuccess: invalidate,
    }),
    handToSales: useMutation({
      mutationFn: () => api.handToSales(jobId),
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
    select: (r) => r.data,
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
    select: (r) => r.data,
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
    select: (r) => r.data,
  });
}

// ── Wig accountability ─────────────────────────────────────

export function useAccountability() {
  const brand = useBrand();
  return useQuery({
    queryKey: ["studio-accountability", brand],
    queryFn: () => api.getAccountability(),
    select: (r) => r.data,
  });
}
