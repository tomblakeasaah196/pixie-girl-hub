import type { InvoiceStatus, CreditNoteStatus, ReminderStatus } from "./types";

type Tone = "success" | "warn" | "danger" | "info" | "accent" | "neutral";

interface StatusMeta {
  label: string;
  tone: Tone;
}

export const INVOICE_STATUS: Record<InvoiceStatus, StatusMeta> = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Sent", tone: "info" },
  viewed: { label: "Viewed", tone: "info" },
  partially_paid: { label: "Partially Paid", tone: "warn" },
  paid: { label: "Paid", tone: "success" },
  overdue: { label: "Overdue", tone: "danger" },
  disputed: { label: "Disputed", tone: "danger" },
  void: { label: "Void", tone: "neutral" },
  refunded: { label: "Refunded", tone: "accent" },
  partially_refunded: { label: "Partially Refunded", tone: "accent" },
};

export const CREDIT_NOTE_STATUS: Record<CreditNoteStatus, StatusMeta> = {
  draft: { label: "Draft", tone: "neutral" },
  issued: { label: "Issued", tone: "info" },
  applied: { label: "Applied", tone: "success" },
  refunded: { label: "Refunded", tone: "accent" },
  void: { label: "Void", tone: "neutral" },
};

export const REMINDER_STATUS: Record<ReminderStatus, StatusMeta> = {
  scheduled: { label: "Scheduled", tone: "neutral" },
  sent: { label: "Sent", tone: "info" },
  delivered: { label: "Delivered", tone: "info" },
  read: { label: "Read", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  bounced: { label: "Bounced", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const CREDIT_NOTE_REASON_OPTIONS = [
  { value: "return", label: "Return" },
  { value: "damage", label: "Damage" },
  { value: "price_correction", label: "Price Correction" },
  { value: "customer_dispute", label: "Customer Dispute" },
  { value: "duplicate_invoice", label: "Duplicate Invoice" },
  { value: "goodwill", label: "Goodwill" },
  { value: "other", label: "Other" },
] as const;

export const SEND_VIA_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "sms", label: "SMS" },
  { value: "instagram_dm", label: "Instagram DM" },
  { value: "print", label: "Print" },
] as const;

export const INVOICE_STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  ...Object.entries(INVOICE_STATUS).map(([v, m]) => ({
    value: v,
    label: m.label,
  })),
];

export const CREDIT_NOTE_STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  ...Object.entries(CREDIT_NOTE_STATUS).map(([v, m]) => ({
    value: v,
    label: m.label,
  })),
];
