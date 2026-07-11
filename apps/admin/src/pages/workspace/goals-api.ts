import { api } from "@/lib/api";
import type {
  Goal,
  GoalCreateInput,
  GoalUpdateInput,
  Milestone,
  MilestoneInput,
  MilestoneUpdateInput,
  Note,
  NoteInput,
} from "./goals-types";

const G = "/goals";
const N = "/notes";

function qs(params: Record<string, unknown>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

// ── Goals ────────────────────────────────────────────────────────────────

export interface GoalListParams {
  status?: string;
  priority?: string;
  owner?: string;
  q?: string;
  target_before?: string;
  target_after?: string;
  page?: number;
  page_size?: number;
}

export const listGoals = (params: GoalListParams = {}) =>
  api.get<Goal[]>(`${G}${qs({ ...params })}`);

export const getGoal = (id: string) => api.get<Goal>(`${G}/${id}`);

export const createGoal = (input: GoalCreateInput) =>
  api.post<Goal>(G, input);

export const updateGoal = (id: string, input: GoalUpdateInput) =>
  api.patch<Goal>(`${G}/${id}`, input);

export const deleteGoal = (id: string) => api.delete<void>(`${G}/${id}`);

// ── Milestones ───────────────────────────────────────────────────────────

export const addMilestone = (goalId: string, input: MilestoneInput) =>
  api.post<Milestone>(`${G}/${goalId}/milestones`, input);

export const updateMilestone = (
  goalId: string,
  milestoneId: string,
  input: MilestoneUpdateInput,
) => api.patch<Milestone>(`${G}/${goalId}/milestones/${milestoneId}`, input);

export const deleteMilestone = (goalId: string, milestoneId: string) =>
  api.delete<void>(`${G}/${goalId}/milestones/${milestoneId}`);

// ── Linking existing tasks / events ──────────────────────────────────────

export const linkTask = (
  goalId: string,
  taskId: string,
  milestone_id?: string | null,
) => api.post<void>(`${G}/${goalId}/tasks/${taskId}/link`, { milestone_id });

export const unlinkTask = (goalId: string, taskId: string) =>
  api.delete<void>(`${G}/${goalId}/tasks/${taskId}/link`);

export const linkEvent = (
  goalId: string,
  eventId: string,
  milestone_id?: string | null,
) => api.post<void>(`${G}/${goalId}/events/${eventId}/link`, { milestone_id });

export const unlinkEvent = (goalId: string, eventId: string) =>
  api.delete<void>(`${G}/${goalId}/events/${eventId}/link`);

// ── Notes ────────────────────────────────────────────────────────────────

export interface NoteListParams {
  goal_id?: string;
  pinned?: boolean;
  q?: string;
  page?: number;
  page_size?: number;
}

export const listNotes = (params: NoteListParams = {}) =>
  api.get<Note[]>(`${N}${qs({ ...params })}`);

export const getNote = (id: string) => api.get<Note>(`${N}/${id}`);

export const createNote = (input: NoteInput) => api.post<Note>(N, input);

export const updateNote = (id: string, input: NoteInput) =>
  api.patch<Note>(`${N}/${id}`, input);

export const deleteNote = (id: string) => api.delete<void>(`${N}/${id}`);
