/**
 * Smartcomm API client.
 *
 * Mirrors the routes registered in src/modules/smartcomm/smartcomm.routes.js.
 * One-line wrappers so screens read declaratively.
 */

import { api } from "@/lib/api";
import type {
  Channel,
  Message,
  UnreadCount,
  Customer360,
  QuickReply,
  MessageDraft,
  ExternalPlatform,
  MessageType,
} from "@/lib/smartcomm-types";

// ── Channels ─────────────────────────────────────────────

export interface ChannelListParams {
  channel_type?: string;
  platform?: "internal" | ExternalPlatform;
  status?: string;
  assigned_to_me?: boolean;
  q?: string;
  include_archived?: boolean;
  limit?: number;
  offset?: number;
}

function qs(params: Record<string, unknown>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

export const smartcommApi = {
  listChannels: (p: ChannelListParams = {}) =>
    api.get<Channel[]>(
      `/smartcomm/channels${qs(p as Record<string, unknown>)}`,
    ),
  getChannel: (id: string) => api.get<Channel>(`/smartcomm/channels/${id}`),
  createChannel: (input: {
    channel_type: "group" | "direct";
    name?: string;
    member_user_ids?: string[];
    metadata?: Record<string, unknown>;
  }) => api.post<Channel>("/smartcomm/channels", input),

  /** Find-or-create a 1:1 DM with a colleague (HR "Message" + search). */
  startDirect: (target_user_id: string) =>
    api.post<Channel>("/smartcomm/channels/direct", { target_user_id }),

  archiveChannel: (id: string, archived = true) =>
    api.post<Channel>(`/smartcomm/channels/${id}/archive`, { archived }),
  resolveThread: (id: string) =>
    api.post<Channel>(`/smartcomm/channels/${id}/resolve`),
  reopenThread: (id: string) =>
    api.post<Channel>(`/smartcomm/channels/${id}/reopen`),
  assignThread: (
    id: string,
    assigned_to: string | null,
    handoff_note?: string,
  ) =>
    api.post<Channel>(`/smartcomm/channels/${id}/assign`, {
      assigned_to,
      handoff_note,
    }),
  pinChannel: (id: string, pinned: boolean) =>
    api.post<{ channel_id: string; is_pinned: boolean }>(
      `/smartcomm/channels/${id}/pin`,
      { pinned },
    ),
  muteChannel: (id: string, muted: boolean, hours?: number) =>
    api.post<{ channel_id: string; muted_until: string | null }>(
      `/smartcomm/channels/${id}/mute`,
      { muted, hours },
    ),
  markRead: (id: string, up_to_message_id?: string) =>
    api.post(`/smartcomm/channels/${id}/mark-read`, { up_to_message_id }),

  // Members
  addMember: (
    id: string,
    m: { user_id?: string; contact_id?: string; role?: "member" | "admin" },
  ) => api.post(`/smartcomm/channels/${id}/members`, m),
  removeMember: (id: string, member_id: string) =>
    api.delete(`/smartcomm/channels/${id}/members/${member_id}`),

  // Drafts
  getDraft: (id: string) =>
    api.get<MessageDraft | null>(`/smartcomm/channels/${id}/draft`),
  saveDraft: (
    id: string,
    input: {
      content: string;
      attachments?: { document_id: string; display_name?: string }[];
      reply_to_id?: string;
      generated_by?: "human" | "praxis";
    },
  ) => api.put<MessageDraft>(`/smartcomm/channels/${id}/draft`, input),
  discardDraft: (id: string) => api.delete(`/smartcomm/channels/${id}/draft`),

  // Messages
  listMessages: (id: string, p: { before?: string; limit?: number } = {}) =>
    api.get<Message[]>(`/smartcomm/channels/${id}/messages${qs(p)}`),
  postMessage: (
    id: string,
    input: {
      content?: string;
      message_type?: MessageType;
      reply_to_id?: string;
      attachments?: { document_id: string; display_name?: string }[];
      is_template?: boolean;
      /** IG only: send outside the 24h window with Meta's HUMAN_AGENT tag. */
      is_human_agent?: boolean;
      metadata?: Record<string, unknown>;
    },
  ) => api.post<Message>(`/smartcomm/channels/${id}/messages`, input),
  sendInvoiceCard: (channelId: string, invoice_id: string) =>
    api.post<Message>(`/smartcomm/channels/${channelId}/send-invoice`, {
      invoice_id,
    }),
  editMessage: (message_id: string, content: string) =>
    api.patch<Message>(`/smartcomm/messages/${message_id}`, { content }),
  deleteMessage: (message_id: string) =>
    api.delete(`/smartcomm/messages/${message_id}`),
  forwardMessage: (message_id: string, channel_ids: string[]) =>
    api.post<{ forwarded_count: number }>(
      `/smartcomm/messages/${message_id}/forward`,
      { channel_ids },
    ),
  reactToMessage: (message_id: string, emoji: string) =>
    api.post<{ added: boolean; emoji: string }>(
      `/smartcomm/messages/${message_id}/react`,
      { emoji },
    ),
  starMessage: (message_id: string) =>
    api.post<{ starred: boolean }>(`/smartcomm/messages/${message_id}/star`),
  listStarred: () => api.get<Message[]>("/smartcomm/starred"),

  // Search
  search: (p: { q: string; channel_id?: string; limit?: number }) =>
    api.get<Message[]>(`/smartcomm/search${qs(p)}`),

  // Unread counter (drives FAB badge)
  getUnread: () => api.get<UnreadCount>("/smartcomm/unread-count"),

  // Customer 360
  getCustomer360: (contact_id: string) =>
    api.get<Customer360>(`/smartcomm/customer-360/${contact_id}`),

  // Send to customer (outbound dispatch, ignores existing channel) — used
  // both by system reminders and by the "message a customer" contact
  // picker to kick off a brand-new customer_thread with a first message.
  sendToCustomer: (input: {
    contact_id: string;
    channel?: "whatsapp" | "email" | "instagram";
    subject?: string;
    body: string;
  }) =>
    api.post<{ channel_id: string; message: Message; queued: boolean }>(
      "/smartcomm/send",
      input,
    ),

  // Quick replies
  listQuickReplies: () => api.get<QuickReply[]>("/smartcomm/quick-replies"),
  createQuickReply: (input: {
    scope?: "personal" | "brand";
    slug: string;
    title: string;
    body: string;
    variables?: string[];
    category?: string;
    sort_order?: number;
  }) => api.post<QuickReply>("/smartcomm/quick-replies", input),

  // Praxis-drafted reply (on-demand, permission-gated).
  draftWithPraxis: (channelId: string) =>
    api.post<MessageDraft>(
      `/smartcomm/channels/${channelId}/draft-with-praxis`,
    ),

  // Order capture link (universal order link: capture = staff-picked
  // cart, shop = curated mini-shop the customer picks from)
  createOrderCapture: (input: {
    contact_id?: string;
    channel_id?: string;
    mode?: "capture" | "shop";
    items: {
      kind?: "base" | "styled" | "bundle" | "service";
      product_id?: string;
      styled_id?: string;
      bundle_id?: string;
      service_id?: string;
      qty: number;
      price_ngn?: string;
      note?: string;
    }[];
    sales_channel?: string;
    notes?: string;
    expires_in?: number;
  }) =>
    api.post<{
      url: string;
      token: string;
      expires_at: string;
      link_id?: string;
      mode?: "capture" | "shop";
    }>("/smartcomm/order-capture", input),

  // Sidebar activity panel: a channel's order links + live cart state.
  listOrderLinks: (channelId: string) =>
    api.get<{ data: OrderLinkRow[] }>(
      `/smartcomm/channels/${channelId}/order-links`,
    ),
};

export interface OrderLinkRow {
  link_id: string;
  mode: "capture" | "shop";
  status: "active" | "ordered" | "expired" | "revoked";
  items: { kind: string; qty: number }[];
  cart:
    | {
        kind: string;
        ref_id: string | null;
        name: string;
        qty: number;
        price_ngn: string | null;
      }[]
    | null;
  opened_at: string | null;
  opened_count: number;
  cart_updated_at: string | null;
  order_number: string | null;
  ordered_at: string | null;
  booking_count: number;
  expires_at: string;
  created_at: string;
}

// ── Customer Onboarding (Online QR link) ─────────────────

export interface OnboardingLink {
  submission_id: string;
  token: string;
  url: string;
  expires_at: string;
}

export const onboardingApi = {
  createLink: (input: {
    business: string;
    channel_id?: string;
    seed_payload?: Record<string, unknown>;
    source?: "online" | "walkin" | "staff";
  }) => api.post<OnboardingLink>("/customer-onboarding/links", input),
};
