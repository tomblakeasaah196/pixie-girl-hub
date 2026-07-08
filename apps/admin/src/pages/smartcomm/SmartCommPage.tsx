import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import { useChannel, useInboxRealtime } from "@/hooks/useSmartcomm";
import { ChannelList } from "@/components/messaging/ChannelList";
import { MessageThread } from "@/components/messaging/MessageThread";
import { CustomerSidebar } from "@/components/messaging/CustomerSidebar";
import { NewChatModal } from "@/components/messaging/NewChatModal";
import { smartcommApi } from "@/lib/smartcomm-api";
import { cn } from "@/lib/cn";

const SIDEBAR_PREF_KEY = "smartcomm.sidebarOpen";

/**
 * Full Messaging page — three-pane workstation (list / thread /
 * customer-360) on desktop, single-pane stack on mobile.
 *
 * The selected channel rides in the URL query (?channel=…) so reps can
 * share a link to a conversation. `?dm_user=<userId>` opens (or creates) a
 * 1:1 DM with a colleague — the deep link behind every HR "Message" button.
 */
export function SmartCommPage() {
  useBreadcrumbs([{ label: "Messaging" }]);
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const channelId = params.get("channel");
  const dmUser = params.get("dm_user");
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const [newChat, setNewChat] = useState<null | "chat" | "group">(null);
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem(SIDEBAR_PREF_KEY) !== "0",
  );
  // Draw a one-time bit of attention to the collapse/expand toggle the
  // first time this page mounts in a session, so reps who never noticed
  // it discover it exists.
  const [drawAttention, setDrawAttention] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setDrawAttention(false), 2600);
    return () => window.clearTimeout(t);
  }, []);
  useInboxRealtime(user?.id);

  const { data: channel } = useChannel(channelId);

  // Keep mobile view in sync with selection
  useEffect(() => {
    if (channelId) setMobileShowThread(true);
  }, [channelId]);

  function select(id: string) {
    const next = new URLSearchParams(params);
    next.delete("dm_user");
    next.set("channel", id);
    setParams(next, { replace: false });
  }

  // Resolve a ?dm_user deep link into an open DM channel (find-or-create).
  const dmResolving = useRef<string | null>(null);
  useEffect(() => {
    if (!dmUser || dmResolving.current === dmUser) return;
    dmResolving.current = dmUser;
    smartcommApi
      .startDirect(dmUser)
      .then((ch) => {
        qc.invalidateQueries({ queryKey: ["smartcomm", "channels"] });
        const next = new URLSearchParams(params);
        next.delete("dm_user");
        next.set("channel", ch.channel_id);
        setParams(next, { replace: true });
        setMobileShowThread(true);
      })
      .catch(() => {
        const next = new URLSearchParams(params);
        next.delete("dm_user");
        setParams(next, { replace: true });
      });
  }, [dmUser, params, qc, setParams]);

  return (
    <div className="relative h-[calc(100vh-180px)] min-h-[520px] -mx-[34px] -my-[26px] max-md:-mx-4 max-md:-my-5 rounded-none border-y hairline">
      <div
        className={cn(
          "grid h-full grid-cols-1 md:grid-cols-[320px_minmax(0,1fr)] transition-[grid-template-columns] duration-300 ease-in-out",
          sidebarOpen
            ? "xl:grid-cols-[320px_minmax(0,1fr)_320px]"
            : "xl:grid-cols-[320px_minmax(0,1fr)_0px]",
        )}
      >
        {/* List */}
        <div
          className={
            mobileShowThread
              ? "hidden md:block h-full overflow-hidden"
              : "h-full overflow-hidden"
          }
        >
          <ChannelList
            activeChannelId={channelId}
            onSelect={(c) => {
              select(c.channel_id);
              setMobileShowThread(true);
            }}
            onNewChannel={(mode) => setNewChat(mode ?? "chat")}
          />
        </div>

        {/* Thread */}
        <div
          className={cn(
            "h-full min-w-0",
            !mobileShowThread && "hidden md:block",
          )}
        >
          {channelId ? (
            <MessageThread
              channelId={channelId}
              onBack={() => setMobileShowThread(false)}
            />
          ) : (
            <div className="grid h-full place-items-center text-text-faint text-[13px]">
              Pick a conversation to start.
            </div>
          )}
        </div>

        {/* Customer-360 */}
        <div className="hidden xl:block h-full overflow-hidden">
          <div className="w-[320px] h-full">
            {channel && <CustomerSidebar channel={channel} />}
          </div>
        </div>
      </div>

      {/* Collapse/expand toggle for the Customer-360 pane — sits on the
          seam between the thread and the sidebar. */}
      {channelId && (
        <button
          onClick={() => {
            setSidebarOpen((v) => {
              const next = !v;
              localStorage.setItem(SIDEBAR_PREF_KEY, next ? "1" : "0");
              return next;
            });
            setDrawAttention(false);
          }}
          title={sidebarOpen ? "Collapse customer panel" : "Show customer panel"}
          className={cn(
            "hidden xl:grid absolute top-1/2 -translate-y-1/2 z-10 place-items-center",
            "w-6 h-12 rounded-l-lg border hairline bg-panel shadow-md",
            "text-text-muted hover:text-accent-glow hover:bg-panel-2",
            "transition-[right] duration-300 ease-in-out",
            drawAttention && "animate-bounce",
          )}
          style={{ right: sidebarOpen ? 320 : 0 }}
        >
          {sidebarOpen ? (
            <PanelRightClose className="w-3.5 h-3.5" />
          ) : (
            <PanelRightOpen className="w-3.5 h-3.5" />
          )}
        </button>
      )}

      <NewChatModal
        open={newChat !== null}
        initialMode={newChat ?? "chat"}
        onClose={() => setNewChat(null)}
        onStarted={(id) => {
          setNewChat(null);
          select(id);
          setMobileShowThread(true);
        }}
      />
    </div>
  );
}
