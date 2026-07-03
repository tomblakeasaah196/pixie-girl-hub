import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBusinessStore } from "@/stores/business";
import * as api from "./api";

function useBrand() {
  return useBusinessStore((s) => s.activeKey);
}

// ── Partners ───────────────────────────────────────────────
export function usePartners(filters: {
  status?: string;
  country_code?: string;
  city?: string;
}) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["stylists", brand, filters],
    queryFn: () => api.listPartners(filters),
  });
}

export function usePartner(id: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["stylist", brand, id],
    queryFn: () => api.getPartner(id!),
    enabled: !!id,
  });
}

export function usePartnerMutations(id: string | null) {
  const qc = useQueryClient();
  const brand = useBrand();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["stylists", brand] });
    qc.invalidateQueries({ queryKey: ["stylist", brand, id] });
    qc.invalidateQueries({ queryKey: ["stylist-applications", brand] });
  };
  return {
    update: useMutation({
      mutationFn: (patch: Record<string, unknown>) =>
        api.updatePartner(id!, patch),
      onSuccess: invalidate,
    }),
    setStatus: useMutation({
      mutationFn: ({ status, reason }: { status: string; reason?: string }) =>
        api.setPartnerStatus(id!, status, reason),
      onSuccess: invalidate,
    }),
    issueBadge: useMutation({
      mutationFn: () => api.issueBadge(id!),
      onSuccess: invalidate,
    }),
    revokeBadge: useMutation({
      mutationFn: () => api.revokeBadge(id!),
      onSuccess: invalidate,
    }),
    invite: useMutation({
      mutationFn: () => api.invitePartner(id!),
      onSuccess: invalidate,
    }),
    sendContract: useMutation({
      mutationFn: () => api.sendContract(id!),
      onSuccess: invalidate,
    }),
    setSpeciality: useMutation({
      mutationFn: (input: Parameters<typeof api.setSpeciality>[1]) =>
        api.setSpeciality(id!, input),
      onSuccess: invalidate,
    }),
    removeSpeciality: useMutation({
      mutationFn: (specialityId: string) =>
        api.removeSpeciality(id!, specialityId),
      onSuccess: invalidate,
    }),
    awardCertification: useMutation({
      mutationFn: (input: Parameters<typeof api.awardCertification>[1]) =>
        api.awardCertification(id!, input),
      onSuccess: invalidate,
    }),
    revokeCertification: useMutation({
      mutationFn: (certificationId: string) =>
        api.revokeCertification(id!, certificationId),
      onSuccess: invalidate,
    }),
  };
}

// ── Applications ───────────────────────────────────────────
export function useApplications(status?: string) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["stylist-applications", brand, status],
    queryFn: () => api.listApplications(status),
  });
}

export function useApplication(id: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["stylist-application", brand, id],
    queryFn: () => api.getApplication(id!),
    enabled: !!id,
  });
}

export function useApplicationMutations(id: string | null) {
  const qc = useQueryClient();
  const brand = useBrand();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["stylist-applications", brand] });
    qc.invalidateQueries({ queryKey: ["stylist-application", brand, id] });
    qc.invalidateQueries({ queryKey: ["stylists", brand] });
  };
  return {
    review: useMutation({
      mutationFn: (input: Parameters<typeof api.addVettingReview>[1]) =>
        api.addVettingReview(id!, input),
      onSuccess: invalidate,
    }),
    decide: useMutation({
      mutationFn: (input: Parameters<typeof api.decideApplication>[1]) =>
        api.decideApplication(id!, input),
      onSuccess: invalidate,
    }),
  };
}

// ── Assignments + routing ──────────────────────────────────
export function useAssignments(filters: {
  status?: string;
  stylist_id?: string;
}) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["stylist-assignments", brand, filters],
    queryFn: () => api.listAssignments(filters),
  });
}

export function useAssignment(id: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["stylist-assignment", brand, id],
    queryFn: () => api.getAssignment(id!),
    enabled: !!id,
  });
}

export function useRoutingSuggest(
  params: {
    service_key: string;
    city?: string;
    state?: string;
    country_code?: string;
  } | null,
) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["stylist-routing", brand, params],
    queryFn: () => api.routingSuggest(params!),
    enabled: !!params && !!params.service_key,
  });
}

