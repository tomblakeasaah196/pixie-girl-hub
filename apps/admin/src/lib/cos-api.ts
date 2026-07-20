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

export type FeedbackRating = "up" | "down";

export interface MessageFeedback {
  rating: FeedbackRating;
  comment: string | null;
}

export interface CosMessage {
  message_id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string | null;
  input_mode?: "text" | "voice" | null;
  transcribed_text?: string | null;
  created_at: string;
  /** The CEO's rating of this reply, if any (training loop) — hydrated on load. */
  feedback?: MessageFeedback | null;
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
  /** Review-time validation warning from pre-flight (shown before approval). */
  preflight_note?: string | null;
}

export interface Plan {
  plan_id: string;
  conversation_id: string;
  business: string | null;
  title: string;
  summary: string;
  status: PlanStatus;
  /** false while the model still owes steps — the card offers "Continue building". */
  is_complete: boolean;
  /** Assistant message this plan is rendered under; null → end of thread. */
  anchor_message_id?: string | null;
  expires_at: string;
  created_at: string;
  steps: PlanStep[];
}

export interface SavedNoteRef {
  note_id: string;
  title: string | null;
  updated_at: string;
}

export interface CosConversationDetail extends CosConversation {
  messages: CosMessage[];
  plans: Plan[];
  /** Populated when the CEO has already saved this conversation to Notes. */
  saved_note: SavedNoteRef | null;
}

/**
 * Attached to a turn whose reply stopped short of finishing the work, so the
 * UI can offer one-tap continuation instead of making the CEO type "go ahead":
 *   - reprompt: the model promised action but queued nothing — the button
 *     re-sends `suggested_reply` as the next message.
 *   - continue_plan: the plan persisted incomplete — the plan card's
 *     "Continue building" (POST /plans/:id/continue) picks it up.
 */
export interface CosContinuation {
  kind: "reprompt" | "continue_plan";
  label: string;
  suggested_reply?: string;
  plan_id?: string;
}

export interface CosTurnResult {
  user_message: CosMessage;
  assistant_message: CosMessage;
  plan: Plan | null;
  continuation?: CosContinuation | null;
}

export interface SaveConversationNoteResult {
  note: {
    note_id: string;
    title: string | null;
    body: string;
    updated_at: string;
  };
  action: "created" | "updated";
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
    onError: (err) => toastReport("Chief of Staff", "Start conversation", err),
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
    // Optimistic echo: the CEO's bubble appears the instant she hits send —
    // the turn itself (LLM rounds + reads) can take many seconds, and a chat
    // where your own message doesn't show until the reply lands reads as
    // "did that even send?". The temp message is swapped for the server's
    // real one on success and removed on error (the composer restores the
    // draft, so nothing is lost).
    onMutate: async ({ conversationId, content }: PostCosMessageVars) => {
      const key = cosKeys.conversation(conversationId);
      // Cancel a racing refetch only when we hold data to protect — cancelling
      // a brand-new conversation's FIRST fetch would leave its pane stuck on
      // the loading skeleton for the whole turn (there the echo is skipped;
      // the fetch lands the empty thread and the Thinking bubble covers it).
      if (qc.getQueryData(key)) await qc.cancelQueries({ queryKey: key });
      const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      qc.setQueryData<CosConversationDetail | undefined>(key, (prev) =>
        prev
          ? {
              ...prev,
              messages: [
                ...prev.messages,
                {
                  message_id: tempId,
                  conversation_id: conversationId,
                  role: "user",
                  content,
                  created_at: new Date().toISOString(),
                } as CosMessage,
              ],
            }
          : prev,
      );
      return { tempId };
    },
    onSuccess: (turn, vars, ctx) => {
      qc.setQueryData<CosConversationDetail | undefined>(
        cosKeys.conversation(vars.conversationId),
        (prev) =>
          prev
            ? {
                ...prev,
                messages: [
                  ...prev.messages.filter((m) => m.message_id !== ctx?.tempId),
                  turn.user_message,
                  turn.assistant_message,
                ],
                plans: turn.plan ? [turn.plan, ...prev.plans] : prev.plans,
              }
            : prev,
      );
      // No cached detail to patch (first message raced the initial fetch) —
      // refetch so the turn's messages appear.
      if (!qc.getQueryData(cosKeys.conversation(vars.conversationId))) {
        qc.invalidateQueries({
          queryKey: cosKeys.conversation(vars.conversationId),
        });
      }
      qc.invalidateQueries({ queryKey: cosKeys.conversations });
    },
    onError: (err, vars, ctx) => {
      qc.setQueryData<CosConversationDetail | undefined>(
        cosKeys.conversation(vars.conversationId),
        (prev) =>
          prev
            ? {
                ...prev,
                messages: prev.messages.filter(
                  (m) => m.message_id !== ctx?.tempId,
                ),
              }
            : prev,
      );
      toastReport("Chief of Staff", "Send message", err);
    },
  });
}

/**
 * Summarise a CoS conversation and upsert it into Workspace Notes. Server
 * enforces "one CoS note per conversation" — subsequent calls update the
 * same note in place (see migration 000329). Refreshes the conversation
 * detail (so saved_note reflects the new state) and the notes list.
 */
