import type { ExpenseStatus } from "./types";
import type { Tone } from "@/components/ui/primitives";

interface StatusMeta {
  label: string;
  tone: Tone;
}

export const EXPENSE_STATUS_META: Record<ExpenseStatus, StatusMeta> = {
  draft: { label: "Draft", tone: "neutral" },
  pending: { label: "Pending", tone: "warn" },
  approved: { label: "Approved", tone: "info" },
  rejected: { label: "Rejected", tone: "danger" },
  partially_paid: { label: "Partially Paid", tone: "warn" },
  paid: { label: "Paid", tone: "success" },
};

export const EXPENSE_STATUS_TABS = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "paid", label: "Paid" },
  { value: "rejected", label: "Rejected" },
] as const;
