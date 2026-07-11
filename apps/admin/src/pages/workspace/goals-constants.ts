import type { Tone } from "@/components/ui/primitives";
import type {
  GoalStatus,
  GoalPriority,
  GoalHealth,
  MilestoneStatus,
} from "./goals-types";

export const GOAL_STATUS_META: Record<
  GoalStatus,
  { label: string; tone: Tone }
> = {
  active: { label: "Active", tone: "info" },
  on_hold: { label: "On Hold", tone: "warn" },
  achieved: { label: "Achieved", tone: "success" },
  archived: { label: "Archived", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

export const GOAL_STATUS_OPTIONS: { value: GoalStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On Hold" },
  { value: "achieved", label: "Achieved" },
  { value: "archived", label: "Archived" },
  { value: "cancelled", label: "Cancelled" },
];

export const GOAL_PRIORITY_META: Record<
  GoalPriority,
  { label: string; tone: Tone }
> = {
  low: { label: "Low", tone: "neutral" },
  normal: { label: "Normal", tone: "info" },
  high: { label: "High", tone: "warn" },
  urgent: { label: "Urgent", tone: "danger" },
};

export const GOAL_PRIORITY_OPTIONS: { value: GoalPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

export const GOAL_HEALTH_META: Record<
  GoalHealth,
  { label: string; tone: Tone }
> = {
  on_track: { label: "On Track", tone: "success" },
  at_risk: { label: "At Risk", tone: "warn" },
  behind: { label: "Behind", tone: "danger" },
  achieved: { label: "Achieved", tone: "success" },
};

export const MILESTONE_STATUS_META: Record<
  MilestoneStatus,
  { label: string; tone: Tone }
> = {
  pending: { label: "Pending", tone: "neutral" },
  in_progress: { label: "In Progress", tone: "info" },
  done: { label: "Done", tone: "success" },
  skipped: { label: "Skipped", tone: "neutral" },
};

export const MILESTONE_STATUS_OPTIONS: {
  value: MilestoneStatus;
  label: string;
}[] = [
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
  { value: "skipped", label: "Skipped" },
];