export function useSaveConversationToNotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) =>
      api.post<SaveConversationNoteResult>(
        `/cos/conversations/${conversationId}/save-note`,
      ),
    onSuccess: (result, conversationId) => {
      qc.setQueryData<CosConversationDetail | undefined>(
        cosKeys.conversation(conversationId),
        (prev) =>
          prev
            ? {
                ...prev,
                saved_note: {
                  note_id: result.note.note_id,
                  title: result.note.title,
                  updated_at: result.note.updated_at,
                },
              }
            : prev,
      );
      // The Notes tab reads from its own workspace query key namespace.
      qc.invalidateQueries({ queryKey: ["workspace"] });
    },
    onError: (err) => toastReport("Chief of Staff", "Save to notes", err),
  });
}

export interface SendCosFeedbackVars {
  conversationId: string;
  messageId: string;
  rating: FeedbackRating;
  comment?: string;
}

/**
 * Rate a Chief of Staff reply 👍/👎 (Phase 1 training loop). A 👎 with a comment
 * is stored as a durable correction the next turn respects. Optimistically folds
 * the rating into the cached conversation so the thumbs reflect it immediately.
 */
export function useSendCosFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, rating, comment }: SendCosFeedbackVars) =>
      api.post<{ ok: boolean; rating: FeedbackRating; learned: boolean }>(
        `/cos/messages/${messageId}/feedback`,
        { rating, comment },
      ),
    onMutate: ({ conversationId, messageId, rating, comment }) => {
      qc.setQueryData<CosConversationDetail | undefined>(
        cosKeys.conversation(conversationId),
        (prev) =>
          prev
            ? {
                ...prev,
                messages: prev.messages.map((m) =>
                  m.message_id === messageId
                    ? {
                        ...m,
                        feedback: {
                          rating,
                          comment: comment ?? m.feedback?.comment ?? null,
                        },
                      }
                    : m,
                ),
              }
            : prev,
      );
    },
    onError: (err) => toastReport("Chief of Staff", "Send feedback", err),
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
      // 202: the steps run on a background worker — `updated` arrives as
      // status 'executing' and the card settles to executed/partially_failed
      // via the cos_plan:executed push (useRealtimeInvalidation).
      patchPlan(qc, conversationId, updated);
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

/**
 * Resume building a truncated plan (is_complete=false): the CoS appends the
 * owed steps to the SAME plan. Returns the refreshed plan incl. all steps.
 */
export function useContinueCosPlan(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (planId: string) =>
      api.post<Plan>(`/cos/plans/${planId}/continue`),
    onSuccess: (updated) => patchPlan(qc, conversationId, updated),
    onError: (err) =>
      toastReport("Chief of Staff → Plan", "Continue building", err),
  });
}

/** Edit a step's payload before firing (or after a failure, then retry). */
export function useUpdateCosPlanStep(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      planId,
      stepId,
      payload,
    }: {
      planId: string;
      stepId: string;
      payload: Record<string, unknown>;
    }) => api.patch<Plan>(`/cos/plans/${planId}/steps/${stepId}`, { payload }),
    onSuccess: (updated) => patchPlan(qc, conversationId, updated),
    onError: (err) => toastReport("Chief of Staff → Plan", "Edit step", err),
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
      api.post<{ followup: CosFollowup }>(`/cos/followups/${id}/snooze`, {
        until,
      }),
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

// ── Intelligence (PR5): memory, meetings, scheduling, cross-brand, templates ──

export interface MeetingPrep {
  event: {
    event_id: string;
    title: string;
    event_type: string;
    start_at: string;
    end_at: string;
    location: string | null;
  };
  goal: {
    goal_id: string;
    title: string;
    status: string;
    health: string;
    progress_pct: number;
    target_date: string | null;
  } | null;
  open_milestones: {
    milestone_id: string;
    title: string;
    status: string;
    target_date: string | null;
  }[];
  recent_notes: {
    note_id: string;
    title: string | null;
    excerpt: string;
    created_at: string;
  }[];
  participants: {
    participant_id: string;
    name: string;
    email: string | null;
    is_organiser: boolean;
    status: string;
    kind: "user" | "contact";
  }[];
  open_questions: string[];
}

export interface ScheduleSlot {
  start_at: string;
  end_at: string;
}
export interface FocusResult {
  slots: ScheduleSlot[];
  plan: Plan | null;
}
export interface LoadSummary {
  date: string;
  meeting_hours: number;
  meetings: number;
  high_priority_tasks: number;
  overloaded: boolean;
  thresholds: { meeting_hours: number; high_priority_tasks: number };
}

export interface CrossBrandBrand {
  business: string;
  display_name: string;
  active_goals: number;
  on_track: number;
  at_risk: number;
  behind: number;
  achieved: number;
  avg_progress: number;
  overdue_milestones: number;
  overdue_tasks: number;
  overdue_total: number;
  headline: string;
}
export interface CrossBrandOverview {
  brands: CrossBrandBrand[];
  totals: {
    active_goals: number;
    at_risk: number;
    behind: number;
    overdue_total: number;
  };
  generated_at: string;
}

