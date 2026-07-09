/**
 * WhatsApp Templates — typed client. Mirrors
 * `src/modules/whatsapp_templates/whatsapp-templates.routes.js`.
 *
 * Templates are the only way to message a customer once the 24-hour
 * window closes. This client powers both the Settings editor and the
 * composer's "send a template" picker.
 */

import { api } from "@/lib/api";

export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";
export type RateCategory = TemplateCategory | "SERVICE";

export type TemplateStatus =
  | "LOCAL_DRAFT"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "PAUSED"
  | "DISABLED"
  | "IN_APPEAL";

/** A Meta component (HEADER / BODY / FOOTER / BUTTONS). */
export interface TemplateComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: string;
  text?: string;
  buttons?: Array<Record<string, unknown>>;
  example?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface TemplateCost {
  amount_ngn: string;
  currency: string;
}

export interface WhatsAppTemplate {
  template_id: string;
  business: string;
  meta_template_id: string | null;
  name: string;
  language: string;
  category: TemplateCategory;
  status: TemplateStatus;
  components: TemplateComponent[];
  body_text: string | null;
  variables: number[];
  quality_score: string | null;
  rejected_reason: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
  cost: TemplateCost | null;
}

export interface TemplateRate {
  rate_id: string;
  business: string;
  category: RateCategory;
  amount_ngn: string;
  currency: string;
  note: string | null;
  updated_at: string;
}

export interface TemplateListResponse {
  templates: WhatsAppTemplate[];
  rates: TemplateRate[];
}

export interface CreateTemplateInput {
  name: string;
  language: string;
  category: TemplateCategory;
  components: TemplateComponent[];
  submit?: boolean;
}

export interface UpdateTemplateInput {
  category?: TemplateCategory;
  components?: TemplateComponent[];
  submit?: boolean;
}

export const whatsappTemplatesApi = {
  list: () => api.get<TemplateListResponse>("/whatsapp-templates"),
  sync: () => api.post<{ synced: number }>("/whatsapp-templates/sync"),
  create: (input: CreateTemplateInput) =>
    api.post<WhatsAppTemplate>("/whatsapp-templates", input),
  update: (id: string, input: UpdateTemplateInput) =>
    api.patch<WhatsAppTemplate>(`/whatsapp-templates/${id}`, input),
  submit: (id: string) =>
    api.post<WhatsAppTemplate>(`/whatsapp-templates/${id}/submit`),
  remove: (id: string) => api.delete(`/whatsapp-templates/${id}`),
  listRates: () => api.get<TemplateRate[]>("/whatsapp-templates/rates"),
  setRate: (input: { category: RateCategory; amount_ngn: number; note?: string }) =>
    api.put<TemplateRate>("/whatsapp-templates/rates", input),
};

// ── Presentation helpers ───────────────────────────────────

export const CATEGORY_META: Record<
  RateCategory,
  { label: string; blurb: string; tone: string }
> = {
  MARKETING: {
    label: "Marketing",
    blurb: "Promotions, launches, re-engagement. Premium billing tier.",
    tone: "amber",
  },
  UTILITY: {
    label: "Utility",
    blurb: "Order, shipping, payment & account updates.",
    tone: "green",
  },
  AUTHENTICATION: {
    label: "Authentication",
    blurb: "One-time passcodes & login verification.",
    tone: "blue",
  },
  SERVICE: {
    label: "Service (free-form)",
    blurb: "Replies inside the 24h window — free, no template needed.",
    tone: "muted",
  },
};

export const STATUS_META: Record<
  TemplateStatus,
  { label: string; tone: string }
> = {
  LOCAL_DRAFT: { label: "Draft", tone: "muted" },
  PENDING: { label: "In review", tone: "amber" },
  APPROVED: { label: "Approved", tone: "green" },
  REJECTED: { label: "Rejected", tone: "red" },
  PAUSED: { label: "Paused", tone: "amber" },
  DISABLED: { label: "Disabled", tone: "red" },
  IN_APPEAL: { label: "In appeal", tone: "amber" },
};

/** Format an NGN amount string as ₦-prefixed money. 0 → "Free". */
export function fmtRateNgn(amount?: string | null): string {
  if (amount == null) return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "Free";
  return `₦${n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Positional {{1}} {{2}} placeholders used in the components. */
export function detectPositionalVars(components: TemplateComponent[]): number[] {
  const text = components
    .map(
      (c) =>
        `${c.text || ""} ${(c.buttons || [])
          .map((b) => String(b.url || b.text || ""))
          .join(" ")}`,
    )
    .join(" ");
  const out = new Set<number>();
  const re = /\{\{\s*(\d+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.add(Number(m[1]));
  return Array.from(out).sort((a, b) => a - b);
}
