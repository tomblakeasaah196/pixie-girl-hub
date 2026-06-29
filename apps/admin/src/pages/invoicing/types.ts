/**
 * Invoicing & Billing (V2.2 §6.5) — frontend types.
 * Mirrors src/modules/invoicing/invoicing.validator.js + migrations/template/000021_business_invoicing.sql.template.
 */

export type InvoiceStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "partially_paid"
  | "paid"
  | "overdue"
  | "disputed"
  | "void"
  | "refunded"
  | "partially_refunded";

export type SentVia =
  | "whatsapp"
  | "email"
  | "instagram_dm"
  | "print"
  | "sms"
  | "none"
  | null;

export type CreditNoteStatus =
  | "draft"
  | "issued"
  | "applied"
  | "refunded"
  | "void";

export type CreditNoteReasonCategory =
  | "return"
  | "damage"
  | "price_correction"
  | "customer_dispute"
  | "duplicate_invoice"
  | "goodwill"
  | "other"
  | null;

export type ReminderType =
  | "pre_due"
  | "overdue_first"
  | "overdue_second"
  | "overdue_final"
  | "custom";

export type ReminderChannel = "whatsapp" | "email" | "sms" | "in_app";

export type ReminderStatus =
  | "scheduled"
  | "sent"
  | "failed"
  | "cancelled"
  | "bounced"
  | "delivered"
  | "read";

export interface InvoiceLine {
  invoice_line_id: string;
  invoice_id: string;
  sales_order_line_id: string | null;
  product_id: string | null;
  variant_id: string | null;
  description: string;
  sku_snapshot: string | null;
  quantity: string;
  unit_of_measure: string;
  unit_price_ngn: string;
  line_discount_ngn: string;
  tax_rate: string;
  tax_amount_ngn: string;
  line_total_ngn: string;
  revenue_account_code: string | null;
  display_order: number;
}

export interface InvoicePayment {
  invoice_payment_id: string;
  invoice_id: string;
  sales_order_payment_id: string | null;
  amount_applied_ngn: string;
  applied_by: string | null;
  applied_at: string;
  notes: string | null;
}

export interface Invoice {
  invoice_id: string;
  invoice_number: string;
  order_id: string | null;
  intercompany_transaction_id: string | null;
  contact_id: string;
  contact_name: string | null;
  status: InvoiceStatus;
  subtotal_ngn: string;
  discount_amount_ngn: string;
  tax_amount_ngn: string;
  wht_rate: string;
  wht_amount_ngn: string;
  shipping_fee_ngn: string;
  total_ngn: string;
  net_due_ngn: string;
  amount_paid_ngn: string;
  balance_due_ngn: string;
  display_currency: string | null;
  display_subtotal: string | null;
  display_total: string | null;
  fx_rate_used: string | null;
  issue_date: string;
  due_date: string;
  payment_terms: string | null;
  sent_at: string | null;
  sent_via: SentVia;
  first_viewed_at: string | null;
  viewed_at: string | null;
  public_tracking_token: string | null;
  reminders_sent: number;
  last_reminder_sent_at: string | null;
  issued_by: string | null;
  voided_by: string | null;
  voided_at: string | null;
  document_id: string | null;
  created_at: string;
  updated_at: string;
  lines?: InvoiceLine[];
  payments?: InvoicePayment[];
}

export interface CreditNoteLine {
  credit_note_line_id: string;
  credit_note_id: string;
  source_invoice_line_id: string | null;
  description: string;
  quantity: string;
  unit_price_ngn: string;
  tax_rate: string;
  tax_amount_ngn: string;
  line_total_ngn: string;
  display_order: number;
}

export interface CreditNote {
  credit_note_id: string;
  credit_note_number: string;
  invoice_id: string;
  invoice_number?: string | null;
  contact_name?: string | null;
  reason: string;
  reason_category: CreditNoteReasonCategory;
  cancellation_request_id: string | null;
  subtotal_ngn: string;
  tax_amount_ngn: string;
  total_ngn: string;
  status: CreditNoteStatus;
  issue_date: string;
  issued_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  refund_method: string | null;
  refund_reference: string | null;
  refunded_at: string | null;
  created_at: string;
  updated_at: string;
  lines?: CreditNoteLine[];
}

