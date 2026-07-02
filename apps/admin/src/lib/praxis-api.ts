/**
 * Praxis AI Agent API client (V2.2 §6.29).
 *
 * Conversations + message turns, the human-in-the-loop pending-action gate
 * (list / confirm / reject), the run-step trace, and the ai_enabled action
 * catalogue. One turn = POST message → { user_message, assistant_message,
 * pending_action } in a single response (no streaming yet — the send
 * mutation shows a thinking indicator until the reply lands).
 *
 * Realtime: usePraxisRealtime joins user:{id}:ai_pending and invalidates the
 * pending/conversation queries on ai_pending:created / :resolved pushes.
 */

import { useEffect } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import { joinRoom, leaveRoom, rooms } from "@/lib/socket";

// ── Types (mirror shared.ai_* tables) ─────────────────────

export type PendingStatus =
  | "proposed"
  | "confirmed"
  | "executed"
  | "failed"
  | "rejected"
  | "expired";

export interface PraxisConversation {
  conversation_id: string;
  title: string | null;
  business: string | null;
  is_voice_started: boolean;
  provider?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PraxisMessage {
  message_id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string | null;
  input_mode?: "text" | "voice" | null;
  transcribed_text?: string | null;
  created_at: string;
}

export interface PendingAction {
  pending_id: string;
  conversation_id: string | null;
  message_id: string | null;
  action_key: string;
  business: string | null;
  method: string;
  route: string;
  payload: Record<string, unknown> | null;
  human_summary: string | null;
  confidence: string | number | null;
  status: PendingStatus;
  expires_at: string;
  created_at: string;
  execution_result?: unknown;
  execution_error?: string | null;
  rejection_reason?: string | null;
  executed_at?: string | null;
}

export interface ConversationDetail extends PraxisConversation {
  messages: PraxisMessage[];
  pending_actions: PendingAction[];
}

export interface RunStep {
  step_id: string;
  conversation_id: string;
  agent: string;
  step_number: number;
  step_type: string;
  status: string;
  output?: unknown;
  error_message?: string | null;
  duration_ms?: number | null;
  created_at: string;
}

export interface CatalogueAction {
  action_id: string;
  action_key: string;
  title: string | null;
  description: string | null;
  http_method: string;
  route: string;
  module: string | null;
  is_write: boolean;
  required_permission?: string | null;
}

export interface TurnResult {
  user_message: PraxisMessage;
  assistant_message: PraxisMessage;
  pending_action: PendingAction | null;
}

// ── Query keys ─────────────────────────────────────────────
// Praxis data is per-USER (conversations belong to the asking user, not the
// brand), so keys carry no brand segment — deliberate exception to the
// entity-scope rule, matching the backend's user_id scoping.

export const praxisKeys = {
  conversations: ["praxis", "conversations"] as const,
  conversation: (id: string) => ["praxis", "conversation", id] as const,
  pending: (status?: string) => ["praxis", "pending", status ?? "all"] as const,
  steps: (id: string) => ["praxis", "steps", id] as const,
  actions: ["praxis", "actions"] as const,
};

// ── Hooks ──────────────────────────────────────────────────

export function useConversations() {
  return useQuery({
    queryKey: praxisKeys.conversations,
    queryFn: () => api.get<PraxisConversation[]>("/praxis/conversations"),
  });
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: praxisKeys.conversation(id ?? "none"),
    queryFn: () => api.get<ConversationDetail>(`/praxis/conversations/${id}`),
    enabled: !!id,
  });
}

export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input?: { title?: string; is_voice_started?: boolean }) =>
      api.post<PraxisConversation>("/praxis/conversations", input ?? {}),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: praxisKeys.conversations }),
  });
}

export function useArchiveConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/praxis/conversations/${id}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: praxisKeys.conversations }),
  });
}

export function usePostMessage(conversationId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      content: string;
      input_mode?: "text" | "voice";
      transcribed_text?: string;
    }) =>
      api.post<TurnResult>(
        `/praxis/conversations/${conversationId}/messages`,
        input,
      ),
    onSuccess: (turn) => {
      if (!conversationId) return;
      // Fold the whole turn into the cached detail — no refetch flicker.
      qc.setQueryData<ConversationDetail | undefined>(
        praxisKeys.conversation(conversationId),
        (prev) =>
          prev
            ? {
                ...prev,
                messages: [
                  ...prev.messages,
                  turn.user_message,
                  turn.assistant_message,
                ],
                pending_actions: turn.pending_action
                  ? [turn.pending_action, ...prev.pending_actions]
                  : prev.pending_actions,
              }
            : prev,
      );
      qc.invalidateQueries({ queryKey: praxisKeys.conversations });
      if (turn.pending_action)
        qc.invalidateQueries({ queryKey: ["praxis", "pending"] });
    },
  });
}

export function usePendingActions(status?: PendingStatus) {
  return useQuery({
    queryKey: praxisKeys.pending(status),
    queryFn: () =>
      api.get<PendingAction[]>(
        `/praxis/pending-actions${status ? `?status=${status}` : ""}`,
      ),
  });
}

function patchPendingEverywhere(
  qc: ReturnType<typeof useQueryClient>,
  updated: PendingAction,
) {
  qc.invalidateQueries({ queryKey: ["praxis", "pending"] });
  if (updated.conversation_id) {
    qc.setQueryData<ConversationDetail | undefined>(
      praxisKeys.conversation(updated.conversation_id),
      (prev) =>
        prev
          ? {
              ...prev,
              pending_actions: prev.pending_actions.map((p) =>
                p.pending_id === updated.pending_id ? updated : p,
              ),
            }
          : prev,
    );
  }
}

export function useConfirmAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<PendingAction>(`/praxis/pending-actions/${id}/confirm`),
    onSuccess: (updated) => patchPendingEverywhere(qc, updated),
    onError: () => qc.invalidateQueries({ queryKey: ["praxis"] }),
  });
}

export function useRejectAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.post<PendingAction>(`/praxis/pending-actions/${id}/reject`, {
        reason,
      }),
    onSuccess: (updated) => patchPendingEverywhere(qc, updated),
  });
}

export function useRunSteps(conversationId: string | null) {
  return useQuery({
    queryKey: praxisKeys.steps(conversationId ?? "none"),
    queryFn: () =>
      api.get<RunStep[]>(`/praxis/conversations/${conversationId}/steps`),
    enabled: !!conversationId,
  });
}

export function useEnabledActions() {
  return useQuery({
    queryKey: praxisKeys.actions,
    queryFn: () => api.get<CatalogueAction[]>("/praxis/actions"),
    staleTime: 5 * 60_000, // the allowlist changes rarely (AI Control edits)
  });
}

// ── Realtime ───────────────────────────────────────────────

/**
 * Join user:{id}:ai_pending and refresh the pending/conversation queries on
 * pushes. Mounted once (the drawer mounts globally), so every Praxis surface
 * stays live — including expiries swept by the worker.
 */
export function usePraxisRealtime() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const qc = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    const room = rooms.userAiPending(userId);
    joinRoom(room);

    const refresh = () => {
      qc.invalidateQueries({ queryKey: ["praxis", "pending"] });
      qc.invalidateQueries({ queryKey: ["praxis", "conversation"] });
    };
    window.addEventListener("pgh:ai_pending:created", refresh);
    window.addEventListener("pgh:ai_pending:resolved", refresh);
    return () => {
      window.removeEventListener("pgh:ai_pending:created", refresh);
      window.removeEventListener("pgh:ai_pending:resolved", refresh);
      leaveRoom(room);
    };
  }, [userId, qc]);
}
