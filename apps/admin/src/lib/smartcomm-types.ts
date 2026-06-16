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
  | "system";
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
  contact_display_name?: string | null;
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
  metadata?: ChannelMetadata;
  last_message_at?: string | null;
  last_message_preview?: string | null;
  last_message_kind?: MessageType | null;
  unread_count: number;
  is_pinned?: boolean;
  muted_until?: string | null;
  my_role?: ParticipantRole | null;
  members?: ChannelMember[] | null;
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
    company_name?: string | null;
    primary_phone?: string | null;
    whatsapp_number?: string | null;
    email?: string | null;
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

export interface MessageDraft {
  channel_id: string;
  user_id: string;
  content: string;
  attachments: MessageAttachment[];
  reply_to_id?: string | null;
  generated_by: "human" | "praxis";
  generated_at?: string | null;
  updated_at: string;
}
