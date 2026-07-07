/**
 * Praxis workspace (V2.2 §6.29) — the full-page surface behind /praxis.
 *
 * A focused, Claude/Gemini-style three-region workspace inside one glass frame:
 *   left   — conversation history (search / resume / archive / new)
 *   centre — the active thread + welcome + composer (shared with the drawer)
 *   right  — a collapsible context rail: Pending queue (the confirm gate across
 *            all conversations) · Trace (run steps for the active thread) ·
 *            Abilities (the ai_enabled action catalogue)
 *
 * Desktop keeps all three visible (history + rail each collapse to give the
 * conversation room). Mobile shows the conversation full-bleed; history and the
 * context rail open as slide-overs from a slim toolbar. Four states everywhere;
 * permission-denied renders DeniedState.
 */

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Archive,
  ListChecks,
  MessageSquare,
  PanelLeft,
  PanelRight,
  Plus,
  ScrollText,
  Search,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Button,
  EmptyState,
  IconButton,
  Pill,
  Skeleton,
} from "@/components/ui/primitives";
import { DeniedState, ErrorState } from "@/components/ui/controls";
import { PraxisConversation } from "@/components/praxis/PraxisConversation";
import { PendingActionCard } from "@/components/praxis/PendingActionCard";
import {
  useArchiveConversation,
  useConversations,
  useEnabledActions,
  usePendingActions,
  usePraxisRealtime,
  useRunSteps,
} from "@/lib/praxis-api";
import { usePraxisDockStore } from "@/stores/praxis-dock";
import { useAuthStore } from "@/stores/auth";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { formatDate } from "@/lib/format";

type RailTab = "pending" | "trace" | "abilities";

/** Relative "when" for a conversation, safe against missing/invalid dates. */
function formatWhen(iso?: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(t);
}

/* ── History rail ─────────────────────────────────────────────────────── */