export function useAssignmentMutations(id: string | null) {
  const qc = useQueryClient();
  const brand = useBrand();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["stylist-assignments", brand] });
    qc.invalidateQueries({ queryKey: ["stylist-assignment", brand, id] });
  };
  return {
    open: useMutation({
      mutationFn: api.openAssignment,
      onSuccess: invalidate,
    }),
    cancel: useMutation({
      mutationFn: (reason?: string) => api.cancelAssignment(id!, reason),
      onSuccess: invalidate,
    }),
    addOffers: useMutation({
      mutationFn: (stylistIds: string[]) => api.addOffers(id!, stylistIds),
      onSuccess: invalidate,
    }),
    dispute: useMutation({
      mutationFn: (input: Parameters<typeof api.disputeAssignment>[1]) =>
        api.disputeAssignment(id!, input),
      onSuccess: invalidate,
    }),
  };
}

// ── Payouts ────────────────────────────────────────────────
export function usePayouts(filters: { stylist_id?: string; status?: string }) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["stylist-payouts", brand, filters],
    queryFn: () => api.listPayouts(filters),
  });
}

export function usePayout(id: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["stylist-payout", brand, id],
    queryFn: () => api.getPayout(id!),
    enabled: !!id,
  });
}

export function usePayoutMutations() {
  const qc = useQueryClient();
  const brand = useBrand();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["stylist-payouts", brand] });
  return {
    generate: useMutation({
      mutationFn: api.generatePayout,
      onSuccess: invalidate,
    }),
    submit: useMutation({
      mutationFn: api.submitPayout,
      onSuccess: () => {
        invalidate();
        qc.invalidateQueries({ queryKey: ["stylist-payout", brand] });
      },
    }),
    approve: useMutation({
      mutationFn: api.approvePayout,
      onSuccess: () => {
        invalidate();
        qc.invalidateQueries({ queryKey: ["stylist-payout", brand] });
      },
    }),
    markPaid: useMutation({
      mutationFn: ([id, code]: [string, string | undefined]) =>
        api.markPayoutPaid(id, code),
      onSuccess: () => {
        invalidate();
        qc.invalidateQueries({ queryKey: ["stylist-payout", brand] });
      },
    }),
  };
}

// ── Reviews + referrals ────────────────────────────────────
export function useVerifiedReviews(filters: {
  stylist_id?: string;
  hidden?: boolean;
}) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["stylist-reviews", brand, filters],
    queryFn: () => api.listReviews(filters),
  });
}

export function useReviewVisibilityMutation() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: ([assignmentId, hidden]: [string, boolean]) =>
      api.setReviewVisibility(assignmentId, hidden),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["stylist-reviews", brand] }),
  });
}

export function useAttributions(filters: {
  stylist_id?: string;
  status?: string;
}) {
  const brand = useBrand();
  return useQuery({
    queryKey: ["stylist-referrals", brand, filters],
    queryFn: () => api.listAttributions(filters),
  });
}

// ── Programme config ───────────────────────────────────────
export function useProgrammeConfig() {
  const brand = useBrand();
  return useQuery({
    queryKey: ["stylist-config", brand],
    queryFn: api.getConfig,
  });
}

export function useTiers() {
  const brand = useBrand();
  return useQuery({
    queryKey: ["stylist-tiers", brand],
    queryFn: api.listTiers,
  });
}

export function useQuestions() {
  const brand = useBrand();
  return useQuery({
    queryKey: ["stylist-questions", brand],
    queryFn: api.listQuestions,
  });
}

export function useConfigMutations() {
  const qc = useQueryClient();
  const brand = useBrand();
  return {
    updateConfig: useMutation({
      mutationFn: api.updateConfig,
      onSuccess: () =>
        qc.invalidateQueries({ queryKey: ["stylist-config", brand] }),
    }),
    updateTier: useMutation({
      mutationFn: ([key, patch]: [string, Record<string, unknown>]) =>
        api.updateTier(key, patch),
      onSuccess: () =>
        qc.invalidateQueries({ queryKey: ["stylist-tiers", brand] }),
    }),
    createQuestion: useMutation({
      mutationFn: api.createQuestion,
      onSuccess: () =>
        qc.invalidateQueries({ queryKey: ["stylist-questions", brand] }),
    }),
    updateQuestion: useMutation({
      mutationFn: ([id, patch]: [string, Record<string, unknown>]) =>
        api.updateQuestion(id, patch),
      onSuccess: () =>
        qc.invalidateQueries({ queryKey: ["stylist-questions", brand] }),
    }),
  };
}
