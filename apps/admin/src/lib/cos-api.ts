/**
 * Chief of Staff API client (PR3).
 *
 * Mirrors praxis-api for the /cos/* surface: CoS conversations + message turns,
 * and the BATCH-PLAN approval gate (confirm / reject the whole plan at once).
 * One turn = POST message → { user_message, assistant_message, plan } — the
 * plan (when present) carries its ordered steps for the BatchPlanCard.
 *
 * Per-USER, like Praxis (conversations belong to the CEO, not the brand), so
 * the query keys carry no brand segment — matching the backend's user scoping.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toastReport } from "@/lib/error-report";

// ── Types (mirror shared.ai_* tables) ─────────────────────

export type PlanStatus =
  | "proposed"
  | "confirmed"
  | "executing"
  | "executed"
  | "partially_failed"
  | "rejected"
  | "expired"
  | "cancelled";

export type StepStatus =
  | "proposed"
  | "confirmed"
  | "executed"
  | "failed"
  | "cancelled"
  | "expired";

export interface CosConversation {
  conversation_id: string;
  title: string | null;
  business: string | null;
  is_voice_started: boolean;
  last_activity_at: string;
  message_count?: number;
}

export interface CosMessage {
  message_id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string | null;
  input_mode?: "text" | "voice" | null;
  transcribed_text?: string | null;
  created_at: string;
}

export interface PlanStep {
  pending_id: string;
  plan_id: string;
  plan_step: number;
  action_key: string;
  human_summary: string | null;
  method: string;
  route: string;
  payload: Record<string, unknown> | null;
  status: StepStatus;
  execution_error?: string | null;
  execution_result?: unknown;
}

export interface Plan {
  plan_id: string;
  conversation_id: string;
  business: string | null;
  title: string;
  summary: string;
  status: PlanStatus;
  expires_at: string;
  created_at: string;
  steps: PlanStep[];
}

export interface CosConversationDetail extends CosConversation {
  messages: CosMessage[];
  plans: Plan[];
}

export interface CosTurnResult {
  user_message: CosMessage;
  assistant_message: CosMessage;
  plan: Plan | null;
}

// ── Query keys ─────────────────────────────────────────────
export const cosKeys = {
  conversations: ["cos", "conversations"] as const,
  conversation: (id: string) => ["cos", "conversation", id] as const,
};

// ── Hooks ──────────────────────────────────────────────────
export function useCosConversations() {
  return useQuery({
    queryKey: cosKeys.conversations,
    queryFn: () => api.get<CosConversation[]>("/cos/conversations"),
  });
}

export function useCosConversation(id: string | null) {
  return useQuery({
    queryKey: cosKeys.conversation(id ?? "none"),
    queryFn: () => api.get<CosConversationDetail>(`/cos/conversations/${id}`),
    enabled: !!id,
  });
}

export function useCreateCosConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input?: { title?: string; is_voice_started?: boolean }) =>
      api.post<CosConversation>("/cos/conversations", input ?? {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: cosKeys.conversations }),
  });
}

export function useArchiveCosConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/cos/conversations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: cosKeys.conversations }),
  });
}

export interface PostCosMessageVars {
  conversationId: string;
  content: string;
  input_mode?: "text" | "voice";
  transcribed_text?: string;
}

export function usePostCosMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, ...input }: PostCosMessageVars) =>
      api.post<CosTurnResult>(
        `/cos/conversations/${conversationId}/messages`,
        input,
      ),
    onSuccess: (turn, vars) => {
      qc.setQueryData<CosConversationDetail | undefined>(
        cosKeys.conversation(vars.conversationId),
        (prev) =>
          prev
            ? {
                ...prev,
                messages: [
                  ...prev.messages,
                  turn.user_message,
                  turn.assistant_message,
                ],
                plans: turn.plan ? [turn.plan, ...prev.plans] : prev.plans,
              }
            : prev,
      );
      qc.invalidateQueries({ queryKey: cosKeys.conversations });
    },
  });
}

/** Fold an updated plan (post confirm/reject) back into the cached detail. */
function patchPlan(
  qc: ReturnType<typeof useQueryClient>,
  conversationId: string,
  updated: Plan,
) {
  qc.setQueryData<CosConversationDetail | undefined>(
    cosKeys.conversation(conversationId),
    (prev) =>
      prev
        ? {
            ...prev,
            plans: prev.plans.map((p) =>
              p.plan_id === updated.plan_id ? { ...p, ...updated } : p,
            ),
          }
        : prev,
  );
}

export function useConfirmCosPlan(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (planId: string) =>
      api.post<Plan>(`/cos/plans/${planId}/confirm`),
    onSuccess: (updated) => {
      patchPlan(qc, conversationId, updated);
      // A batch write touched goals/tasks/calendar — refresh those surfaces.
      qc.invalidateQueries({ queryKey: ["workspace"] });
    },
    onError: (err) => toastReport("Chief of Staff → Plan", "Approve plan", err),
  });
}