export interface Receipt {
  receipt_id: string;
  receipt_number: string;
  invoice_id: string | null;
  payment_id: string | null;
  contact_id: string | null;
  amount_ngn: string;
  payment_method: string;
  issued_by: string | null;
  issued_at: string;
  sent_to_email: string | null;
  sent_to_whatsapp: string | null;
  sent_at: string | null;
  notes: string | null;
}

export interface InvoiceReminder {
  reminder_id: string;
  invoice_id: string;
  reminder_type: ReminderType;
  channel: ReminderChannel;
  recipient_address: string | null;
  template_key: string | null;
  rendered_body: string | null;
  status: ReminderStatus;
  scheduled_for: string;
  sent_at: string | null;
  failure_reason: string | null;
  provider: string | null;
  provider_reference: string | null;
}

export type CommsChannel = "email" | "whatsapp" | "instagram" | "sms";

export type CommsStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "opened"
  | "failed"
  | "bounced";

export interface CommsLogEntry {
  log_id: string;
  business: string | null;
  channel: CommsChannel;
  event_key: string | null;
  recipient: string | null;
  subject: string | null;
  status: CommsStatus;
  provider_ref: string | null;
  error: string | null;
  created_at: string;
}

export interface InvoiceDelivery {
  invoice_id: string;
  invoice_number: string;
  status: InvoiceStatus;
  sent_at: string | null;
  sent_via: SentVia;
  first_viewed_at: string | null;
  history: CommsLogEntry[];
}

export interface ArAgeingParty {
  party_id: string;
  party_name: string;
  total_ngn: string;
  current_0_30_ngn: string;
  days_31_60_ngn: string;
  days_61_90_ngn: string;
  days_90_plus_ngn: string;
}

export interface ArAgeingReport {
  as_of: string;
  parties: ArAgeingParty[];
  totals: {
    current_0_30_ngn: string;
    days_31_60_ngn: string;
    days_61_90_ngn: string;
    days_90_plus_ngn: string;
    total_ngn: string;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: { page: number; page_size: number; total: number; has_more: boolean };
}

export interface InvoiceLineInput {
  description: string;
  product_id?: string;
  variant_id?: string;
  sku_snapshot?: string;
  quantity: number;
  unit_price_ngn: number;
  line_discount_ngn?: number;
  tax_rate?: number;
  revenue_account_code?: string;
}

export interface InvoiceCreateInput {
  contact_id: string;
  order_id?: string;
  lines: InvoiceLineInput[];
  due_date: string;
  issue_date?: string;
  payment_terms?: string;
  shipping_fee_ngn?: number;
  wht_rate?: number;
}

export interface InvoiceSendInput {
  sent_via?: "whatsapp" | "email" | "instagram_dm" | "print" | "sms";
}

export interface PaymentApplyInput {
  amount_applied_ngn: number;
  sales_order_payment_id?: string;
  notes?: string;
}

export interface CreditNoteLineInput {
  description: string;
  source_invoice_line_id?: string;
  quantity: number;
  unit_price_ngn: number;
  tax_rate?: number;
}

export interface CreditNoteCreateInput {
  invoice_id: string;
  reason: string;
  reason_category?: Exclude<CreditNoteReasonCategory, null>;
  cancellation_request_id?: string;
  lines: CreditNoteLineInput[];
}

export interface ReceiptIssueInput {
  invoice_id?: string;
  payment_id?: string;
  contact_id?: string;
  amount_ngn: number;
  payment_method: string;
  notes?: string;
}

export interface InvoiceFilters {
  status?: InvoiceStatus | "";
  contact_id?: string;
  order_id?: string;
  overdue?: boolean;
  search?: string;
}

export interface CreditNoteFilters {
  status?: CreditNoteStatus | "";
  invoice_id?: string;
}
