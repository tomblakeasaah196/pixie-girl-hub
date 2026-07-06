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

export type MessagingPlatform = "whatsapp" | "instagram" | "facebook" | "email";

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
  // Masked previews (plaintext-safe first 4 chars)
  access_token_first4: string | null;
  app_secret_first4: string | null;
  verify_token_first4: string | null;
  business_account_first4: string | null;
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
}

export interface TestResult {
  ok: boolean;
  platform: string;
  provider_id?: string;
  provider_name?: string;
  mx_records?: { exchange: string; priority: number }[];
}

export type RevealableField =
  | "access_token"
  | "app_secret"
  | "verify_token"
  | "business_account_id";

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
    description: "Instagram Business Account linked to a Facebook Page.",
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
};

