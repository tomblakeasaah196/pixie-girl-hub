/**
 * Smartcomm types — mirror of the backend's smartcomm.repo + service
 * output shapes (PR 1's migration 000213 + PR 2's policy).
 */

export type ChannelType = "group" | "direct" | "customer_thread";
export type ExternalPlatform =
  | "whatsapp"
  | "instagram"
  | "facebook"
  | "website_chat"
  | "email"
  | null;
export type Platform = ExternalPlatform | "internal";
export type MessageType =
  | "text"
  | "image"
  | "document"
  | "voice_note"
  | "video"
  | "sticker"
  | "system"
  | "product_share"
  | "send_invoice"
  | "template"
  | "call"
  | "ig_story_mention"
  | "ig_story_reply";
export type ChannelStatus = "open" | "resolved";
export type ParticipantRole = "member" | "admin";
export type SenderKind = "staff" | "customer" | "system";
export type DeliveryStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

export interface ChannelMember {
  member_id?: string;
  user_id?: string | null;
  contact_id?: string | null;
  role: ParticipantRole;
  joined_at?: string;
  last_read_at?: string | null;
  last_seen_at?: string | null;
  is_pinned?: boolean;
  muted_until?: string | null;
  notification_pref?: "all" | "mentions_only" | "none";
  // Joined columns
  user_display_name?: string | null;
  user_avatar_url?: string | null;
  user_phone?: string | null;
  contact_display_name?: string | null;
  /** Platform profile picture from contact_social_handles (IG/WA/email). */
  contact_avatar_url?: string | null;
  /** Platform handle (e.g. the IG @username) from contact_social_handles. */
  contact_handle?: string | null;
  primary_phone?: string | null;
  whatsapp_number?: string | null;
  email?: string | null;
}

export interface ChannelMetadata {
  source?: Platform | null;
  contact_id?: string | null;
  subject?: string | null;
  [key: string]: unknown;
}

export interface Channel {
  channel_id: string;
  channel_type: ChannelType;
  name?: string | null;
  description?: string | null;
  business?: string | null;
  external_platform?: ExternalPlatform;
  external_thread_ref?: string | null;
  is_archived?: boolean;
  status?: ChannelStatus;
  assigned_to?: string | null;
  assigned_at?: string | null;
  wa_window_expires_at?: string | null;
  ig_window_expires_at?: string | null;
  metadata?: ChannelMetadata;
  last_message_at?: string | null;
  last_message_preview?: string | null;
  last_message_kind?: MessageType | null;
  unread_count: number;
  is_pinned?: boolean;
  muted_until?: string | null;
  my_role?: ParticipantRole | null;
  members?: ChannelMember[] | null;
  /** Counterpart on this row: the other user for direct chats, the
   *  customer for customer_thread chats. Sent by the list endpoint so
   *  the inbox can render the correct name/avatar without a second
   *  round trip. Absent for group channels. */
  peer_display_name?: string | null;
  peer_avatar_url?: string | null;
  peer_phone?: string | null;
  peer_whatsapp_number?: string | null;
  peer_email?: string | null;
  peer_user_id?: string | null;
  peer_contact_id?: string | null;
}

export interface MessageReaction {
  emoji: string;
  user_id: string;
  user_name?: string | null;
}

export interface MessageAttachment {
  attachment_id?: string;
  document_id: string;
  display_name?: string | null;
  /** Browser-fetchable URL (CDN or /media proxy). Present on read. */
  url?: string | null;
  mime_type?: string | null;
  file_size_bytes?: number | null;
}

export interface ReplyPreview {
  message_id?: string;
  content?: string | null;
  message_type?: MessageType;
  sender_user_id?: string | null;
  sender_name?: string;
}

export interface Message {
  message_id: string;
  channel_id: string;
  sender_user_id?: string | null;
  sender_contact_id?: string | null;
  sender_name?: string;
  sender_kind?: SenderKind;
  message_type: MessageType;
  content?: string | null;
  edited_at?: string | null;
  is_forwarded?: boolean;
  forwarded_from_id?: string | null;
  reply_to_id?: string | null;
  reply_message_id?: string | null;
  reply_content?: string | null;
  reply_sender_name?: string | null;
  reply_message_type?: MessageType | null;
  delivery_status?: DeliveryStatus;
  delivery_error?: string | null;
  is_deleted?: boolean;
  external_ref?: string | null;
  created_at: string;
  reactions?: MessageReaction[];
  is_starred?: boolean;
  attachments?: MessageAttachment[];
  /**
   * Card payload for commerce kinds. `product_share` carries a `products`
   * array; `send_invoice` carries the invoice ref/url. Server sanitises
   * keys so untrusted fields can't ride in.
   */
  metadata?: {
    products?: ProductCard[];
    intro?: string;
    invoice_id?: string;
    invoice_number?: string;
    amount_due?: string;
    due_date?: string;
    url?: string;
    // 'call' cards (WhatsApp voice calls — calls module)
    call_id?: string;
    call_status?: "completed" | "missed" | "rejected" | "failed";
    duration_seconds?: number | null;
    answered_by_name?: string | null;
    outcome?: string | null;
    outcome_notes?: string | null;
    /** IG story surfaces (ig_story_mention / ig_story_reply). */
    story_url?: string;
    story_id?: string;
    /** Emoji the customer reacted with on WhatsApp/Instagram (stamped
     *  server-side from the reaction webhook; absent once un-reacted). */
    customer_reaction?: string;
    /** Stamped server-side on replies OUR side sent from the platform's
     *  own app (message echoes) — 'instagram_app' renders the bubble on
     *  the business side with a "via Instagram app" tag. */
    via?: string;
  } | null;
}

