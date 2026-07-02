/**
 * Praxis workspace (V2.2 §6.29) — the full-page surface behind /praxis.
 *
 * Three regions:
 *   left   — conversation history (resume / archive / new)
 *   centre — the active thread + composer (same component as the drawer)
 *   right  — tabs: Pending queue (the confirm gate, across all
 *            conversations) · Trace (run steps for the active thread) ·
 *            Abilities (the ai_enabled action catalogue)
 *
 * Mobile stacks: history collapses into a select, the right rail folds under
 * the thread. Four states everywhere; permission-denied renders DeniedState.
 */

import { useState } from "react";
import {
  Archive,
  ListChecks,
  MessageSquare,
  Plus,
  ScrollText,
  Sparkles,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Button,
  Card,
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

type RailTab = "pending" | "trace" | "abilities";

function ConversationList({
  activeId,
  onPick,
}: {
  activeId: string | null;
  onPick: (id: string | null) => void;
}) {
  const list = useConversations();
  const archive = useArchiveConversation();

  return (
    <Card className="flex flex-col min-h-0 h-full p-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-line">
        <h3 className="font-display text-[15px]">Conversations</h3>
        <IconButton aria-label="New conversation" onClick={() => onPick(null)}>
          <Plus className="w-4 h-4" />
        </IconButton>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {list.isLoading ? (
          <div className="space-y-2 p-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState
            message="Couldn't load conversations."
            onRetry={() => list.refetch()}
          />
        ) : (list.data ?? []).length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="w-7 h-7" />}
            title="No conversations yet"
            message="Start one — ask about sales, stock, or tell Praxis what to do."
          />
        ) : (
          (list.data ?? []).map((c) => (
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
                  {new Date(c.updated_at).toLocaleString()}
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
    </Card>
  );
}

function PendingQueue() {
  const pending = usePendingActions();
  const items = pending.data ?? [];
  const open = items.filter((p) => p.status === "proposed");
  const recent = items.filter((p) => p.status !== "proposed").slice(0, 10);

  if (pending.isLoading)
    return (
      <div className="space-y-2">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-24" />
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
          <Skeleton key={i} className="h-10" />
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
          <Pill tone={s.status === "completed" ? "success" : s.status === "failed" ? "danger" : "info"}>
            {s.status}
          </Pill>
          {s.duration_ms != null && (
            <span className="text-[11px] text-text-muted">{s.duration_ms}ms</span>
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
          <Skeleton key={i} className="h-12" />
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

export default function PraxisPage() {
  const can = useAuthStore((s) => s.can);
  const { conversationId, setConversation } = usePraxisDockStore();
  const [tab, setTab] = useState<RailTab>("pending");
  const pending = usePendingActions("proposed");
  usePraxisRealtime();

  if (!can("praxis_ai", "view")) {
    return (
      <DeniedState message="Praxis is limited to the CEO in this rollout. Ask for the praxis_ai grant if you need it." />
    );
  }

  const openCount = (pending.data ?? []).length;
  const TABS: { key: RailTab; label: string; icon: React.ReactNode }[] = [
    {
      key: "pending",
      label: openCount > 0 ? `Pending (${openCount})` : "Pending",
      icon: <ListChecks className="w-3.5 h-3.5" />,
    },
    { key: "trace", label: "Trace", icon: <ScrollText className="w-3.5 h-3.5" /> },
    { key: "abilities", label: "Abilities", icon: <Wand2 className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="flex flex-col gap-4 h-[calc(100dvh-140px)] min-h-[480px]">
      <header className="flex items-center gap-3">
        <div className="grid place-items-center w-11 h-11 rounded-[14px] bg-[linear-gradient(140deg,rgb(var(--accent)),var(--biz-2))] text-[#F4E9D9]">
          <Sparkles className="w-5 h-5" />
        </div>
        <div>
          <h1 className="font-display text-2xl leading-tight">Praxis</h1>
          <p className="text-[12.5px] text-text-muted">
            Reads freely · writes only with your sign-off · acts with your
            permissions
          </p>
        </div>
      </header>

      <div className="grid gap-4 min-h-0 flex-1 grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_340px]">
        <div className="hidden lg:block min-h-0">
          <ConversationList activeId={conversationId} onPick={setConversation} />
        </div>

        <Card className="p-0 overflow-hidden min-h-[380px] lg:min-h-0 flex flex-col">
          <PraxisConversation
            conversationId={conversationId}
            onConversationCreated={setConversation}
          />
        </Card>

        <Card className="p-0 overflow-hidden min-h-0 flex flex-col">
          <div className="flex gap-1 p-2 border-b border-line">
            {TABS.map((t) => (
              <Button
                key={t.key}
                size="sm"
                variant={tab === t.key ? "primary" : "ghost"}
                icon={t.icon}
                onClick={() => setTab(t.key)}
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
        </Card>
      </div>

      {/* Mobile: history below the thread (the rail tabs cover the rest). */}
      <div className="lg:hidden">
        <ConversationList activeId={conversationId} onPick={setConversation} />
      </div>
    </div>
  );
}
