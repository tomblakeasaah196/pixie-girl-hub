/**
 * Messaging Accounts — typed client. Mirrors
 * `src/modules/messaging_accounts/messaging-accounts.routes.js`.
 *
 * The plaintext secrets never live on this client. Every field the
 * modal renders is either a first-4 preview (`access_token_first4`
 * etc.) or a `has_*` boolean. To edit a stored secret, the operator
 * hits `reveal()` with their login password and gets the plaintext
 * back for a single in-memory session — never persisted anywhere.
 */

import { api } from "@/lib/api";

export type MessagingPlatform =
  | "whatsapp"
  | "instagram"
  | "facebook"
  | "email"
  | "email_outbound";

export interface MessagingAccount {
  account_id: string;
  business: string;
  platform: MessagingPlatform;
  external_account_id: string;
  display_name: string;
  webhook_verify_token: string | null;
  is_active: boolean;
  // Presence flags
  has_access_token: boolean;
  has_app_secret: boolean;
  has_verify_token: boolean;
  has_business_account_id: boolean;
  has_smtp_password: boolean;
  // Masked previews (plaintext-safe first 4 chars)
  access_token_first4: string | null;
  app_secret_first4: string | null;
  verify_token_first4: string | null;
  business_account_first4: string | null;
  smtp_password_first4: string | null;
  // 'email_outbound' only
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_secure: boolean;
  smtp_user: string | null;
  from_email: string | null;
  from_name: string | null;
  reply_to_email: string | null;
  // 'email_outbound' inbound-polling (IMAP) — reuses smtp_user/password
  imap_host: string | null;
  imap_port: number | null;
  imap_secure: boolean;
  inbound_poll_enabled: boolean;
  imap_last_polled_at: string | null;
  // Ops metadata
  connected_by: string | null;
  connected_at: string;
  last_inbound_at: string | null;
  secrets_last_rotated_at: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface UpsertInput {
  platform: MessagingPlatform;
  external_account_id: string;
  display_name: string;
  access_token?: string;
  app_secret?: string;
  verify_token?: string;
  business_account_id?: string;
  webhook_verify_token?: string;
  is_active?: boolean;
  notes?: string;
  metadata?: Record<string, unknown>;
  // 'email_outbound' only
  smtp_host?: string;
  smtp_port?: number;
  smtp_secure?: boolean;
  smtp_user?: string;
  smtp_password?: string;
  from_email?: string;
  from_name?: string;
  reply_to_email?: string;
  // 'email_outbound' inbound-polling (IMAP)
  imap_host?: string;
  imap_port?: number;
  imap_secure?: boolean;
  inbound_poll_enabled?: boolean;
}

export interface TestResult {
  ok: boolean;
  platform: string;
  provider_id?: string;
  provider_name?: string;
  mx_records?: { exchange: string; priority: number }[];
  /** IG only: the stored account id didn't match Meta's and was corrected. */
  healed?: boolean;
  /** email_outbound with inbound polling on: result of the IMAP login check. */
  imap?: { ok: boolean; host?: string; error?: string } | null;
}

export type RevealableField =
  | "access_token"
  | "app_secret"
  | "verify_token"
  | "business_account_id"
  | "smtp_password";

export interface RevealResult {
  field: RevealableField;
  value: string;
}

export interface SecretReveal {
  reveal_id: string;
  field: RevealableField;
  revealed_at: string;
  source_ip: string | null;
  display_name: string | null;
  email: string | null;
}

// ── WhatsApp business profile ─────────────────────────────
// Meta's industry allow-list for the profile "vertical" (category).
// Mirrors src/modules/messaging_accounts/messaging-accounts.validator.js.
export const WA_VERTICALS = [
  "UNDEFINED",
  "OTHER",
  "AUTO",
  "BEAUTY",
  "APPAREL",
  "EDU",
  "ENTERTAIN",
  "EVENT_PLAN",
  "FINANCE",
  "GROCERY",
  "GOVT",
  "HOTEL",
  "HEALTH",
  "NONPROFIT",
  "PROF_SERVICES",
  "RETAIL",
  "TRAVEL",
  "RESTAURANT",
  "ALCOHOL",
  "ONLINE_GAMBLING",
  "PHYSICAL_GAMBLING",
  "OTC_DRUGS",
  "NOT_A_BIZ",
] as const;

export type WaVertical = (typeof WA_VERTICALS)[number];

/** Human labels for the vertical codes, for the select control. */
export const WA_VERTICAL_LABELS: Record<string, string> = {
  UNDEFINED: "Not set",
  OTHER: "Other",
  AUTO: "Automotive",
  BEAUTY: "Beauty, Spa & Salon",
  APPAREL: "Clothing & Apparel",
  EDU: "Education",
  ENTERTAIN: "Entertainment",
  EVENT_PLAN: "Event Planning & Service",
  FINANCE: "Finance & Banking",
  GROCERY: "Food & Grocery",
  GOVT: "Public Service",
  HOTEL: "Hotel & Lodging",
  HEALTH: "Medical & Health",
  NONPROFIT: "Non-profit",
  PROF_SERVICES: "Professional Services",
  RETAIL: "Shopping & Retail",
  TRAVEL: "Travel & Transportation",
  RESTAURANT: "Restaurant",
  ALCOHOL: "Alcohol",
  ONLINE_GAMBLING: "Online Gambling & Gaming",
  PHYSICAL_GAMBLING: "Physical Gambling & Gaming",
  OTC_DRUGS: "Over-the-Counter Drugs",
  NOT_A_BIZ: "Non-business",
};

export interface WhatsAppProfile {
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  vertical?: string;
  websites?: string[];
  /** Read-only — Meta's hosted URL for the current display picture. */
  profile_picture_url?: string;
  /** Stored Meta App ID (auto-detected; shown for reference). */
  app_id: string | null;
  /** Set on a picture-upload response: whether Meta already reflects the
   *  new picture (false ⇒ it may take a moment to appear). */
  picture_applied?: boolean;
}

export interface WhatsAppProfilePatch {
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  vertical?: string;
  websites?: string[];
}

export interface InboundDnsRecord {
  type: string;
  name: string;
  value: string;
  note?: string;
}

export interface InboundDnsRecords {
  domain: string;
  webhook_url: string;
  webhook_header: string;
  webhook_secret_configured: boolean;
  records: InboundDnsRecord[];
  instructions: string[];
}

/** Meta's per-number calling settings (Cloud API Calling). */
export interface WhatsAppCallingSettings {
  status?: "ENABLED" | "DISABLED";
  call_icon_visibility?: string;
  [key: string]: unknown;
}

export const messagingAccountsApi = {
  // Backend auto-unwraps `{ data }` — see api.ts. Types match the
  // inner payload.
  list: () => api.get<MessagingAccount[]>("/messaging-accounts"),
  upsert: (input: UpsertInput) =>
    api.post<MessagingAccount>("/messaging-accounts", input),
  setActive: (id: string, is_active: boolean) =>
    api.post<{ account_id: string; is_active: boolean }>(
      `/messaging-accounts/${id}/active`,
      { is_active },
    ),
  test: (id: string) => api.post<TestResult>(`/messaging-accounts/${id}/test`),
  reveal: (id: string, field: RevealableField, password: string) =>
    api.post<RevealResult>(`/messaging-accounts/${id}/reveal`, {
      field,
      password,
    }),
  listReveals: (id: string) =>
    api.get<SecretReveal[]>(`/messaging-accounts/${id}/reveals`),
  remove: (id: string) => api.delete(`/messaging-accounts/${id}`),
  // WhatsApp business profile
  getWhatsAppProfile: (id: string) =>
    api.get<WhatsAppProfile>(`/messaging-accounts/${id}/whatsapp-profile`),
  updateWhatsAppProfile: (id: string, patch: WhatsAppProfilePatch) =>
    api.post<{ success?: boolean }>(
      `/messaging-accounts/${id}/whatsapp-profile`,
      patch,
    ),
  setWhatsAppProfilePicture: (
    id: string,
    file: File,
    appId: string,
    onProgress?: (percent: number) => void,
  ) => {
    const form = new FormData();
    form.append("file", file);
    if (appId) form.append("app_id", appId);
    return api.postForm<WhatsAppProfile>(
      `/messaging-accounts/${id}/whatsapp-profile/picture`,
      form,
      { onProgress },
    );
  },
  // WhatsApp voice calling (Cloud API Calling) — per-number toggle.
  getWhatsAppCalling: (id: string) =>
    api.get<WhatsAppCallingSettings>(
      `/messaging-accounts/${id}/whatsapp-calling`,
    ),
  updateWhatsAppCalling: (
    id: string,
    input: { enabled: boolean; icon_visibility?: "DEFAULT" | "DISABLE_ALL" },
  ) =>
    api.post<{ success?: boolean }>(
      `/messaging-accounts/${id}/whatsapp-calling`,
      input,
    ),
  // Computed on the fly from the mailbox typed into the Inbound Email
  // form — works even before the account row is saved.
  dnsRecords: (mailbox: string) =>
    api.get<InboundDnsRecords>(
      `/messaging-accounts/dns-records?mailbox=${encodeURIComponent(mailbox)}`,
    ),
};

export const PLATFORM_META: Record<
  MessagingPlatform,
  {
    label: string;
    description: string;
    placeholder_id: string;
    placeholder_name: string;
  }
> = {
  whatsapp: {
    label: "WhatsApp",
    description: "Meta Cloud API phone number for this brand.",
    placeholder_id: "Phone Number ID (e.g. 105937284732910)",
    placeholder_name: "Pixie Girl Customer Care",
  },
  instagram: {
    label: "Instagram",
    description:
      "Instagram professional account (Instagram API with Instagram Login).",
    placeholder_id: "IG Business Account ID (e.g. 17841405822304914)",
    placeholder_name: "@pixiegirlglobal",
  },
  facebook: {
    label: "Facebook Messenger",
    description: "Facebook Page that receives Messenger DMs.",
    placeholder_id: "Page ID (e.g. 100087654321010)",
    placeholder_name: "Pixie Girl Global",
  },
  email: {
    label: "Inbound Email",
    description: "Mailbox that receives customer email replies.",
    placeholder_id: "support@pixiegirlglobal.com",
    placeholder_name: "Pixie Girl Support",
  },
  email_outbound: {
    label: "Outbound Email",
    description:
      "SMTP relay this brand sends transactional and reply mail through.",
    placeholder_id: "sales@pixiegirlglobal.com",
    placeholder_name: "Pixie Girl Global",
  },
};