/** A card inside a product_share carousel. `kind` matches the catalogue
 * picker domain (base/styled/bundle/service). `capture_url` is the shared
 * `/o/<slug>` order-link URL (same link for every card in the share). */
export interface ProductCard {
  kind: "base" | "styled" | "bundle" | "service";
  id: string;
  name: string;
  price?: string | number | null;
  image_url?: string | null;
  capture_url?: string | null;
  sub?: string | null;
  // Staff-picked styled variant (head size × lace × colour). `spec` is the
  // human label ("Medium · 6×6 Frontal · Spicy Copper"); the codes carry the
  // exact variant so the order is priced + fulfilled for that combination.
  spec?: string | null;
  styled_variant_id?: string | null;
  size_code?: string | null;
  lace_code?: string | null;
  colour_id?: string | null;
}

export interface UnreadCount {
  unread_count: number;
  by_channel: {
    channel_id: string;
    business?: string;
    external_platform?: ExternalPlatform;
    unread: number;
  }[];
}

export interface Customer360 {
  contact: {
    contact_id: string;
    display_name: string;
    first_name?: string | null;
    last_name?: string | null;
    company_name?: string | null;
    primary_phone?: string | null;
    whatsapp_number?: string | null;
    email?: string | null;
    date_of_birth?: string | null;
    instagram_handle?: string | null;
    priority_level?: string | null;
    source?: string | null;
    notes?: string | null;
  };
  handles: {
    platform: string;
    handle?: string | null;
    display_name?: string | null;
    external_user_id?: string | null;
  }[];
  orders: {
    order_id: string;
    order_number: string;
    status: string;
    total: number;
    created_at: string;
    sales_channel?: string;
  }[];
  invoices: {
    invoice_id: string;
    invoice_number: string;
    amount_due: number;
    due_date: string;
  }[];
  deliveries: {
    delivery_id: string;
    delivery_number: string;
    status: string;
    created_at: string;
  }[];
  /** Outbound comms audit (receipts/invoices/tracking sent outside the chat). */
  comms?: {
    log_id: string;
    channel: string;
    event_key?: string | null;
    subject?: string | null;
    recipient?: string | null;
    status: string;
    created_at: string;
  }[];
}

export interface QuickReply {
  reply_id: string;
  scope: "personal" | "brand";
  owner_user_id?: string | null;
  business?: string | null;
  slug: string;
  title: string;
  body: string;
  variables: string[];
  category?: string | null;
  sort_order: number;
  is_active: boolean;
}

/** Editable per-brand composer stock messages + WhatsApp share number.
 *  {link} / {number} placeholders are substituted at insert time. */
export interface ComposerSettings {
  onboarding_template: string;
  whatsapp_handoff_template: string;
  whatsapp_share_number: string | null;
  onboarding_is_custom: boolean;
  whatsapp_is_custom: boolean;
  whatsapp_number_is_custom: boolean;
}

export interface ComposerSettingsInput {
  onboarding_template: string;
  whatsapp_handoff_template: string;
  whatsapp_share_number: string;
}

/** OG/Twitter/bare-HTML metadata for a link shared in a thread — powers the
 *  WhatsApp-style preview card. A failed unfurl comes back as `{ ok:false }`,
 *  so the card renders nothing and the plain clickable link stays. */
export interface LinkPreviewResult {
  ok: boolean;
  preview?: {
    url: string;
    title: string | null;
    description: string | null;
    image: string | null;
    site_name: string | null;
    favicon: string | null;
    type: string | null;
  };
}

export interface MessageDraft {
  channel_id: string;
  user_id: string;
  content: string;
  attachments: MessageAttachment[];
  reply_to_id?: string | null;
  generated_by: "human" | "praxis";
  generated_at?: string | null;
  updated_at: string;
  /** Present on Praxis drafts: "reply" answers the customer's last
   *  message; "followup" nudges a customer who hasn't replied yet. */
  draft_mode?: "reply" | "followup";
}
