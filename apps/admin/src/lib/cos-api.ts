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