export function useRejectCosPlan(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ planId, reason }: { planId: string; reason?: string }) =>
      api.post<Plan>(`/cos/plans/${planId}/reject`, { reason }),
    onSuccess: (updated) => patchPlan(qc, conversationId, updated),
    onError: (err) => toastReport("Chief of Staff → Plan", "Reject plan", err),
  });
}

// ── Follow-ups (accountability loop, PR4) ──────────────────

export type FollowupState =
  | "open"
  | "asked"
  | "answered"
  | "resolved"
  | "snoozed"
  | "dismissed";
export type FollowupAnswer = "done" | "in_progress" | "delayed";
export type FollowupTrigger =
  | "due_tomorrow"
  | "due_today"
  | "overdue"
  | "no_progress"
  | "slippage"
  | "weekly_review";
export type SuggestionKind =
  | "move_deadline"
  | "reschedule_dependents"
  | "notify_stakeholder";

export interface SuggestedAction {
  label: string;
  kind: SuggestionKind;
  payload?: { days?: number };
}

export interface CosFollowup {
  followup_id: string;
  business: string;
  user_id: string;
  subject_type: "goal" | "milestone" | "task";
  subject_id: string;
  trigger: FollowupTrigger;
  state: FollowupState;
  question: string | null;
  answer: FollowupAnswer | null;
  reason: string | null;
  suggested_actions: SuggestedAction[];
  notification_id: string | null;
  snooze_until: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RespondResult {
  followup: CosFollowup;
  question: string | null;
  subject_result?: unknown;
}
export interface ReasonResult {
  followup: CosFollowup;
  suggested_actions: SuggestedAction[];
}
export interface ActResult {
  followup: CosFollowup;
  plan?: Plan | null;
  notified?: number;
}

export const followupKeys = {
  list: ["cos", "followups"] as const,
  forSubject: (t?: string, id?: string) =>
    ["cos", "followups", t ?? "all", id ?? "all"] as const,
};

/** Open follow-ups, optionally scoped to a subject (goal/milestone/task). */
export function useCosFollowups(params?: {
  subject_type?: string;
  subject_id?: string;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: followupKeys.forSubject(params?.subject_type, params?.subject_id),
    queryFn: () => {
      const qs = new URLSearchParams();
      if (params?.subject_type) qs.set("subject_type", params.subject_type);
      if (params?.subject_id) qs.set("subject_id", params.subject_id);
      const q = qs.toString();
      return api.get<CosFollowup[]>(`/cos/followups${q ? `?${q}` : ""}`);
    },
    enabled: params?.enabled ?? true,
  });
}

function invalidateFollowups(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: followupKeys.list });
  qc.invalidateQueries({ queryKey: ["notifications"] });
  qc.invalidateQueries({ queryKey: ["workspace"] });
}

/** POST an answer to a follow-up (via the endpoint carried on the action). */
export function useRespondFollowup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      endpoint,
      answer,
    }: {
      endpoint: string;
      answer: FollowupAnswer;
    }) => api.post<RespondResult>(endpoint, { answer }),
    onSuccess: () => invalidateFollowups(qc),
    onError: (err) => toastReport("Chief of Staff → Follow-up", "Respond", err),
  });
}

export function useReasonFollowup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post<ReasonResult>(`/cos/followups/${id}/reason`, { reason }),
    onSuccess: () => invalidateFollowups(qc),
    onError: (err) => toastReport("Chief of Staff → Follow-up", "Reason", err),
  });
}

export function useActFollowup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: SuggestedAction }) =>
      api.post<ActResult>(`/cos/followups/${id}/act`, { action }),
    onSuccess: () => invalidateFollowups(qc),
    onError: (err) => toastReport("Chief of Staff → Follow-up", "Act", err),
  });
}

export function useSnoozeFollowup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, until }: { id: string; until?: string }) =>
      api.post<{ followup: CosFollowup }>(`/cos/followups/${id}/snooze`, { until }),
    onSuccess: () => invalidateFollowups(qc),
    onError: (err) => toastReport("Chief of Staff → Follow-up", "Snooze", err),
  });
}

export function useDismissFollowup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      api.post<{ followup: CosFollowup }>(`/cos/followups/${id}/dismiss`),
    onSuccess: () => invalidateFollowups(qc),
    onError: (err) => toastReport("Chief of Staff → Follow-up", "Dismiss", err),
  });
}

/** Pull the follow-up id out of a respond endpoint (…/followups/:id/respond). */
export function followupIdFromEndpoint(endpoint: string): string | null {
  const m = endpoint.match(/followups\/([^/]+)\//);
  return m ? m[1] : null;
}
