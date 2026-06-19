import { api } from "@/lib/api";
import type {
  Task,
  TaskBoard,
  TaskCreateInput,
  TaskUpdateInput,
  Subtask,
  CalendarEvent,
  EventCreateInput,
  EventUpdateInput,
} from "./types";

const T = "/tasks";
const CAL = "/calendar/events";

function qs(params: Record<string, unknown>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

// ── Tasks ────────────────────────────────────────────────────────────────

export const getTaskBoard = () => api.get<TaskBoard>(`${T}/board`);

export interface TaskListParams {
  status?: string;
  priority?: string;
  assigned_to?: string;
  q?: string;
  due_before?: string;
  due_after?: string;
  page?: number;
  page_size?: number;
}

export const listTasks = (params: TaskListParams = {}) =>
  api.get<{ data: Task[]; meta: { total: number } }>(
    `${T}${qs({ ...params })}`,
  );

export const getTask = (id: string) => api.get<Task>(`${T}/${id}`);

export const createTask = (input: TaskCreateInput) => api.post<Task>(T, input);

export const updateTask = (id: string, input: TaskUpdateInput) =>
  api.patch<Task>(`${T}/${id}`, input);

export const moveTask = (id: string, status: string) =>
  api.patch<Task>(`${T}/${id}/move`, { status });

export const deleteTask = (id: string) => api.delete<void>(`${T}/${id}`);

// ── Subtasks ─────────────────────────────────────────────────────────────

export const addSubtask = (taskId: string, title: string) =>
  api.post<Subtask>(`${T}/${taskId}/subtasks`, { title });

export const toggleSubtask = (
  taskId: string,
  subtaskId: string,
  is_done: boolean,
) => api.patch<Subtask>(`${T}/${taskId}/subtasks/${subtaskId}`, { is_done });

export const deleteSubtask = (taskId: string, subtaskId: string) =>
  api.delete<void>(`${T}/${taskId}/subtasks/${subtaskId}`);

// ── Calendar events ──────────────────────────────────────────────────────

export interface EventListParams {
  start?: string;
  end?: string;
  event_type?: string;
  page?: number;
  page_size?: number;
}

export const listCalendarEvents = (params: EventListParams = {}) =>
  api.get<CalendarEvent[]>(`${CAL}${qs({ ...params })}`);

export const getCalendarEvent = (id: string) =>
  api.get<CalendarEvent>(`${CAL}/${id}`);

export const createCalendarEvent = (input: EventCreateInput) =>
  api.post<CalendarEvent>(CAL, input);

export const updateCalendarEvent = (id: string, input: EventUpdateInput) =>
  api.patch<CalendarEvent>(`${CAL}/${id}`, input);

export const deleteCalendarEvent = (id: string) =>
  api.delete<void>(`${CAL}/${id}`);