function ConversationList({
  activeId,
  onPick,
}: {
  activeId: string | null;
  onPick: (id: string | null) => void;
}) {
  const list = useConversations();
  const archive = useArchiveConversation();
  const [q, setQ] = useState("");

  const items = useMemo(() => {
    const all = list.data ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((c) =>
      (c.title || "Untitled conversation").toLowerCase().includes(needle),
    );
  }, [list.data, q]);

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="p-3 space-y-2.5">
        <Button
          variant="primary"
          size="sm"
          icon={<Plus className="w-4 h-4" />}
          className="w-full justify-center"
          onClick={() => onPick(null)}
        >
          New conversation
        </Button>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search conversations"
            className="w-full h-9 pl-9 pr-3 rounded-xl bg-text-primary/[0.04] border border-line text-[12.5px] outline-none focus:border-accent/45 no-min-h" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {list.isLoading ? (
          <div className="space-y-2 p-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-11 rounded-xl" />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState
            message="Couldn't load conversations."
            onRetry={() => list.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="w-7 h-7" />}
            title={q ? "No matches" : "No conversations yet"}
            message={
              q
                ? "Try a different search."
                : "Start one — ask about sales, stock, or tell Praxis what to do."
            }
          />
        ) : (
          items.map((c) => (
            <button
              key={c.conversation_id}
              onClick={() => onPick(c.conversation_id)}
              className={cn(
                "group w-full flex items-center gap-2 text-left px-3 py-2.5 rounded-xl transition-colors",
                activeId === c.conversation_id
                  ? "bg-accent/[0.12] border border-accent/30"
                  : "hover:bg-text-primary/[0.05] border border-transparent",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium truncate">
                  {c.title || "Untitled conversation"}
                </div>
                <div className="text-[11px] text-text-muted">
                  {formatWhen(
                    c.last_activity_at ?? c.updated_at ?? c.created_at,
                  )}
                </div>
              </div>
              <span
                role="button"
                aria-label="Archive"
                onClick={(e) => {
                  e.stopPropagation();
                  archive.mutate(c.conversation_id, {
                    onSuccess: () => {
                      if (activeId === c.conversation_id) onPick(null);
                    },
                  });
                }}
                className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-danger transition-opacity p-1"
              >
                <Archive className="w-3.5 h-3.5" />
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/* ── Context rail panels ──────────────────────────────────────────────── */

function PendingQueue() {
  const pending = usePendingActions();
  const items = pending.data ?? [];
  const open = items.filter((p) => p.status === "proposed");
  const recent = items.filter((p) => p.status !== "proposed").slice(0, 10);

  if (pending.isLoading)
    return (
      <div className="space-y-2">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  if (pending.isError)
    return (
      <ErrorState
        message="Couldn't load pending actions."
        onRetry={() => pending.refetch()}
      />
    );
  if (items.length === 0)
    return (
      <EmptyState
        icon={<ListChecks className="w-7 h-7" />}
        title="Nothing awaiting you"
        message="When Praxis proposes a change, the confirm card appears here."
      />
    );
  return (
    <div className="space-y-2.5">
      {open.length > 0 && (
        <div className="flex items-center gap-2">
          <Pill tone="warn">{open.length} awaiting confirmation</Pill>
        </div>
      )}
      {open.map((p) => (
        <PendingActionCard key={p.pending_id} action={p} />
      ))}
      {recent.length > 0 && (
        <>
          <div className="micro pt-2">Recent</div>
          {recent.map((p) => (
            <PendingActionCard key={p.pending_id} action={p} compact />
          ))}
        </>
      )}
    </div>
  );
}

function TraceRail({ conversationId }: { conversationId: string | null }) {
  const steps = useRunSteps(conversationId);
  if (!conversationId)
    return (
      <EmptyState
        icon={<ScrollText className="w-7 h-7" />}
        title="No conversation selected"
        message="Open a conversation to see how Praxis worked through it."
      />
    );
  if (steps.isLoading)
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 rounded-xl" />
        ))}
      </div>
    );
  if (steps.isError)
    return (
      <ErrorState
        message="Couldn't load the trace."
        onRetry={() => steps.refetch()}
      />
    );
  if ((steps.data ?? []).length === 0)
    return (
      <EmptyState
        icon={<ScrollText className="w-7 h-7" />}
        title="No steps recorded"
        message="Steps appear once the live orchestrator handles a turn."
      />
    );
  return (
    <ol className="space-y-1.5">
      {(steps.data ?? []).map((s) => (
        <li
          key={s.step_id}
          className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-2"
        >
          <span className="text-[11px] font-mono text-text-muted w-5 text-right">
            {s.step_number}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-medium">
              {s.step_type}
              <span className="text-text-muted font-normal"> · {s.agent}</span>
            </div>
            {s.error_message && (
              <div className="text-[11.5px] text-danger truncate">
                {s.error_message}
              </div>
            )}
          </div>
          <Pill
            tone={
              s.status === "completed"
                ? "success"
                : s.status === "failed"
                  ? "danger"
                  : "info"
            }
          >
            {s.status}
          </Pill>
          {s.duration_ms != null && (
            <span className="text-[11px] text-text-muted">
              {s.duration_ms}ms
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function AbilitiesRail() {
  const actions = useEnabledActions();
  if (actions.isLoading)
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 rounded-xl" />
        ))}
      </div>
    );
  if (actions.isError)
    return (
      <ErrorState
        message="Couldn't load the action catalogue."
        onRetry={() => actions.refetch()}
      />
    );
  const items = actions.data ?? [];
  if (items.length === 0)
    return (
      <EmptyState
        icon={<Wand2 className="w-7 h-7" />}
        title="No actions enabled"
        message="Enable catalogue actions for Praxis in AI Control → Actions."
      />
    );
  return (
    <div className="space-y-1.5">
      {items.map((a) => (
        <div
          key={a.action_id}
          className="rounded-xl border border-line px-3 py-2"
        >
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] font-medium truncate">
              {a.title || a.action_key}
            </span>
            <Pill tone={a.is_write ? "warn" : "info"} dot={false}>
              {a.is_write ? "write · confirms" : "read"}
            </Pill>
          </div>
          {a.description && (
            <p className="text-[11.5px] text-text-muted mt-0.5 line-clamp-2">
              {a.description}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/** The tabbed context rail body (shared by desktop rail + mobile sheet). */
function ContextRail({
  tab,
  setTab,
  conversationId,
  openCount,
}: {
  tab: RailTab;
  setTab: (t: RailTab) => void;
  conversationId: string | null;
  openCount: number;
}) {
  const TABS: { key: RailTab; label: string; icon: React.ReactNode }[] = [
    {
      key: "pending",
      label: openCount > 0 ? `Pending (${openCount})` : "Pending",
      icon: <ListChecks className="w-3.5 h-3.5" />,
    },
    {
      key: "trace",
      label: "Trace",
      icon: <ScrollText className="w-3.5 h-3.5" />,
    },
    {
      key: "abilities",
      label: "Abilities",
      icon: <Wand2 className="w-3.5 h-3.5" />,
    },
  ];
  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex gap-1 p-2 border-b hairline overflow-x-auto hide-scrollbar">
        {TABS.map((t) => (
          <Button
            key={t.key}
            size="sm"
            variant={tab === t.key ? "primary" : "ghost"}
            icon={t.icon}
            onClick={() => setTab(t.key)}
            className="shrink-0"
          >
            {t.label}
          </Button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {tab === "pending" && <PendingQueue />}
        {tab === "trace" && <TraceRail conversationId={conversationId} />}
        {tab === "abilities" && <AbilitiesRail />}
      </div>
    </div>
  );
}

/** Mobile slide-over wrapper (left history / right context). */
function SlideOver({
  open,
  onClose,
  side,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  side: "left" | "right";
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-[70] bg-black/50 backdrop-blur-[3px] transition-opacity duration-300 lg:hidden",
          open ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "fixed top-0 h-full z-[80] flex flex-col dropglass w-[min(340px,88vw)] transition-[transform,visibility] duration-300 ease-brand lg:hidden",
          side === "left"
            ? "left-0 border-r shadow-[30px_0_80px_rgb(0_0_0/0.5)]"
            : "right-0 border-l shadow-[-30px_0_80px_rgb(0_0_0/0.5)]",
          open
            ? "translate-x-0 visible"
            : cn(
                "invisible pointer-events-none",
                side === "left" ? "-translate-x-full" : "translate-x-full",
              ),
        )}
      >
        <div className="flex items-center gap-2 p-3 border-b hairline">
          <h2 className="font-display text-base font-medium flex-1">{title}</h2>
          <IconButton aria-label="Close" onClick={onClose}>
            <X className="w-[18px] h-[18px]" />
          </IconButton>
        </div>
        <div className="flex-1 min-h-0">{children}</div>
      </aside>
    </>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

export default function PraxisPage() {
  const can = useAuthStore((s) => s.can);
  const { conversationId, setConversation } = usePraxisDockStore();
  const isDesktop = useIsDesktop();
  const location = useLocation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<RailTab>("pending");
  const [railOpen, setRailOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [mobileHistory, setMobileHistory] = useState(false);
  const [mobileRail, setMobileRail] = useState(false);
  const pending = usePendingActions("proposed");
  usePraxisRealtime();

  // A caller can deep-link into Praxis with a prefilled composer via nav state,
  // e.g. from the dashboard Insights CTA. We consume it once, park it in local
  // state, open a fresh conversation, then wipe the history entry so a page
  // refresh doesn't re-prefill.
  const [initialText, setInitialText] = useState<string | undefined>(() => {
    const s = location.state as { initialText?: string } | null;
    return s?.initialText;
  });
  useEffect(() => {
    if (initialText !== undefined) {
      setConversation(null);
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!can("praxis_ai", "view")) {
    return (
      <DeniedState message="Praxis is limited to the CEO in this rollout. Ask for the praxis_ai grant if you need it." />
    );
  }

  const openCount = (pending.data ?? []).length;

  const pickConversation = (id: string | null) => {
    setConversation(id);
    setMobileHistory(false);
  };

  return (
    <div className="flex flex-col gap-4 h-[calc(100dvh-140px)] min-h-[520px]">
      {/* Header */}
      <header className="flex items-center gap-3">
        <div className="grid place-items-center w-11 h-11 rounded-[14px] bg-[linear-gradient(140deg,rgb(var(--accent)),var(--biz-2))] text-[#F4E9D9] shadow-[0_10px_28px_rgb(var(--accent-deep)/0.4)]">
          <Sparkles className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-2xl leading-tight">Praxis</h1>
          <p className="text-[12.5px] text-text-muted truncate">
            Reads freely · writes only with your sign-off · acts with your
            permissions
          </p>
        </div>
      </header>

      {/* Workspace frame */}
      <div className="glass rounded-[var(--radius)] shadow-glass overflow-hidden min-h-0 flex-1 flex">
        {/* Left history rail (desktop) */}
        {isDesktop && historyOpen && (
          <div className="w-[280px] shrink-0 border-r hairline min-h-0">
            <ConversationList
              activeId={conversationId}
              onPick={pickConversation}
            />
          </div>
        )}

        {/* Centre column */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {/* Slim toolbar */}
          <div className="flex items-center gap-1.5 px-3 py-2 border-b hairline">
            <IconButton
              aria-label={
                isDesktop
                  ? historyOpen
                    ? "Hide history"
                    : "Show history"
                  : "Conversation history"
              }
              onClick={() =>
                isDesktop
                  ? setHistoryOpen((v) => !v)
                  : setMobileHistory(true)
              }
            >
              <PanelLeft className="w-4 h-4" />
            </IconButton>
            <div className="flex-1 min-w-0 text-center">
              <span className="text-[12.5px] font-semibold text-text-muted">
                {conversationId ? "Conversation" : "New conversation"}
              </span>
            </div>
            <IconButton
              aria-label="New conversation"
              onClick={() => pickConversation(null)}
            >
              <Plus className="w-4 h-4" />
            </IconButton>
            <IconButton
              aria-label={
                isDesktop
                  ? railOpen
                    ? "Hide context"
                    : "Show context"
                  : "Context & pending"
              }
              dot={openCount > 0}
              onClick={() =>
                isDesktop ? setRailOpen((v) => !v) : setMobileRail(true)
              }
            >
              <PanelRight className="w-4 h-4" />
            </IconButton>
          </div>

          <div className="flex-1 min-h-0">
            <PraxisConversation
              conversationId={conversationId}
              onConversationCreated={(id) => {
                setConversation(id);
                if (initialText) setInitialText(undefined);
              }}
              variant="page"
              initialText={initialText}
            />
          </div>
        </div>

        {/* Right context rail (desktop) */}
        {isDesktop && railOpen && (
          <div className="w-[360px] shrink-0 border-l hairline min-h-0">
            <ContextRail
              tab={tab}
              setTab={setTab}
              conversationId={conversationId}
              openCount={openCount}
            />
          </div>
        )}
      </div>

      {/* Mobile slide-overs */}
      <SlideOver
        open={!isDesktop && mobileHistory}
        onClose={() => setMobileHistory(false)}
        side="left"
        title="Conversations"
      >
        <ConversationList activeId={conversationId} onPick={pickConversation} />
      </SlideOver>
      <SlideOver
        open={!isDesktop && mobileRail}
        onClose={() => setMobileRail(false)}
        side="right"
        title="Context"
      >
        <ContextRail
          tab={tab}
          setTab={setTab}
          conversationId={conversationId}
          openCount={openCount}
        />
      </SlideOver>
    </div>
  );
}
