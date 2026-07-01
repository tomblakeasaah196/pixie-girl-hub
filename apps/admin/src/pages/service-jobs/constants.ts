import type { Tone } from "@/components/ui/primitives";
import type { JobStatus, VarianceStatus } from "./types";

export const JOB_STATUS_META: Record<
  JobStatus,
  { label: string; tone: Tone; column: boolean }
> = {
  pending: { label: "Pending", tone: "neutral", column: true },
  assigned: { label: "Assigned", tone: "info", column: true },
  in_progress: { label: "In Progress", tone: "accent", column: true },
  on_hold: { label: "On Hold", tone: "warn", column: false },
  returned_for_qc: { label: "Returned · QC", tone: "warn", column: true },
  qc_passed: { label: "QC Passed", tone: "success", column: false },
  rework: { label: "Rework", tone: "danger", column: false },
  ready_for_dispatch: { label: "Ready to Ship", tone: "info", column: true },
  handed_to_sales: { label: "With Sales", tone: "accent", column: false },
  completed: { label: "Completed", tone: "success", column: true },
  rejected: { label: "Rejected", tone: "danger", column: false },
  cancelled: { label: "Cancelled", tone: "neutral", column: false },
};

// Which status can each status advance to? (Stylist Studio lifecycle)
export const JOB_NEXT_STATES: Partial<Record<JobStatus, JobStatus[]>> = {
  pending: ["assigned", "cancelled"],
  assigned: ["in_progress", "on_hold", "cancelled"],
  in_progress: ["returned_for_qc", "on_hold"],
  on_hold: ["in_progress", "cancelled"],
  returned_for_qc: ["qc_passed", "rework"],
  qc_passed: ["ready_for_dispatch"],
  rework: ["returned_for_qc"],
  ready_for_dispatch: ["handed_to_sales"],
  handed_to_sales: ["completed"],
};

export const BOARD_COLUMNS: JobStatus[] = [
  "pending",
  "assigned",
  "in_progress",
  "returned_for_qc",
  "ready_for_dispatch",
  "completed",
];

export const VARIANCE_STATUS_META: Record<
  VarianceStatus,
  { label: string; tone: Tone }
> = {
  normal: { label: "Normal", tone: "success" },
  flagged: { label: "Flagged", tone: "danger" },
  investigated: { label: "Investigated", tone: "warn" },
  resolved: { label: "Resolved", tone: "neutral" },
};

export const SERVICE_KEY_ICON: Record<string, string> = {
  installation: "💇",
  revamping: "✨",
  colour_creation: "🎨",
  customization: "✂️",
  packing: "📦",
};

export const CHEMICAL_UNITS = [
  { value: "ml", label: "ml" },
  { value: "g", label: "g" },
  { value: "units", label: "units" },
];

export const RATING_LABELS: Record<number, string> = {
  1: "Poor",
  2: "Fair",
  3: "Good",
  4: "Very Good",
  5: "Excellent",
};
