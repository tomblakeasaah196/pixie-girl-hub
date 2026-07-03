import { api } from "@/lib/api";
import type {
  Partner,
  PartnerDetail,
  ApplicationRow,
  ApplicationDetail,
  VettingReview,
  Assignment,
  AssignmentDetail,
  Payout,
  Tier,
  ProgrammeConfig,
  Question,
  RoutingSuggestion,
  VerifiedReview,
  Attribution,
  Certification,
  Speciality,
} from "./types";

const BASE = "/stylists";

const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

// ── Partners ───────────────────────────────────────────────
export const listPartners = (params: {
  status?: string;
  country_code?: string;
  city?: string;
}) => api.get<Partner[]>(`${BASE}${qs(params)}`);
export const getPartner = (id: string) =>
  api.get<PartnerDetail>(`${BASE}/${id}`);
export const updatePartner = (id: string, patch: Record<string, unknown>) =>
  api.patch<Partner>(`${BASE}/${id}`, patch);
export const setPartnerStatus = (
  id: string,
  status: string,
  reason?: string,
) => api.post<Partner>(`${BASE}/${id}/status`, { status, reason });
export const issueBadge = (id: string) =>
  api.post<Partner>(`${BASE}/${id}/badge`, {});
export const revokeBadge = (id: string) =>
  api.delete<Partner>(`${BASE}/${id}/badge`);
export const invitePartner = (id: string) =>
  api.post<{ invited: boolean; email: string }>(`${BASE}/${id}/invite`, {});
export const sendContract = (id: string) =>
  api.post<{ document_id: string }>(`${BASE}/${id}/contract`, {});

// ── Specialities + certifications ──────────────────────────
export const setSpeciality = (
  id: string,
  input: {
    service_key: string;
    display_name: string;
    rate: number;
    duration_minutes?: number;
  },
) => api.post<Speciality>(`${BASE}/${id}/specialities`, input);
export const removeSpeciality = (id: string, speciality_id: string) =>
  api.delete(`${BASE}/${id}/specialities/${speciality_id}`);
export const awardCertification = (
  id: string,
  input: {
    tier_key: string;
    expires_at: string;
    assessment_score?: number;
    assessment_notes?: string;
  },
) => api.post<Certification>(`${BASE}/${id}/certifications`, input);
export const revokeCertification = (id: string, certification_id: string) =>
  api.delete<Certification>(
    `${BASE}/${id}/certifications/${certification_id}`,
  );

// ── Applications & vetting ─────────────────────────────────
export const listApplications = (status?: string) =>
  api.get<ApplicationRow[]>(`${BASE}/applications/all${qs({ status })}`);
export const getApplication = (id: string) =>
  api.get<ApplicationDetail>(`${BASE}/applications/${id}`);
export const addVettingReview = (
  id: string,
  input: {
    rubric: { criterion: string; score: number; max: number }[];
    recommendation: "advance" | "reject" | "hold";
    notes?: string;
  },
) => api.post<VettingReview>(`${BASE}/applications/${id}/review`, input);
export const decideApplication = (
  id: string,
  input: {
    decision: "start_vetting" | "approve" | "reject";
    probation_months?: number;
    note?: string;
  },
) => api.post<Partner>(`${BASE}/applications/${id}/decision`, input);

// ── Assignments + routing ──────────────────────────────────
export const listAssignments = (params: {
  status?: string;
  stylist_id?: string;
}) => api.get<Assignment[]>(`${BASE}/assignments/all${qs(params)}`);
export const getAssignment = (id: string) =>
  api.get<AssignmentDetail>(`${BASE}/assignments/${id}`);
export const openAssignment = (input: Record<string, unknown>) =>
  api.post<Assignment & { offered_to: number }>(`${BASE}/assignments`, input);
export const cancelAssignment = (id: string, reason?: string) =>
  api.post<Assignment>(`${BASE}/assignments/${id}/cancel`, { reason });
export const addOffers = (id: string, stylist_ids: string[]) =>
  api.post<{ added: number }>(`${BASE}/assignments/${id}/offers`, {
    stylist_ids,
  });
export const disputeAssignment = (
  id: string,
  input: {
    action: "open" | "resolve";
    reason?: string;
    resolution?: string;
    outcome?: "release" | "uphold";
  },
) => api.post<Assignment>(`${BASE}/assignments/${id}/dispute`, input);
export const routingSuggest = (params: {
  service_key: string;
  city?: string;
  state?: string;
  country_code?: string;
}) => api.get<RoutingSuggestion>(`${BASE}/routing/suggest${qs(params)}`);

// ── Payouts ────────────────────────────────────────────────
export const listPayouts = (params: { stylist_id?: string; status?: string }) =>
  api.get<Payout[]>(`${BASE}/payouts/all${qs(params)}`);
export const getPayout = (id: string) =>
  api.get<Payout>(`${BASE}/payouts/${id}`);
export const generatePayout = (input: {
  stylist_id: string;
  period_start: string;
  period_end: string;
}) => api.post<Payout>(`${BASE}/payouts`, input);
export const submitPayout = (id: string) =>
  api.post<Payout>(`${BASE}/payouts/${id}/submit`, {});
export const approvePayout = (id: string) =>
  api.post<Payout>(`${BASE}/payouts/${id}/approve`, {});
export const markPayoutPaid = (id: string, transfer_code?: string) =>
  api.post<Payout>(`${BASE}/payouts/${id}/paid`, { transfer_code });

// ── Reviews + referrals ────────────────────────────────────
export const listReviews = (params: { stylist_id?: string; hidden?: boolean }) =>
  api.get<VerifiedReview[]>(`${BASE}/reviews/all${qs(params)}`);
export const setReviewVisibility = (assignment_id: string, hidden: boolean) =>
  api.post<Assignment>(`${BASE}/reviews/${assignment_id}/visibility`, {
    hidden,
  });
export const listAttributions = (params: {
  stylist_id?: string;
  status?: string;
}) => api.get<Attribution[]>(`${BASE}/referrals/all${qs(params)}`);

// ── Programme config ───────────────────────────────────────
export const getConfig = () =>
  api.get<ProgrammeConfig>(`${BASE}/config/programme`);
export const updateConfig = (patch: Record<string, unknown>) =>
  api.patch<ProgrammeConfig>(`${BASE}/config/programme`, patch);
export const listTiers = () => api.get<Tier[]>(`${BASE}/config/tiers`);
export const updateTier = (tier_key: string, patch: Record<string, unknown>) =>
  api.patch<Tier>(`${BASE}/config/tiers/${tier_key}`, patch);
export const listQuestions = () =>
  api.get<Question[]>(`${BASE}/config/questions`);
export const createQuestion = (input: Record<string, unknown>) =>
  api.post<Question>(`${BASE}/config/questions`, input);
export const updateQuestion = (
  question_id: string,
  patch: Record<string, unknown>,
) => api.patch<Question>(`${BASE}/config/questions/${question_id}`, patch);
