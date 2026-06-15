import type { CashRequestStatus, ExpenseStatus, Urgency, RecipientType, DocumentRole } from "./types";
import type { Tone } from "@/components/ui/primitives";

interface StatusMeta {
  label: string;
  tone: Tone;
}

export const CR_STATUS_META: Record<CashRequestStatus, StatusMeta> = {
  draft: { label: "Draft", tone: "neutral" },
  pending_finance: { label: "Pending Finance", tone: "warn" },
  pending_ceo: { label: "Pending CEO", tone: "warn" },
  approved: { label: "Approved", tone: "info" },
  rejected: { label: "Rejected", tone: "danger" },
  sent_back: { label: "Sent Back", tone: "warn" },
  disbursed: { label: "Disbursed", tone: "success" },
  settled: { label: "Settled", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const EXPENSE_STATUS_META: Record<ExpenseStatus, StatusMeta> = {
  draft: { label: "Draft", tone: "neutral" },
  pending: { label: "Pending", tone: "warn" },
  approved: { label: "Approved", tone: "info" },
  rejected: { label: "Rejected", tone: "danger" },
  partially_paid: { label: "Partially Paid", tone: "warn" },
  paid: { label: "Paid", tone: "success" },
};

export const URGENCY_META: Record<Urgency, StatusMeta> = {
  normal: { label: "Normal", tone: "neutral" },
  urgent: { label: "Urgent", tone: "warn" },
  critical: { label: "Critical", tone: "danger" },
};

export const RECIPIENT_TYPE_LABELS: Record<RecipientType, string> = {
  self_bank: "My Bank Account",
  self_cash: "Cash (Self)",
  third_party_bank: "Third-Party Bank",
  petty_cash: "Petty Cash",
  supplier_direct: "Supplier Direct",
};

export const DOCUMENT_ROLE_LABELS: Record<DocumentRole, string> = {
  quote: "Quote",
  pro_forma_invoice: "Pro-Forma Invoice",
  screenshot: "Screenshot",
  authorisation: "Authorisation",
  bank_transfer_receipt: "Bank Transfer Receipt",
  settlement_receipt: "Settlement Receipt",
  other: "Other",
};

export const CR_CATEGORY_OPTIONS = [
  { value: "office_supplies", label: "Office Supplies" },
  { value: "petty_cash_topup", label: "Petty Cash Top-Up" },
  { value: "vendor_deposit", label: "Vendor Deposit" },
  { value: "staff_reimbursement", label: "Staff Reimbursement" },
  { value: "travel_advance", label: "Travel Advance" },
  { value: "event_logistics", label: "Event / Logistics" },
  { value: "emergency", label: "Emergency" },
  { value: "other", label: "Other" },
];

export const URGENCY_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "urgent", label: "Urgent" },
  { value: "critical", label: "Critical" },
];

export const RECIPIENT_TYPE_OPTIONS: { value: RecipientType; label: string }[] = [
  { value: "self_bank", label: "My Bank Account" },
  { value: "self_cash", label: "Cash (Self)" },
  { value: "third_party_bank", label: "Third-Party Bank Transfer" },
  { value: "petty_cash", label: "Petty Cash" },
  { value: "supplier_direct", label: "Direct to Supplier" },
];

export const DOCUMENT_ROLE_OPTIONS: { value: DocumentRole; label: string }[] = [
  { value: "quote", label: "Quote" },
  { value: "pro_forma_invoice", label: "Pro-Forma Invoice" },
  { value: "screenshot", label: "Screenshot" },
  { value: "authorisation", label: "Authorisation" },
  { value: "bank_transfer_receipt", label: "Bank Transfer Receipt" },
  { value: "settlement_receipt", label: "Settlement Receipt" },
  { value: "other", label: "Other" },
];

export const CR_STATUS_TABS = [
  { value: "", label: "All" },
  { value: "pending_finance", label: "Pending Finance" },
  { value: "pending_ceo", label: "Pending CEO" },
  { value: "approved", label: "Approved" },
  { value: "disbursed", label: "Disbursed" },
  { value: "settled", label: "Settled" },
] as const;

export const EXPENSE_STATUS_TABS = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "paid", label: "Paid" },
  { value: "rejected", label: "Rejected" },
] as const;

export const SETTLEMENT_REQUIRES_TYPES = new Set(["self_cash", "petty_cash"]);
