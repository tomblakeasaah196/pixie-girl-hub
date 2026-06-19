// ── Task types ──────────────────────────────────────────────────────────

export type TaskStatus =
  | "to_do"
  | "in_progress"
  | "in_review"
  | "done"
  | "cancelled";
export type TaskPriority = "low" | "normal" | "high" | "urgent";

export interface Subtask {
  subtask_id: string;
  task_id: string;
  title: string;
  is_done: boolean;
  display_order: number;
  created_at: string;
}

export interface Task {
  task_id: string;
  business: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  due_at?: string | null;
  reminder_minutes?: number | null;
  is_personal?: boolean;
  calendar_event_id?: string | null;
  reference_type?: string | null;
  reference_id?: string | null;
  completed_at?: string | null;
  created_by: string;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
  subtask_count?: number;
  subtask_done_count?: number;
  subtasks?: Subtask[];
}

export interface TaskBoard {
  to_do: Task[];
  in_progress: Task[];
  in_review: Task[];
  done: Task[];
}

export interface TaskCreateInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigned_to?: string;
  due_at?: string;
  reminder_minutes?: number;
  is_personal?: boolean;
}

export interface TaskUpdateInput {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigned_to?: string | null;
  due_at?: string | null;
  reminder_minutes?: number | null;
  is_personal?: boolean;
}

// ── Calendar types ──────────────────────────────────────────────────────

export interface EventParticipant {
  participant_id: string;
  event_id: string;
  user_id: string;
  user_name: string;
  status: "accepted" | "declined" | "tentative" | "pending";
}

export interface CalendarEvent {
  event_id: string;
  business: string;
  title: string;
  event_type: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location?: string | null;
  description?: string | null;
  recurrence_rule?: string | null;
  reference_type?: string | null;
  reference_id?: string | null;
  is_private?: boolean;
  created_by: string;
  created_by_name?: string | null;
  created_at: string;
  participants?: EventParticipant[];
}

export interface EventCreateInput {
  title: string;
  event_type?: string;
  start_at: string;
  end_at: string;
  all_day?: boolean;
  location?: string;
  description?: string;
  is_private?: boolean;
}

export interface EventUpdateInput {
  title?: string;
  event_type?: string;
  start_at?: string;
  end_at?: string;
  all_day?: boolean;
  location?: string | null;
  description?: string | null;
  is_private?: boolean;
}

// ── Workspace tab ───────────────────────────────────────────────────────

export type WorkspaceTab = "my-day" | "calendar" | "tasks";
export type CalendarViewMode = "month" | "week" | "day" | "agenda";
