/**
 * Messaging Accounts — typed client. Mirrors
 * `src/modules/messaging_accounts/messaging-accounts.routes.js`.
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
  has_access_token: boolean;
  connected_by: string | null;
  connected_at: string;
  last_inbound_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface UpsertInput {
  platform: MessagingPlatform;
  external_account_id: string;
  display_name: string;
  access_token?: string;
  webhook_verify_token?: string;
  is_active?: boolean;
  metadata?: Record<string, unknown>;
}

export interface TestResult {
  ok: boolean;
  platform: string;
  provider_id?: string;
  provider_name?: string;
  mx_records?: { exchange: string; priority: number }[];
}

export const messagingAccountsApi = {
  list: () => api.get<MessagingAccount[]>("/messaging-accounts"),
  upsert: (input: UpsertInput) =>
    api.post<MessagingAccount>("/messaging-accounts", input),
  setActive: (id: string, is_active: boolean) =>
    api.post<{ account_id: string; is_active: boolean }>(
      `/messaging-accounts/${id}/active`,
      { is_active },
    ),
  test: (id: string) => api.post<TestResult>(`/messaging-accounts/${id}/test`),
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
