/**
 * Smartcomm hooks — TanStack Query wrappers + realtime invalidation
 * triggered by Socket.io events.
 */

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { smartcommApi, type ChannelListParams } from "@/lib/smartcomm-api";
import { getSocket, joinRoom, leaveRoom, rooms } from "@/lib/socket";

/** List the inbox for the current user (active brand). */
export function useChannels(params: ChannelListParams = {}) {
  return useQuery({
    queryKey: ["smartcomm", "channels", params],
    queryFn: () => smartcommApi.listChannels(params),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}

/** Full channel detail (members + my read pointer). */
export function useChannel(channelId: string | null | undefined) {
  return useQuery({
    queryKey: ["smartcomm", "channel", channelId],
    queryFn: () => smartcommApi.getChannel(channelId!),
    enabled: !!channelId,
    staleTime: 30_000,
  });
}

/** Messages for a channel — joined: reactions + reply preview + sender_name. */
export function useMessages(channelId: string | null | undefined) {
  return useQuery({
    queryKey: ["smartcomm", "messages", channelId],
    queryFn: () => smartcommApi.listMessages(channelId!, { limit: 50 }),
    enabled: !!channelId,
    staleTime: 5_000,
  });
}

/** Unread counter for the floating launcher badge. */
export function useUnreadMessages() {
  return useQuery({
    queryKey: ["smartcomm", "unread"],
    queryFn: () => smartcommApi.getUnread(),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}

/** Customer-360 panel. */
export function useCustomer360(contactId: string | null | undefined) {
  return useQuery({
    queryKey: ["smartcomm", "customer360", contactId],
    queryFn: () => smartcommApi.getCustomer360(contactId!),
    enabled: !!contactId,
    staleTime: 60_000,
  });
}

/** Quick replies catalogue. */
export function useQuickReplies() {
  return useQuery({
    queryKey: ["smartcomm", "quick-replies"],
    queryFn: () => smartcommApi.listQuickReplies(),
    staleTime: 5 * 60_000,
  });
}

/**
 * Subscribe to a single channel's realtime stream. Joins the channel
 * room + the typing room, invalidates queries on relevant events, and
 * cleans up on unmount.
 */
export function useChannelRealtime(channelId: string | null | undefined) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!channelId) return;
    const socket = getSocket();
    joinRoom(rooms.channel(channelId));
    joinRoom(rooms.channelTyping(channelId));

    const onMessagePosted = (p: { channel_id: string }) => {
      if (p.channel_id !== channelId) return;
      qc.invalidateQueries({ queryKey: ["smartcomm", "messages", channelId] });
      qc.invalidateQueries({ queryKey: ["smartcomm", "channels"] });
      qc.invalidateQueries({ queryKey: ["smartcomm", "unread"] });
    };
    const onMessageEdited = (p: { channel_id: string }) => {
      if (p.channel_id !== channelId) return;
      qc.invalidateQueries({ queryKey: ["smartcomm", "messages", channelId] });
    };
    const onMessageDeleted = onMessageEdited;
    const onMessageReacted = onMessageEdited;
    const onChannelRead = (p: { channel_id: string }) => {
      if (p.channel_id === channelId) {
        qc.invalidateQueries({ queryKey: ["smartcomm", "unread"] });
      }
    };

    socket.on("message.posted", onMessagePosted);
    socket.on("message.edited", onMessageEdited);
    socket.on("message.deleted", onMessageDeleted);
    socket.on("message.reacted", onMessageReacted);
    socket.on("channel.read", onChannelRead);

    return () => {
      leaveRoom(rooms.channel(channelId));
      leaveRoom(rooms.channelTyping(channelId));
      socket.off("message.posted", onMessagePosted);
      socket.off("message.edited", onMessageEdited);
      socket.off("message.deleted", onMessageDeleted);
      socket.off("message.reacted", onMessageReacted);
      socket.off("channel.read", onChannelRead);
    };
  }, [channelId, qc]);
}

/**
 * Subscribe to the user's inbox stream — refreshes channel list + unread
 * count when a new message lands anywhere. Use this once at the top of
 * the chat UI.
 */
export function useInboxRealtime(userId: string | null | undefined) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    const socket = getSocket();
    joinRoom(rooms.userMessages(userId));

    const onAny = () => {
      qc.invalidateQueries({ queryKey: ["smartcomm", "channels"] });
      qc.invalidateQueries({ queryKey: ["smartcomm", "unread"] });
    };

    socket.on("message.posted", onAny);
    socket.on("thread.assigned", onAny);
    socket.on("channel.read", onAny);

    return () => {
      socket.off("message.posted", onAny);
      socket.off("thread.assigned", onAny);
      socket.off("channel.read", onAny);
    };
  }, [userId, qc]);
}

/**
 * Typing indicator — listens to ephemeral typing pings in a channel.
 * Returns the set of user_ids actively typing (with 5-second decay).
 */
export function useTypingIndicator(
  channelId: string | null | undefined,
  selfUserId: string | undefined,
): string[] {
  const qc = useQueryClient();

  useEffect(() => {
    if (!channelId) return;
    const socket = getSocket();
    const TYPING_TTL = 5_000;
    const seen = new Map<string, number>();

    const onTyping = (p: { channel_id: string; user_id?: string }) => {
      if (p.channel_id !== channelId || !p.user_id || p.user_id === selfUserId)
        return;
      seen.set(p.user_id, Date.now());
      qc.setQueryData(
        ["smartcomm", "typing", channelId],
        Array.from(seen.keys()),
      );
      window.setTimeout(() => {
        const now = Date.now();
        for (const [uid, ts] of seen.entries()) {
          if (now - ts > TYPING_TTL) seen.delete(uid);
        }
        qc.setQueryData(
          ["smartcomm", "typing", channelId],
          Array.from(seen.keys()),
        );
      }, TYPING_TTL + 200);
    };

    socket.on("typing", onTyping);
    return () => {
      socket.off("typing", onTyping);
      qc.setQueryData(["smartcomm", "typing", channelId], []);
    };
  }, [channelId, selfUserId, qc]);

  const q = useQuery<string[]>({
    queryKey: ["smartcomm", "typing", channelId ?? "_"],
    queryFn: () => Promise.resolve([]),
    enabled: !!channelId,
    staleTime: Infinity,
  });
  return q.data ?? [];
}
