import type { Tone } from "@/components/ui/primitives";
import type { JobStatus, VarianceStatus } from "./types";

export const JOB_STATUS_META: Record<
  JobStatus,
  { label: string; tone: Tone; column: boolean }
> = {
  pending:     { label: "Pending",     tone: "neutral", column: true  },
  in_progress: { label: "In Progress", tone: "accent",  column: true  },
  on_hold:     { label: "On Hold",     tone: "warn",    column: true  },
  completed:   { label: "Completed",   tone: "success", column: true  },
  rejected:    { label: "Rejected",    tone: "danger",  column: false },
  cancelled:   { label: "Cancelled",   tone: "neutral", column: false },
};

// Which status can each status advance to?
export const JOB_NEXT_STATES: Partial<Record<JobStatus, JobStatus[]>> = {
  pending:     ["in_progress", "cancelled"],
  in_progress: ["on_hold", "completed", "rejected"],
  on_hold:     ["in_progress", "cancelled"],
};

export const BOARD_COLUMNS: JobStatus[] = [
  "pending",
  "in_progress",
  "on_hold",
  "completed",
];

export const VARIANCE_STATUS_META: Record<
  VarianceStatus,
  { label: string; tone: Tone }
> = {
  normal:       { label: "Normal",       tone: "success" },
  flagged:      { label: "Flagged",      tone: "danger"  },
  investigated: { label: "Investigated", tone: "warn"    },
  resolved:     { label: "Resolved",     tone: "neutral" },
};

export const SERVICE_KEY_ICON: Record<string, string> = {
  installation:   "💇",
  revamping:      "✨",
  colour_creation:"🎨",
  customization:  "✂️",
  packing:        "📦",
};

export const CHEMICAL_UNITS = [
  { value: "ml", label: "ml" },
  { value: "g",  label: "g"  },
  { value: "units", label: "units" },
];

export const RATING_LABELS: Record<number, string> = {
  1: "Poor",
  2: "Fair",
  3: "Good",
  4: "Very Good",
  5: "Excellent",
};
