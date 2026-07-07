import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, Maximize2, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useChatDockStore } from "@/stores/chat-dock";
import { useAuthStore } from "@/stores/auth";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useInboxRealtime } from "@/hooks/useSmartcomm";
import { ChannelList } from "./ChannelList";
import { MessageThread } from "./MessageThread";
import { NewChatModal } from "./NewChatModal";

/**
 * ChatDock — right-edge glass drawer from the FloatingLauncher.
 * Slides in over any page so a quick reply doesn't cost the page
 * you're on. Esc + click-outside close. Hides on /smartcomm (full
 * page covers it). Desktop only — mobile uses the full page.
 */
export function ChatDock() {
  const isDesktop = useIsDesktop();
  const open = useChatDockStore((s) => s.open);
  const channelId = useChatDockStore((s) => s.selectedChannelId);
  const setChannel = useChatDockStore((s) => s.setChannel);
  const closeDock = useChatDockStore((s) => s.closeDock);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  const [newChat, setNewChat] = useState<null | "chat" | "group">(null);
  const newChatOpen = newChat !== null;
  useInboxRealtime(user?.id);

  // Hide on the full /smartcomm page (would be a duplicate).
  useEffect(() => {
    if (open && pathname.startsWith("/smartcomm")) closeDock();
  }, [open, pathname, closeDock]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (newChatOpen) return; // let the modal own the key
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      closeDock();
    }
    function onClick(e: PointerEvent) {
      if (newChatOpen) return; // portal modal sits outside the dock DOM
      const t = e.target as HTMLElement | null;
      if (!t || ref.current?.contains(t)) return;
      if (t.closest("[data-chat-dock-keep]")) return;
      closeDock();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onClick);
    };
  }, [open, closeDock, newChatOpen]);

  if (!isDesktop || !open) return null;

  function expand() {
    const target = channelId ? `/smartcomm?channel=${channelId}` : "/smartcomm";
    closeDock();
    navigate(target);
  }

  return (
    <aside
      ref={ref}
      data-chat-dock-keep
      className={cn(
        "fixed inset-y-0 right-0 z-[85] w-[420px] flex flex-col",
        "dropglass border-l hairline shadow-[-30px_0_80px_rgb(0_0_0/0.5)]",
      )}
      role="complementary"
      aria-label="Chat dock"
    >
      <div className="flex items-center gap-2 px-3 py-2.5 border-b hairline">
        {channelId && (
          <button
            onClick={() => setChannel(null)}
            title="All conversations"
            className="text-text-muted hover:text-text-primary"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
        <p className="flex-1 truncate font-display text-[14px]">Messages</p>
        {!channelId && (
          <button
            onClick={() => setNewChat("chat")}
            title="New conversation"
            className="text-text-muted hover:text-text-primary"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={expand}
          title="Open full Messaging"
          className="text-text-muted hover:text-text-primary"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        <button
          onClick={closeDock}
          title="Close"
          className="text-text-muted hover:text-text-primary"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {channelId ? (
          <MessageThread
            channelId={channelId}
            onBack={() => setChannel(null)}
          />
        ) : (
          <ChannelList
            activeChannelId={null}
            onSelect={(c) => setChannel(c.channel_id)}
            onNewChannel={(mode) => setNewChat(mode ?? "chat")}
            compact
          />
        )}
      </div>
      <NewChatModal
        open={newChatOpen}
        initialMode={newChat ?? "chat"}
        onClose={() => setNewChat(null)}
        onStarted={(id) => {
          setNewChat(null);
          setChannel(id);
        }}
      />
    </aside>
  );
}
