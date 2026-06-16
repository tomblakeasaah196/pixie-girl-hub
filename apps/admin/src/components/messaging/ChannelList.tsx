import { useState } from "react";
import { Search, Pin, BellOff, Plus } from "lucide-react";
import {
  fmtRelativeTime,
  getAvatarColour,
  getChannelDisplayName,
  getChannelPlatform,
  getInitials,
  previewFromKind,
} from "@/lib/messaging-utils";
import { useChannels } from "@/hooks/useSmartcomm";
import { useAuthStore } from "@/stores/auth";
import { cn } from "@/lib/cn";
import type { Channel, ExternalPlatform } from "@/lib/smartcomm-types";
import { PlatformPill } from "./PlatformPill";

interface Props {
  activeChannelId?: string | null;
  onSelect: (channel: Channel) => void;
  onNewChannel?: () => void;
  /** Compact = drawer; default = full page. */
  compact?: boolean;
}

type Tab = "all" | "unread" | "groups" | "wa" | "ig" | "email";

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "groups", label: "Groups" },
  { key: "wa", label: "WhatsApp" },
  { key: "ig", label: "Instagram" },
  { key: "email", label: "Email" },
];

function paramsForTab(tab: Tab): {
  channel_type?: string;
  platform?: "internal" | ExternalPlatform;
} {
  switch (tab) {
    case "groups":
      return { channel_type: "group" };
    case "wa":
      return { channel_type: "customer_thread", platform: "whatsapp" };
    case "ig":
      return { channel_type: "customer_thread", platform: "instagram" };
    case "email":
      return { channel_type: "customer_thread", platform: "email" };
    default:
      return {};
  }
}

export function ChannelList({
  activeChannelId,
  onSelect,
  onNewChannel,
  compact,
}: Props) {
  const user = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const params = paramsForTab(tab);
  const { data, isLoading } = useChannels({ ...params, q: q || undefined });

  const channels = (data ?? []).filter((c) =>
    tab === "unread" ? (c.unread_count ?? 0) > 0 : true,
  );
  const totalUnread = (data ?? []).reduce(
    (s, c) => s + (c.unread_count ?? 0),
    0,
  );

  return (
    <div className="flex h-full flex-col bg-panel/50 border-r hairline">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b hairline">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-[15px] font-medium">Inbox</h2>
          {totalUnread > 0 && (
            <span className="grid place-items-center min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-bg text-[10px] font-bold">
              {totalUnread > 99 ? "99+" : totalUnread}
            </span>
          )}
        </div>
        {onNewChannel && (
          <button
            onClick={onNewChannel}
            className="text-text-muted hover:text-text-primary"
            title="New conversation"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search conversations…"
            className="w-full pl-8 pr-3 py-2 rounded-xl bg-panel-2 border hairline text-[12.5px] focus:outline-none focus:border-accent/40 placeholder:text-text-faint"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto px-3 pb-2 no-scrollbar">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors",
              tab === t.key
                ? "bg-accent text-bg"
                : "text-text-muted hover:bg-panel-2 hover:text-text-primary",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-2 space-y-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-14 rounded-xl bg-panel-2 border hairline animate-pulse"
              />
            ))}
          </div>
        ) : channels.length === 0 ? (
          <div className="py-12 text-center text-[12.5px] text-text-faint">
            {tab === "unread" ? "All caught up 🎉" : "No conversations yet"}
          </div>
        ) : (
          <div className="px-2 pb-3 space-y-px">
            {channels.map((c) => (
              <ChannelRow
                key={c.channel_id}
                channel={c}
                isActive={c.channel_id === activeChannelId}
                onClick={() => onSelect(c)}
                selfUserId={user?.id}
                compact={compact}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ChannelRow({
  channel,
  isActive,
  onClick,
  selfUserId,
  compact,
}: {
  channel: Channel;
  isActive: boolean;
  onClick: () => void;
  selfUserId?: string;
  compact?: boolean;
}) {
  const name = getChannelDisplayName(channel, selfUserId);
  const platform = getChannelPlatform(channel);
  const unread = channel.unread_count ?? 0;
  const last = channel.last_message_at;
  const preview = previewFromKind(
    channel.last_message_kind,
    channel.last_message_preview,
  );
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors",
        isActive ? "bg-panel-2 border hairline" : "hover:bg-panel-2/60",
      )}
    >
      <div className="relative shrink-0">
        <div
          className="grid place-items-center w-10 h-10 rounded-full text-[12px] font-semibold text-white"
          style={{ backgroundColor: getAvatarColour(name) }}
        >
          {getInitials(name)}
        </div>
        {platform !== "internal" && (
          <span className="absolute -bottom-0.5 -right-0.5">
            <PlatformPill platform={platform} />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-1">
          <p
            className={cn(
              "truncate text-[12.5px] flex items-center gap-1",
              unread > 0 ? "text-text-primary font-medium" : "text-text-muted",
            )}
          >
            <span className="truncate">{name}</span>
            {channel.is_pinned && (
              <Pin className="w-3 h-3 text-accent-glow shrink-0" />
            )}
            {channel.muted_until && (
              <BellOff className="w-3 h-3 text-text-faint shrink-0" />
            )}
          </p>
          <span
            className={cn(
              "shrink-0 text-[10px]",
              unread > 0 ? "text-accent-glow font-semibold" : "text-text-faint",
            )}
          >
            {fmtRelativeTime(last)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-1">
          <p
            className={cn(
              "truncate text-[11.5px]",
              unread > 0 ? "text-text-primary" : "text-text-faint",
            )}
          >
            {preview || "No messages yet"}
          </p>
          {unread > 0 && (
            <span
              className={cn(
                "grid place-items-center min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold shrink-0",
                channel.muted_until
                  ? "bg-text-faint/30 text-bg"
                  : "bg-accent text-bg",
              )}
            >
              {unread}
            </span>
          )}
        </div>
      </div>
      {compact ? null : null /* CompactPill space reserved */}
    </button>
  );
}