export interface GoalTemplate {
  template_id: string;
  business: string | null;
  name: string;
  description: string | null;
  structure: {
    goal?: { priority?: string };
    milestones?: {
      title: string;
      offset_days: number;
      tasks?: { title: string; offset_days: number }[];
    }[];
    tasks?: { title: string; offset_days: number }[];
  };
  source_goal_id: string | null;
  source_goal_title?: string | null;
  usage_count: number;
  created_at: string;
}

export const intelKeys = {
  crossBrand: ["cos", "cross-brand"] as const,
  templates: ["cos", "templates"] as const,
  prep: (id: string) => ["cos", "prep", id] as const,
  load: (d: string) => ["cos", "schedule", "load", d] as const,
};

export function useCrossBrandOverview(enabled = true) {
  return useQuery({
    queryKey: intelKeys.crossBrand,
    queryFn: () => api.get<CrossBrandOverview>("/cos/cross-brand/overview"),
    enabled,
  });
}

export function useCosTemplates(enabled = true) {
  return useQuery({
    queryKey: intelKeys.templates,
    queryFn: () => api.get<GoalTemplate[]>("/cos/templates"),
    enabled,
  });
}

export function useCosPrep(eventId: string | null) {
  return useQuery({
    queryKey: intelKeys.prep(eventId ?? "none"),
    queryFn: () => api.get<MeetingPrep>(`/cos/prep/${eventId}`),
    enabled: !!eventId,
  });
}

export function useScheduleLoad(date?: string, enabled = true) {
  const d = date ?? new Date().toISOString().slice(0, 10);
  return useQuery({
    queryKey: intelKeys.load(d),
    queryFn: () => api.get<LoadSummary>(`/cos/schedule/load?date=${d}`),
    enabled,
  });
}

export function useFindFocus() {
  return useMutation({
    mutationFn: (input: { duration?: number; within?: number }) =>
      api.post<FocusResult>("/cos/schedule/focus", input),
    onError: (err) =>
      toastReport("Chief of Staff → Scheduling", "Find focus time", err),
  });
}

export function useBatchReschedule() {
  return useMutation({
    mutationFn: (input: { match: string; days?: number }) =>
      api.post<Plan>("/cos/schedule/reschedule", input),
    onError: (err) =>
      toastReport("Chief of Staff → Scheduling", "Reschedule tasks", err),
  });
}

export function useSaveTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      goal_id: string;
      name?: string;
      description?: string;
    }) => api.post<GoalTemplate>("/cos/templates", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: intelKeys.templates }),
    onError: (err) =>
      toastReport("Chief of Staff → Playbooks", "Save as playbook", err),
  });
}

export function useInstantiateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      templateId,
      ...input
    }: {
      templateId: string;
      start_date?: string;
      name?: string;
    }) => api.post<Plan>(`/cos/templates/${templateId}/instantiate`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: intelKeys.templates }),
    onError: (err) =>
      toastReport("Chief of Staff → Playbooks", "Use playbook", err),
  });
}

// ── Settings / personalisation (PR6) ───────────────────────

export type CosTone = "warm" | "concise" | "formal";
export type CosPronoun = "she" | "he" | "they" | "it";

export interface CosSettings {
  user_id: string;
  assistant_name: string;
  tone: CosTone;
  avatar_url: string | null;
  pronoun: CosPronoun;
  work_start: string; // "HH:MM[:SS]"
  work_end: string;
  timezone: string;
  morning_brief_at: string;
  evening_review_at: string;
  quiet_start: string;
  quiet_end: string;
  celebrate_wins: boolean;
  adaptive_timing: boolean;
}

export type CosSettingsPatch = Partial<Omit<CosSettings, "user_id">>;

export const cosSettingsKey = ["cos", "settings"] as const;

/** The CEO's Chief of Staff personalisation (name/tone/hours/toggles). */
export function useCosSettings(enabled = true) {
  return useQuery({
    queryKey: cosSettingsKey,
    queryFn: () => api.get<CosSettings>("/cos/settings"),
    enabled,
    staleTime: 60_000,
  });
}

/**
 * Upload an image file to use as the assistant's avatar (alternative to pasting
 * a URL). The server compresses + stores it and persists the URL on the CoS
 * settings row; the returned URL is cache-busted so a re-upload takes effect.
 */
export async function uploadCosAvatar(
  blob: Blob,
  onProgress?: (percent: number) => void,
): Promise<{ avatar_url: string }> {
  const form = new FormData();
  form.append("avatar", blob, "cos-avatar.jpg");
  return api.postForm<{ avatar_url: string }>("/cos/settings/avatar", form, {
    onProgress,
  });
}

export function useUpdateCosSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: CosSettingsPatch) =>
      api.put<CosSettings>("/cos/settings", patch),
    onSuccess: (updated) => {
      qc.setQueryData(cosSettingsKey, updated);
      // The assistant name drives the Workspace tab label + chat header.
      qc.invalidateQueries({ queryKey: cosSettingsKey });
    },
    onError: (err) =>
      toastReport("Chief of Staff → Settings", "Save settings", err),
  });
}
