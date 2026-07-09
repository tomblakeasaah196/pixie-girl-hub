/**
 * Communications Studio — typed client. Matches the routes in
 * `src/modules/comms_studio/comms-studio.routes.js`.
 */

import { api } from "@/lib/api";

export type Channel =
  | "email"
  | "whatsapp"
  | "instagram"
  | "in_app_only"
  | "respect_contact_pref"
  | "disabled";

export type Category =
  | "transactional"
  | "lifecycle"
  | "marketing"
  | "operational";

export type TriggerType = "event" | "scheduled" | "annual" | "recurring";

export type BlockType =
  | "eyebrow"
  | "heading"
  | "paragraph"
  | "button"
  | "divider"
  | "spacer"
  | "hero"
  | "perk"
  | "price_compare"
  | "deadline";

export interface Block {
  type: BlockType;
  text?: string;
  html?: string;
  label?: string;
  href?: string;
  accent?: string;
  size?: number;
  muted?: boolean;
  top?: number;
  h?: number;
  src?: string;
  alt?: string;
  glyph?: string;
  old?: string;
  new?: string;
  caption?: string;
  line1?: string;
  line2?: string;
}

export interface VariableDef {
  name: string;
  example?: string;
  required?: boolean;
  description?: string;
}

export interface CadenceConfig {
  type?: TriggerType;
  event?: string;
  every_min?: number;
  every_days?: number;
  hour_local?: number;
  quiet_hours_local?: [number, number];
  source?: string;
  offset_days?: number | number[];
  after_minutes?: number;
  min_amount_paid_ngn?: number;
  [key: string]: unknown;
}

export interface Automation {
  policy_id: string;
  business: string;
  event_key: string;
  channel_preference: Channel;
  fallback_channel: Channel | null;
  rationale: string | null;
  block_whatsapp: boolean;
  is_active: boolean;
  display_name: string | null;
  description: string | null;
  category: Category | null;
  trigger_type: TriggerType | null;
  cadence_config: CadenceConfig;
  subject_template: string | null;
  preheader_template: string | null;
  email_blocks_json: Block[];
  whatsapp_body_template: string | null;
  instagram_body_template: string | null;
  variables_schema: VariableDef[];
  updated_by: string | null;
  updated_at: string;
  created_at: string;
  diagnostics?: {
    undeclared_tokens: string[];
    warnings: string[];
  };
}

export interface AutomationUpdate {
  event_key: string;
  channel_preference?: Channel;
  fallback_channel?: Channel | null;
  block_whatsapp?: boolean;
  is_active?: boolean;
  display_name?: string;
  description?: string;
  category?: Category;
  trigger_type?: TriggerType;
  cadence_config?: CadenceConfig;
  subject_template?: string | null;
  preheader_template?: string | null;
  email_blocks_json?: Block[];
  whatsapp_body_template?: string | null;
  instagram_body_template?: string | null;
  variables_schema?: VariableDef[];
  rationale?: string | null;
}

export interface PreviewRequest {
  event_key: string;
  channel: "email" | "whatsapp" | "instagram";
  subject_template?: string;
  preheader_template?: string;
  email_blocks_json?: Block[];
  whatsapp_body_template?: string;
  instagram_body_template?: string;
  variables?: Record<string, string | number | null>;
}

export interface PreviewResponse {
  channel: "email" | "whatsapp" | "instagram";
  subject?: string;
  preheader?: string;
  html?: string;
  text?: string;
  body?: string;
}

export interface SendLogRow {
  send_id: string;
  contact_id: string | null;
  dedup_key: string;
  channel: string;
  status: string;
  failure_reason: string | null;
  sent_at: string;
}

export const commsStudioApi = {
  list: () => api.get<Automation[]>("/comms-studio"),
  get: (event_key: string) =>
    api.get<Automation>(`/comms-studio/${encodeURIComponent(event_key)}`),
  update: (input: AutomationUpdate) =>
    api.put<Automation>("/comms-studio", input),
  preview: (input: PreviewRequest) =>
    api.post<PreviewResponse>("/comms-studio/preview", input),
  sendTest: (input: {
    event_key: string;
    channel: "email" | "whatsapp";
    to: string;
    variables?: Record<string, string | number | null>;
  }) => api.post<{ sent: boolean }>("/comms-studio/send-test", input),
  sendLog: (event_key: string, limit = 25) =>
    api.get<SendLogRow[]>(
      `/comms-studio/${encodeURIComponent(event_key)}/send-log?limit=${limit}`,
    ),
};

// ── Presentation helpers ─────────────────────────────────────

export const CATEGORY_LABEL: Record<Category, string> = {
  transactional: "Transactional",
  lifecycle: "Lifecycle",
  marketing: "Marketing",
  operational: "Operational",
};

export const CATEGORY_DESCRIPTION: Record<Category, string> = {
  transactional:
    "Tied to a customer action she just took — receipts, invoices, tracking updates.",
  lifecycle:
    "Nurture over time — welcomes, birthdays, abandoned carts, review requests.",
  marketing:
    "Broadcasts to a segment. WhatsApp is hard-blocked here by policy.",
  operational: "Staff-facing invitations and assignments.",
};

export const CATEGORY_ORDER: Category[] = [
  "transactional",
  "lifecycle",
  "marketing",
  "operational",
];

export const BLOCK_LIBRARY: {
  type: BlockType;
  label: string;
  description: string;
  starter: Block;
}[] = [
  {
    type: "eyebrow",
    label: "Eyebrow",
    description: "Small uppercase tag above a heading.",
    starter: { type: "eyebrow", text: "YOUR ORDER" },
  },
  {
    type: "heading",
    label: "Heading",
    description: "Section headline (serif).",
    starter: { type: "heading", text: "Great news, {{first_name}}" },
  },
  {
    type: "paragraph",
    label: "Paragraph",
    description: "Body text. HTML allowed for <strong>, <em>, <br>.",
    starter: {
      type: "paragraph",
      html: "Hi {{first_name}}, your order is on its way.",
    },
  },
  {
    type: "button",
    label: "Button",
    description: "Call-to-action link with the brand accent colour.",
    starter: {
      type: "button",
      label: "View your order",
      href: "{{tracking_url}}",
    },
  },
  {
    type: "divider",
    label: "Divider",
    description: "Thin horizontal rule.",
    starter: { type: "divider" },
  },
  {
    type: "spacer",
    label: "Spacer",
    description: "Vertical space between blocks.",
    starter: { type: "spacer", h: 16 },
  },
  {
    type: "perk",
    label: "Perk",
    description: "Icon + text row for a value proposition.",
    starter: {
      type: "perk",
      glyph: "✓",
      text: "Free shipping over ₦100,000",
    },
  },
];
