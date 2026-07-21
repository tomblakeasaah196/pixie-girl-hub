import { useEffect, useRef, useState } from "react";
import { useSearchParams, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";
import { useIsPhone } from "@/hooks/useMediaQuery";
import { useChannel, useInboxRealtime } from "@/hooks/useSmartcomm";
import { ChannelList } from "@/components/messaging/ChannelList";
import { MessageThread } from "@/components/messaging/MessageThread";
import { CustomerSidebar } from "@/components/messaging/CustomerSidebar";
import { CustomerPanelDrawer } from "@/components/messaging/CustomerPanelDrawer";
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
  const location = useLocation();
  const navigate = useNavigate();
  const channelId = params.get("channel");
  const dmUser = params.get("dm_user");
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const [newChat, setNewChat] = useState<null | "chat" | "group">(null);
  // Deep-link from the Contacts "Message" button: open the customer compose
  // pre-selected to a contact + channel. Delivered via router state so no
  // contact PII rides in the URL.
  const [msgCustomer, setMsgCustomer] = useState<{
    contact: {
      contact_id: string;
      display_name: string;
      primary_phone?: string | null;
      email?: string | null;
    };
    channel?: "whatsapp" | "email" | "instagram";
  } | null>(null);
  const msgHandled = useRef(false);
  useEffect(() => {
    const st = location.state as {
      messageCustomer?: {
        contact_id: string;
        display_name: string;
        primary_phone?: string | null;
        email?: string | null;
      };
      channel?: "whatsapp" | "email" | "instagram";
    } | null;
    if (st?.messageCustomer && !msgHandled.current) {
      msgHandled.current = true;
      setMsgCustomer({ contact: st.messageCustomer, channel: st.channel });
      // Clear the state so a refresh / back-nav doesn't reopen the composer.
      navigate(location.pathname + location.search, {
        replace: true,
        state: null,
      });
    }
  }, [location, navigate]);
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem(SIDEBAR_PREF_KEY) !== "0",
  );
  // Below `xl` the Customer-360 column (below) isn't rendered at all — this
  // drives the floating edge-tab + overlay drawer that stands in for it.
  const [mobileCustomerOpen, setMobileCustomerOpen] = useState(false);
  useEffect(() => {
    setMobileCustomerOpen(false);
  }, [channelId]);
  // On phone widths the list/thread stack into a single pane (below). Once a
  // thread is open there, take the whole viewport WhatsApp-style: ask the
  // shell to step out of its own top bar / bottom nav / floating launcher
  // instead of us fighting their fixed heights with a magic-number calc.
  const isPhone = useIsPhone();
  const setImmersive = useUiStore((s) => s.setImmersive);
  const immersive = isPhone && mobileShowThread && !!channelId;
  useEffect(() => {
    setImmersive(immersive);
  }, [immersive, setImmersive]);
  useEffect(() => () => setImmersive(false), [setImmersive]);
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
    <div
      className={cn(
        "relative overflow-hidden rounded-none border-y hairline",
        "h-[calc(100dvh-64px)] min-h-[420px] -mx-[34px] -mt-[26px] -mb-[120px]",
        "max-md:h-[calc(100dvh-124px)] max-md:-mx-4 max-md:-mt-5 max-md:-mb-24",
        // Immersive: escape the shell's padded content column entirely and
        // pin edge-to-edge to the viewport — the shell has already stepped
        // its own chrome out (AppShell reads the same `immersive` flag), so
        // this is the only chrome left on screen. See PageTransition.tsx's
        // note on why `position: fixed` here is safe to rely on.
        immersive &&
          "max-md:fixed max-md:inset-0 max-md:z-[100] max-md:m-0 max-md:h-[100dvh] max-md:min-h-0 max-md:border-0 max-md:rounded-none max-md:pt-safe",
      )}
    >
      <div
        className={cn(
          "grid h-full grid-cols-1 md:grid-cols-[320px_minmax(0,1fr)] transition-[grid-template-columns] duration-300 ease-in-out overflow-hidden",
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
            "h-full min-w-0 overflow-hidden",
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

      {/* Customer-360 stand-in below `xl`: the persistent column above is
          `hidden xl:block`, so this is the only way to reach it on tablet
          and phone. Same idea as the desktop collapse toggle — a tab
          hanging off the right edge — just an overlay drawer instead of a
          persistent column since there's no spare width to push into. */}
      {channelId && channel && (mobileShowThread || !isPhone) && (
        <button
          onClick={() => setMobileCustomerOpen(true)}
          aria-label="Show customer details"
          title="Customer details"
          className={cn(
            "xl:hidden fixed right-0 top-1/2 -translate-y-1/2 z-[70]",
            "flex flex-col items-center gap-1 py-3 pl-2 pr-1.5 rounded-l-xl",
            "dropglass border border-r-0 text-text-muted hover:text-accent-glow",
            "shadow-[-8px_0_20px_rgb(0_0_0/0.35)] transition-colors",
          )}
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          <span className="text-[9px] font-semibold uppercase tracking-[0.15em] [writing-mode:vertical-rl]">
            Info
          </span>
        </button>
      )}
      <CustomerPanelDrawer
        open={mobileCustomerOpen}
        onClose={() => setMobileCustomerOpen(false)}
        channel={channel}
      />

      <NewChatModal
        open={newChat !== null || msgCustomer !== null}
        initialMode={msgCustomer ? "customer" : (newChat ?? "chat")}
        initialCustomer={msgCustomer?.contact}
        initialChannel={msgCustomer?.channel}
        onClose={() => {
          setNewChat(null);
          setMsgCustomer(null);
        }}
        onStarted={(id) => {
          setNewChat(null);
          setMsgCustomer(null);
          select(id);
          setMobileShowThread(true);
        }}
      />
    </div>
  );
}
