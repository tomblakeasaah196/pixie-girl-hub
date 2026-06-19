/**
 * Messaging utility helpers — pure functions used across the chat UI.
 *
 * Lifted with simplifications from the hub-system reference's
 * `messagingConstants.ts`.
 */

import type { Channel, ChannelMember } from "@/lib/smartcomm-types";

// ── Platform meta (label + colour + icon) ────────────────

export const PLATFORM_META: Record<
  string,
  { label: string; color: string; bg: string; icon: string }
> = {
  whatsapp: {
    label: "WhatsApp",
    color: "#25D366",
    bg: "rgb(37 211 102 / 0.12)",
    icon: "💬",
  },
  instagram: {
    label: "Instagram",
    color: "#E1306C",
    bg: "rgb(225 48 108 / 0.12)",
    icon: "📷",
  },
  facebook: {
    label: "Messenger",
    color: "#0084FF",
    bg: "rgb(0 132 255 / 0.12)",
    icon: "💙",
  },
  email: {
    label: "Email",
    color: "#4E9AF1",
    bg: "rgb(78 154 241 / 0.12)",
    icon: "📧",
  },
  website_chat: {
    label: "Website",
    color: "#A78BFA",
    bg: "rgb(167 139 250 / 0.12)",
    icon: "🌐",
  },
  internal: {
    label: "Internal",
    color: "#C9A86C",
    bg: "rgb(201 168 108 / 0.12)",
    icon: "🏢",
  },
};

export function getChannelPlatform(c: Channel): string {
  if (c.channel_type === "group" || c.channel_type === "direct")
    return "internal";
  return c.external_platform || "whatsapp";
}

// ── Channel display name ─────────────────────────────────

export function getDirectPeer(
  channel: Channel,
  selfUserId?: string,
): ChannelMember | null {
  if (channel.channel_type !== "direct") return null;
  return (
    (channel.members ?? []).find(
      (m) => m.user_id && m.user_id !== selfUserId,
    ) ?? null
  );
}

export function getChannelDisplayName(
  channel: Channel,
  selfUserId?: string,
): string {
  if (channel.name) return channel.name;
  if (channel.channel_type === "customer_thread") {
    const customer = (channel.members ?? []).find((m) => m.contact_id);
    return (
      customer?.contact_display_name ||
      customer?.primary_phone ||
      customer?.email ||
      "Customer"
    );
  }
  if (channel.channel_type === "direct") {
    const peer = getDirectPeer(channel, selfUserId);
    return peer?.user_display_name || "Direct message";
  }
  const others = (channel.members ?? [])
    .filter((m) => m.user_display_name || m.contact_display_name)
    .map((m) => m.user_display_name || m.contact_display_name);
  return others.length ? others.slice(0, 3).join(", ") : "Conversation";
}

// ── Avatars ──────────────────────────────────────────────

const AVATAR_COLOURS = [
  "#C9A86C",
  "#7FB069",
  "#5B9BD5",
  "#C0626E",
  "#9B7EDE",
  "#4DB6AC",
  "#E2934D",
  "#D46BA3",
];

export function getAvatarColour(name?: string | null): string {
  if (!name) return AVATAR_COLOURS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length];
}

export function getInitials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

// ── Time helpers ─────────────────────────────────────────

export function fmtRelativeTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString("en-NG", { month: "short", day: "numeric" });
}

export function fmtClockTime(iso?: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function fmtDayLabel(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString("en-NG", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function isSameDay(isoA?: string | null, isoB?: string | null): boolean {
  if (!isoA || !isoB) return false;
  const a = new Date(isoA);
  const b = new Date(isoB);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function fmtCountdown(iso?: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const hrs = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (hrs >= 1) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

// ── Message preview ──────────────────────────────────────

export function previewFromKind(
  kind?: string | null,
  content?: string | null,
): string {
  if (!kind && !content) return "No messages yet";
  switch (kind) {
    case "image":
      return content || "📷 Photo";
    case "voice_note":
      return "🎤 Voice note";
    case "document":
      return content || "📄 Document";
    case "video":
      return "🎬 Video";
    case "sticker":
      return "🌟 Sticker";
    case "system":
      return content || "Update";
    default:
      return content || "";
  }
}

// ── Cost-info content (the modal copy) ───────────────────

export const COST_INFO = {
  whatsapp_window_open:
    "We're inside the 24-hour service window. Every reply you send to this customer right now is FREE — Meta doesn't charge while the customer-initiated window is open.",
  whatsapp_window_closed:
    "The 24-hour service window has expired. Free-form replies are blocked — we can only send approved templates, each one billed by Meta (~₦11 utility / ~₦88 marketing).",
  whatsapp_outbound:
    "Starting a new WhatsApp conversation (when the customer hasn't messaged us in 24h) costs ~₦11 per utility template or ~₦88 per marketing template. The Hub blocks this by default — only staff with explicit WhatsApp Send permission can do it.",
  instagram_window_open:
    "Inside Instagram's 24-hour window — every reply is FREE.",
  instagram_window_closed:
    "Instagram window has expired. Only the HUMAN_AGENT tag allows reaching this customer (free, but reserved for genuine service-resolution).",
  email_free:
    "Email is free at any volume. Used for receipts, invoices, and confirmations.",
};
