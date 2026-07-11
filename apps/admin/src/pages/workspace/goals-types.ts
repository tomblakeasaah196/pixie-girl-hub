// Goals & Notes types (Chief of Staff, PR2). Mirrors the backend shapes from
// src/shared/goals (migrations 000320–000322).

import type { Task, CalendarEvent } from "./types";

export type GoalStatus =
  | "active"
  | "on_hold"
  | "achieved"
  | "archived"
  | "cancelled";
export type GoalPriority = "low" | "normal" | "high" | "urgent";
export type GoalHealth = "on_track" | "at_risk" | "behind" | "achieved";
export type MilestoneStatus = "pending" | "in_progress" | "done" | "skipped";

export interface Milestone {
  milestone_id: string;
  goal_id: string;
  title: string;
  description?: string | null;
  status: MilestoneStatus;
  target_date?: string | null;
  display_order: number;
  depends_on_milestone_id?: string | null;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoalStakeholder {
  stakeholder_id: string;
  goal_id: string;
  user_id?: string | null;
  contact_id?: string | null;
  role?: string | null;
  user_name?: string | null;
  contact_name?: string | null;
  created_at: string;
}

export interface Goal {
  goal_id: string;
  business: string;
  title: string;
  description?: string | null;
  status: GoalStatus;
  priority: GoalPriority;
  owner_user_id?: string | null;
  owner_name?: string | null;
  target_date?: string | null;
  progress_pct: number;
  health: GoalHealth;
  source: string;
  template_id?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  // list-only rollup counts
  milestone_total?: number;
  milestone_done?: number;
  task_total?: number;
  task_done?: number;
  // detail-only composition
  milestones?: Milestone[];
  tasks?: Task[];
  calendar_events?: CalendarEvent[];
  stakeholders?: GoalStakeholder[];
}

export interface MilestoneInput {
  title: string;
  description?: string;
  target_date?: string | null;
  display_order?: number;
}

export interface GoalCreateInput {
  title: string;
  description?: string;
  status?: GoalStatus;
  priority?: GoalPriority;
  owner_user_id?: string | null;
  target_date?: string | null;
  milestones?: MilestoneInput[];
}

export interface GoalUpdateInput {
  title?: string;
  description?: string | null;
  status?: GoalStatus;
  priority?: GoalPriority;
  owner_user_id?: string | null;
  target_date?: string | null;
}

export interface MilestoneUpdateInput {
  title?: string;
  description?: string | null;
  status?: MilestoneStatus;
  target_date?: string | null;
  display_order?: number;
}

export interface Note {
  note_id: string;
  business: string;
  user_id: string;
  title?: string | null;
  body: string;
  goal_id?: string | null;
  milestone_id?: string | null;
  pinned: boolean;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface NoteInput {
  title?: string | null;
  body?: string;
  goal_id?: string | null;
  milestone_id?: string | null;
  pinned?: boolean;
}
