import type { AssignmentStatus, PartnerStatus, PayoutStatus } from "./types";

type Tone = "success" | "warn" | "danger" | "info" | "neutral" | "accent";

export const PARTNER_STATUS_META: Record<
  PartnerStatus,
  { label: string; tone: Tone }
> = {
  applicant: { label: "Applicant", tone: "info" },
  vetting: { label: "In vetting", tone: "warn" },
  vetted: { label: "Vetted", tone: "info" },
  certified: { label: "Certified", tone: "success" },
  suspended: { label: "Suspended", tone: "danger" },
  terminated: { label: "Terminated", tone: "neutral" },
};

export const ASSIGNMENT_STATUS_META: Record<
  AssignmentStatus,
  { label: string; tone: Tone }
> = {
  offered_pool: { label: "Offered", tone: "info" },
  accepted: { label: "Accepted", tone: "accent" },
  declined_by_stylist: { label: "Declined", tone: "neutral" },
  declined_other_accepted: { label: "Taken by other", tone: "neutral" },
  escalated_to_admin: { label: "Escalated", tone: "warn" },
  in_progress: { label: "In progress", tone: "accent" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  disputed: { label: "Disputed", tone: "danger" },
};

export const PAYOUT_STATUS_META: Record<
  PayoutStatus,
  { label: string; tone: Tone }
> = {
  draft: { label: "Draft", tone: "neutral" },
  pending_approval: { label: "Awaiting approval", tone: "warn" },
  approved: { label: "Approved", tone: "info" },
  processing: { label: "Processing", tone: "info" },
  paid: { label: "Paid", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const ATTRIBUTION_STATUS_META: Record<
  string,
  { label: string; tone: Tone }
> = {
  pending: { label: "On hold", tone: "warn" },
  payable: { label: "Payable", tone: "info" },
  paid: { label: "Paid", tone: "success" },
  void: { label: "Void", tone: "neutral" },
};

/** Default rubric criteria for the vetting scoring drawer (§6.26). */
export const DEFAULT_RUBRIC = [
  { criterion: "Portfolio quality", max: 10 },
  { criterion: "Technical skill (lace/install)", max: 10 },
  { criterion: "Brand alignment", max: 10 },
  { criterion: "Professionalism & comms", max: 10 },
];
