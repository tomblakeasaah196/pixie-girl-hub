import { api } from "@/lib/api";
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { useBusinessStore } from "@/stores/business";

// ──────────────────────────────────────────────────────────────────────────
// Phase 2 — Stylist-Partner programme (/stylists) and Ambassador overlay
// (/sales-campaigns/ambassadors). Kept in their own module so the core
// contacts API stays focused.
// ──────────────────────────────────────────────────────────────────────────

function useBiz() {
  return useBusinessStore((s) => s.activeKey);
}

// ── Ambassadors ───────────────────────────────────────────────────────────

export interface Ambassador {
  contact_id: string;
  display_name?: string;
  first_name?: string | null;
  last_name?: string | null;
  primary_phone?: string | null;
  email?: string | null;
  instagram_handle?: string | null;
  is_ambassador?: boolean;
  ambassador_profile?: {
    commission_pct?: number;
    social_handles?: Record<string, string>;
    [k: string]: unknown;
  } | null;
}

export interface PromoteAmbassadorInput {
  commission_pct?: number | null;
  social_handles?: Record<string, string>;
  notes?: string;
}

export const listAmbassadors = (q?: string) =>
  api.get<{ data: Ambassador[] }>(
    `/sales-campaigns/ambassadors${q ? `?q=${encodeURIComponent(q)}` : ""}`,
  );

export const promoteAmbassador = (
  contactId: string,
  input: PromoteAmbassadorInput,
) =>
  api.post<{ data: Ambassador }>(
    `/sales-campaigns/ambassadors/${contactId}/promote`,
    input,
  );

export const demoteAmbassador = (contactId: string) =>
  api.delete<void>(`/sales-campaigns/ambassadors/${contactId}`);

export function useAmbassadors(q?: string) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["ambassadors", biz, q ?? ""],
    queryFn: () => listAmbassadors(q),
    placeholderData: keepPreviousData,
  });
}

export function usePromoteAmbassador(contactId: string) {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (input: PromoteAmbassadorInput) =>
      promoteAmbassador(contactId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ambassadors", biz] });
      qc.invalidateQueries({ queryKey: ["contacts", biz] });
    },
  });
}

export function useDemoteAmbassador(contactId: string) {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: () => demoteAmbassador(contactId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ambassadors", biz] });
      qc.invalidateQueries({ queryKey: ["contacts", biz] });
    },
  });
}

// ── Stylist Partners ──────────────────────────────────────────────────────

export interface StylistPartner {
  stylist_id: string;
  partner_code: string;
  contact_id: string;
  display_name: string;
  status:
    | "applicant"
    | "vetting"
    | "vetted"
    | "certified"
    | "suspended"
    | "terminated";
  country_code: string | null;
  city: string | null;
  state: string | null;
  current_tier_key: string | null;
  current_tier_expires_at: string | null;
  badge_token: string | null;
  badge_revoked_at: string | null;
  current_active_count?: number | null;
  max_active_assignments?: number | null;
  bio?: string | null;
  created_at: string;
}

export interface StylistCertification {
  certification_id: string;
  stylist_id: string;
  tier_key: string;
  awarded_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface StylistPayout {
  payout_id: string;
  stylist_id: string;
  period_start: string;
  period_end: string;
  amount?: string | number;
  net_payable?: string | number;
  status: string;
}

export interface StylistAssignment {
  assignment_id?: string;
  job_id?: string;
  stylist_id: string;
  customer_contact_id?: string | null;
  status: string;
  scheduled_for?: string | null;
  agreed_cost_ngn?: string | number | null;
}

const S = "/stylists";

export const listStylists = (params: {
  status?: string;
  city?: string;
  country_code?: string;
  contact_id?: string;
} = {}) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, String(v));
  const s = q.toString();
  return api.get<{ data: StylistPartner[] }>(`${S}${s ? `?${s}` : ""}`);
};

export const getStylist = (id: string) =>
  api.get<StylistPartner>(`${S}/${id}`);

export interface CreateStylistInput {
  contact_id: string;
  display_name: string;
  country_code: string;
  city: string;
  state?: string;
}

export const createStylist = (input: CreateStylistInput) =>
  api.post<StylistPartner>(S, input);

export const listStylistCertifications = (id: string) =>
  api.get<{ data: StylistCertification[] }>(`${S}/${id}/certifications`);

export const listStylistPayouts = (stylistId: string) =>
  api.get<{ data: StylistPayout[] }>(`${S}/payouts/all?stylist_id=${stylistId}`);

export const listStylistAssignments = (stylistId: string) =>
  api.get<{ data: StylistAssignment[] }>(
    `${S}/assignments/all?stylist_id=${stylistId}`,
  );

export function useStylists(
  params: Parameters<typeof listStylists>[0] = {},
) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["stylists", biz, params],
    queryFn: () => listStylists(params),
    placeholderData: keepPreviousData,
  });
}

/** Resolve the stylist record for a contact (null if not in the programme). */
export function useStylistByContact(contactId: string | null) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["stylists", biz, "by-contact", contactId],
    queryFn: async () => {
      const res = await listStylists({ contact_id: contactId! });
      return res.data?.[0] ?? null;
    },
    enabled: !!contactId,
  });
}

export function useCreateStylist() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (input: CreateStylistInput) => createStylist(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stylists", biz] });
    },
  });
}

export function useStylistCertifications(stylistId: string | null) {
  return useQuery({
    queryKey: ["stylists", "certifications", stylistId],
    queryFn: () => listStylistCertifications(stylistId!),
    enabled: !!stylistId,
  });
}

export function useStylistPayouts(stylistId: string | null) {
  return useQuery({
    queryKey: ["stylists", "payouts", stylistId],
    queryFn: () => listStylistPayouts(stylistId!),
    enabled: !!stylistId,
  });
}

export function useStylistAssignments(stylistId: string | null) {
  return useQuery({
    queryKey: ["stylists", "assignments", stylistId],
    queryFn: () => listStylistAssignments(stylistId!),
    enabled: !!stylistId,
  });
}
