/**
 * AI Chief of Staff — chat tab (PR3, mobile-native rebuild).
 *
 * Talk to the CoS in plain language; it proposes a BATCH PLAN (goal + milestones
 * + tasks + events + notes) that you approve once via BatchPlanCard, then it
 * runs the whole thing as you. Reuses the Praxis composer (PraxisInput) and the
 * Markdown renderer; the plan-approval gate is CoS-specific.
 *
 * On phones this surface goes IMMERSIVE (same contract as Messaging): the shell
 * steps its chrome out and the chat takes the whole viewport — its own glass
 * header, a thread that scrolls under it, and a composer pinned above the home
 * indicator. Desktop/tablet keep the centered in-page column.
 *
 * Any conversation can be saved to Workspace Notes: the CoS offers it inline
 * once it has replied, and a header button lets you save/refresh on demand.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { formatDate } from "@/lib/format";
import {
  Sparkles,
  MessagesSquare,
  AlertCircle,
  RotateCw,
  MessageSquare,
  LayoutGrid,
  Settings2,
  ChevronLeft,
  ChevronRight,
  Plus,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  PanelRightClose,
  History,
  Target,
  CalendarClock,
  Gauge,
  StickyNote,
  Trash2,
  X,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Markdown } from "@/components/help/Markdown";
import { PraxisInput } from "@/components/praxis/PraxisInput";
import {
  ReadAloudButton,
  VoiceSettingsButton,
} from "@/components/praxis/ReadAloud";
import { useReadAloud, type ReadAloudApi } from "@/hooks/useReadAloud";
import { useToast } from "@/lib/toast";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";
import { useIsPhone, useIsDesktop } from "@/hooks/useMediaQuery";
import { BatchPlanCard } from "./BatchPlanCard";
import { CosIntelligencePanel } from "./CosIntelligencePanel";
import { CosSettings } from "./CosSettings";
import { getGreeting } from "./constants";
import {
  useCosConversations,
  useCosConversation,
  useCreateCosConversation,
  useArchiveCosConversation,
  usePostCosMessage,
  useSaveConversationToNotes,
  useCosSettings,
  type CosMessage,
  type CosContinuation,
} from "@/lib/cos-api";

const DEFAULT_COS_NAME = "Chief of Staff";

function Avatar({
  pulse,
  url,
  size = 32,
}: {
  pulse?: boolean;
  url?: string | null;
  size?: number;
}) {
  const radius = Math.max(10, Math.round(size / 2.9));
  if (url) {
    return (
      <img
        src={url}
        alt=""
        style={{ width: size, height: size, borderRadius: radius }}
        className="mt-0.5 object-cover shrink-0 shadow-[0_4px_14px_rgb(var(--accent-deep)/0.4)]"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size, borderRadius: radius }}
      className="mt-0.5 grid place-items-center bg-[linear-gradient(140deg,rgb(var(--accent)),var(--biz-2))] text-[#F4E9D9] shrink-0 shadow-[0_4px_14px_rgb(var(--accent-deep)/0.4)]"
    >
      <Sparkles
        style={{ width: size * 0.5, height: size * 0.5 }}
        className={cn(pulse && "animate-pulse")}
      />
    </div>
  );
}

function Bubble({
  msg,
  avatarUrl,
  tts,
}: {
  msg: CosMessage;
  avatarUrl?: string | null;
  tts: ReadAloudApi;
}) {
  const text = msg.content || msg.transcribed_text || "";
  if (msg.role === "user") {
    return (
      <div className="flex flex-col items-end gap-1">
        {msg.input_mode === "voice" && (
          <span className="pr-1 text-[9.5px] uppercase tracking-[0.18em] text-text-faint font-bold">voice</span>
        )}
        <div className="max-w-[85%] md:max-w-[82%] rounded-[20px] rounded-br-md bg-accent-deep/90 text-[#F4E9D9] px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap break-words shadow-[0_4px_16px_rgb(var(--accent-deep)/0.35)]">
          {text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <Avatar url={avatarUrl} />
      <div className="min-w-0 flex-1 pt-0.5">
        <Markdown
          source={text}
          className="text-[14px] leading-[1.7] text-text-primary space-y-3 [&_ul]:my-1.5 [&_ol]:my-1.5"
        />
        {/* Always visible (not hover-gated) — this surface is phone-first. */}
        {text.trim() && tts.supported && (
          <div className="mt-2 flex items-center gap-3">
            <ReadAloudButton id={msg.message_id} text={text} tts={tts} />
            <VoiceSettingsButton tts={tts} />
          </div>
        )}
      </div>
    </div>
  );
}

function Thinking({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
  return (
    <div className="flex gap-3 items-center">
      <Avatar pulse url={avatarUrl} />
      <span className="inline-flex items-center gap-2 text-[12.5px] text-text-muted">
        <span className="inline-flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-accent-glow animate-bounce"
              style={{ animationDelay: `${i * 140}ms` }}
            />
          ))}
        </span>
        {name} is drafting your plan…
      </span>
    </div>
  );
}

/** One-tap continuation — shown when the last reply stopped short (promised
 *  action with nothing queued). Sends the canned "go ahead" so the CoS picks
 *  up exactly where it ended, instead of making the CEO type it. */
function ContinueNudge({
  continuation,
  disabled,
  onContinue,
}: {
  continuation: CosContinuation;
  disabled: boolean;
  onContinue: () => void;
}) {
  return (
    <div className="pl-11 flex items-center gap-3">
      <button
        type="button"
        disabled={disabled}
        onClick={onContinue}
        className="inline-flex items-center gap-1.5 rounded-xl bg-accent-deep/90 text-[#F4E9D9] px-3.5 py-2 text-[12.5px] font-semibold hover:bg-accent transition-colors disabled:opacity-50"
      >
        <ChevronRight className="w-3.5 h-3.5" />
        {continuation.label || "Continue"}
      </button>
      <span className="text-[11px] text-text-faint">
        Picks up exactly where the last reply stopped.
      </span>
    </div>
  );
}

/** Inline nudge — offer to save this chat to Notes once the CoS has replied. */
function SaveNoteSuggestion({
  busy,
  onSave,
  onDismiss,
}: {
  busy: boolean;
  onSave: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="pl-11">
      <div className="rounded-[14px] border border-accent/25 bg-accent/[0.06] backdrop-blur-sm p-3.5 flex items-start gap-3">
        <StickyNote className="w-4 h-4 mt-0.5 text-accent-glow shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-text-primary font-medium">
            Want me to save this to your Notes?
          </div>
          <div className="text-[12px] text-text-muted mt-0.5">
            I'll write a short recap you can find and search later.
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={onSave}
              disabled={busy}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg bg-accent-deep text-[#F4E9D9] px-3 py-1.5 text-[12px] font-medium transition-colors",
                busy ? "opacity-70 cursor-wait" : "hover:bg-accent",
              )}
            >
              {busy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <StickyNote className="w-3.5 h-3.5" />
              )}
              Save to Notes
            </button>
            <button
              type="button"
              onClick={onDismiss}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg border hairline px-2.5 py-1.5 text-[12px] text-text-muted hover:text-text-primary"
            >
              Not now
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss suggestion"
          disabled={busy}
          className="text-text-faint hover:text-text-primary p-1 -m-1 shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

/** Persistent footer once the chat is in Notes — refresh or jump across. */
function SavedNoteFooter({
  title,
  onOpen,
  onRefresh,
  busy,
}: {
  title: string | null;
  onOpen: () => void;
  onRefresh: () => void;
  busy: boolean;
}) {
  return (
    <div className="pl-11">
      <div className="rounded-[12px] border hairline bg-text-primary/[0.03] px-3 py-2 flex items-center gap-2 text-[12px]">
        <StickyNote className="w-3.5 h-3.5 text-accent-glow shrink-0" />
        <span className="text-text-muted min-w-0 truncate">
          Saved to Notes{title ? ` · ${title}` : ""}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={onRefresh}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-[7px] px-2 py-0.5 text-text-muted hover:text-text-primary"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCw className="w-3 h-3" />}
            Refresh
          </button>
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex items-center rounded-[7px] px-2 py-0.5 text-accent-glow hover:text-text-primary"
          >
            Open in Notes →
          </button>
        </div>
      </div>
    </div>
  );
}

/** One-tap openers — each sends straight into the CoS as a first message. */
const SUGGESTIONS: { icon: typeof Target; text: string }[] = [
  { icon: Target, text: "Plan a product launch for next month" },
  { icon: CalendarClock, text: "Find me two hours of deep-focus time this week" },
  { icon: Gauge, text: "What's slipping across my goals right now?" },
  { icon: StickyNote, text: "Set up a weekly review every Friday afternoon" },
];

function Welcome({
  name,
  userName,
  avatarUrl,
  onSuggest,
  disabled,
}: {
  name: string;
  userName: string;
  avatarUrl?: string | null;
  onSuggest: (text: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col items-center text-center pt-6 md:pt-10 pb-2 animate-fade-in">
      <div className="relative mb-5">
        <div className="absolute inset-0 rounded-[26px] bg-accent/25 blur-2xl scale-125" aria-hidden />
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            className="relative w-[76px] h-[76px] rounded-[26px] object-cover shadow-[0_14px_40px_rgb(var(--accent-deep)/0.5)]"
          />
        ) : (
          <div className="relative grid place-items-center w-[76px] h-[76px] rounded-[26px] bg-[linear-gradient(140deg,rgb(var(--accent)),var(--biz-2))] text-[#F4E9D9] shadow-[0_14px_40px_rgb(var(--accent-deep)/0.5)]">
            <Sparkles className="w-8 h-8" />
          </div>
        )}
      </div>
      <h2 className="font-display text-[26px] leading-tight font-medium">
        {getGreeting()}, {userName}
      </h2>
      <p className="mt-2 text-[13px] leading-relaxed text-text-muted max-w-[420px] px-2">
        I'm {name}. Tell me what you want done — I'll draft the goal, milestones,
        tasks and reminders, and run the whole plan once you approve it.
      </p>

      <div className="mt-7 w-full max-w-[520px] space-y-2 text-left">
        <div className="micro ml-1 mb-2.5">Try one of these</div>
        {SUGGESTIONS.map((s) => (
          <button
            key={s.text}
            type="button"
            disabled={disabled}
            onClick={() => onSuggest(s.text)}
            className="w-full flex items-center gap-3 rounded-[16px] glass px-4 py-3 text-left transition-all hover:border-accent/35 hover:bg-accent/[0.05] active:scale-[0.99] disabled:opacity-50"
          >
            <span className="grid place-items-center w-8 h-8 rounded-[10px] bg-accent/10 text-accent-glow shrink-0">
              <s.icon className="w-4 h-4" />
            </span>
            <span className="flex-1 text-[13px] text-text-muted leading-snug">{s.text}</span>
            <ChevronRight className="w-3.5 h-3.5 text-text-faint shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

/** Relative "2h ago" stamp for the history sheet. */
function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

/** The scrollable list of past conversations — shared by the mobile history
 *  sheet and the desktop left pane. Handles its own loading/empty states. */
function ConversationRows({
  activeId,
  onPick,
}: {
  activeId: string | null;
  onPick: (id: string) => void;
}) {
  const convos = useCosConversations();
  const archive = useArchiveCosConversation();
  const items = convos.data ?? [];

  if (convos.isLoading) {
    return (
      <div className="space-y-2 p-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[52px] rounded-[12px] bg-text-primary/[0.05] animate-pulse" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="py-10 text-center">
        <MessagesSquare className="w-6 h-6 text-text-faint mx-auto mb-2" />
        <p className="text-[12.5px] text-text-muted">No conversations yet.</p>
      </div>
    );
  }

  return (
    <>
      {items.map((c) => (
        <div
          key={c.conversation_id}
          className={cn(
            "group flex items-center gap-2 rounded-[12px] transition-colors",
            c.conversation_id === activeId
              ? "bg-accent/[0.08]"
              : "hover:bg-text-primary/[0.04]",
          )}
        >
          <button
            type="button"
            onClick={() => onPick(c.conversation_id)}
            className="flex-1 min-w-0 text-left px-3 py-2.5"
          >
            <div className="text-[13px] font-medium text-text-primary truncate">
              {c.title || "Untitled conversation"}
            </div>
            <div className="text-[10.5px] text-text-faint mt-0.5">
              {relTime(c.last_activity_at)}
              {c.message_count != null && ` · ${c.message_count} message${c.message_count === 1 ? "" : "s"}`}
            </div>
          </button>
          <button
            type="button"
            aria-label="Archive conversation"
            disabled={archive.isPending}
            onClick={() => archive.mutate(c.conversation_id)}
            className="w-9 h-9 mr-1.5 grid place-items-center rounded-lg text-text-faint hover:text-danger hover:bg-danger/10 transition-colors shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </>
  );
}

/** Past conversations — bottom sheet on phones, centered panel on tablet. */
function HistorySheet({
  open,
  activeId,
  onPick,
  onClose,
}: {
  open: boolean;
  activeId: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[110] bg-black/50 backdrop-blur-[3px] flex items-end md:items-center md:justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Past conversations"
    >
      <div
        className="w-full md:w-[440px] max-h-[78dvh] md:max-h-[70vh] flex flex-col dropglass rounded-t-[22px] md:rounded-[18px] overflow-hidden animate-slide-up md:animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="md:hidden grid place-items-center pt-2.5">
          <span className="h-1 w-9 rounded-full bg-text-primary/20" aria-hidden />
        </div>
        <div className="flex items-center gap-2 p-4 pb-3 border-b hairline shrink-0">
          <History className="w-4 h-4 text-accent-glow" />
          <h2 className="font-display text-[15px] font-medium flex-1">Conversations</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 grid place-items-center rounded-lg text-text-faint hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-2 pb-[max(env(safe-area-inset-bottom,0px),10px)]">
          <ConversationRows
            activeId={activeId}
            onPick={(id) => {
              onPick(id);
              onClose();
            }}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Desktop left pane — past conversations, collapsible to a slim icon rail so
 *  the chat can reclaim the width. */
function ConversationsPane({
  open,
  activeId,
  onPick,
  onNewChat,
  onToggle,
}: {
  open: boolean;
  activeId: string | null;
  onPick: (id: string) => void;
  onNewChat: () => void;
  onToggle: () => void;
}) {
  if (!open) {
    return (
      <div className="w-[52px] shrink-0 border-r hairline flex flex-col items-center gap-2 py-3">
        <button
          type="button"
          onClick={onToggle}
          aria-label="Show conversations"
          title="Show conversations"
          className="w-9 h-9 grid place-items-center rounded-[11px] text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors"
        >
          <PanelLeft className="w-[18px] h-[18px]" />
        </button>
        <button
          type="button"
          onClick={onNewChat}
          aria-label="New chat"
          title="New chat"
          className="w-9 h-9 grid place-items-center rounded-[11px] bg-accent-deep/90 text-[#F4E9D9] hover:bg-accent transition-colors"
        >
          <Plus className="w-[18px] h-[18px]" />
        </button>
      </div>
    );
  }
  return (
    <aside className="w-[264px] shrink-0 border-r hairline flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-3 h-[52px] shrink-0 border-b hairline">
        <History className="w-4 h-4 text-accent-glow shrink-0" />
        <span className="font-display text-[14px] font-medium flex-1 truncate">Conversations</span>
        <button
          type="button"
          onClick={onToggle}
          aria-label="Collapse conversations"
          title="Collapse"
          className="w-8 h-8 grid place-items-center rounded-lg text-text-faint hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors"
        >
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </div>
      <div className="p-2 shrink-0">
        <button
          type="button"
          onClick={onNewChat}
          className="w-full inline-flex items-center justify-center gap-2 rounded-[12px] bg-accent-deep/90 text-[#F4E9D9] px-3 py-2.5 text-[13px] font-medium hover:bg-accent transition-colors"
        >
          <Plus className="w-4 h-4" /> New chat
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2 pt-0">
        <ConversationRows activeId={activeId} onPick={onPick} />
      </div>
    </aside>
  );
}

/** Desktop right pane — always-on insights, collapsible to a slim icon rail. */
function InsightsPane({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  if (!open) {
    return (
      <div className="w-[52px] shrink-0 border-l hairline flex flex-col items-center gap-2 py-3">
        <button
          type="button"
          onClick={onToggle}
          aria-label="Show insights"
          title="Show insights"
          className="w-9 h-9 grid place-items-center rounded-[11px] text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors"
        >
          <PanelRight className="w-[18px] h-[18px]" />
        </button>
        <LayoutGrid className="w-4 h-4 text-text-faint mt-1" />
      </div>
    );
  }
  return (
    <aside className="w-[360px] xl:w-[400px] shrink-0 border-l hairline flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-3 h-[52px] shrink-0 border-b hairline">
        <LayoutGrid className="w-4 h-4 text-accent-glow shrink-0" />
        <span className="font-display text-[14px] font-medium flex-1 truncate">Insights</span>
        <button
          type="button"
          onClick={onToggle}
          aria-label="Collapse insights"
          title="Collapse"
          className="w-8 h-8 grid place-items-center rounded-lg text-text-faint hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors"
        >
          <PanelRightClose className="w-4 h-4" />
        </button>
      </div>
      <CosIntelligencePanel
        dense
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain w-full space-y-6 p-4"
      />
    </aside>
  );
}

function HeaderIconButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "grid place-items-center w-[38px] h-[38px] rounded-[11px] transition-colors shrink-0",
        active
          ? "bg-accent-deep/90 text-[#F4E9D9]"
          : "bg-text-primary/[0.05] text-text-muted hover:text-text-primary hover:bg-text-primary/10",
        disabled && "opacity-40 cursor-not-allowed hover:bg-text-primary/[0.05] hover:text-text-muted",
      )}
    >
      {children}
    </button>
  );
}

// The suggestion card is per-conversation and one-shot. Once dismissed for a
// given conversation, keep it dismissed across reloads — nobody wants a nag.
const SUGGEST_DISMISS_KEY = "cos:save-note-dismissed";

function readDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(SUGGEST_DISMISS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? (parsed as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeDismissed(set: Set<string>) {
  try {
    localStorage.setItem(SUGGEST_DISMISS_KEY, JSON.stringify([...set]));
  } catch {
    /* storage unavailable — accept the loss, the button is still there */
  }
}

// Desktop pane collapse state is sticky per browser — the CEO who lives with
// the insights pane open keeps it open; a focused writer collapses both.
const LEFT_PANE_KEY = "cos:pane-left-open";
const RIGHT_PANE_KEY = "cos:pane-right-open";

function readPaneOpen(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : raw === "1";
  } catch {
    return fallback;
  }
}

function writePaneOpen(key: string, open: boolean) {
  try {
    localStorage.setItem(key, open ? "1" : "0");
  } catch {
    /* storage unavailable — pane state simply won't persist */
  }
}

export function ChiefOfStaffTab({ onExit }: { onExit?: () => void }) {
  const [view, setView] = useState<"chat" | "insights">("chat");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingSend, setPendingSend] = useState(false);
  // Continuation hint from the LAST turn (reprompt kind only — incomplete
  // plans carry their own "Continue building" on the plan card).
  const [continuation, setContinuation] = useState<CosContinuation | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // Desktop only — the two collapsible side panes (conversations, insights).
  const [leftOpen, setLeftOpen] = useState(() => readPaneOpen(LEFT_PANE_KEY, true));
  const [rightOpen, setRightOpen] = useState(() => readPaneOpen(RIGHT_PANE_KEY, true));
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(
    () => readDismissed(),
  );
  const endRef = useRef<HTMLDivElement>(null);
  const [, setSearchParams] = useSearchParams();
  const toast = useToast("Chief of Staff");

  const user = useAuthStore((s) => s.user);
  const isPhone = useIsPhone();
  const isDesktop = useIsDesktop();
  const setImmersive = useUiStore((s) => s.setImmersive);

  // Phone → take the whole viewport WhatsApp-style: the shell reads the same
  // flag and steps its top bar / bottom nav / floating layer out (see
  // SmartCommPage, which pioneered this contract).
  useEffect(() => {
    setImmersive(isPhone);
  }, [isPhone, setImmersive]);
  useEffect(() => () => setImmersive(false), [setImmersive]);

  const convos = useCosConversations();
  const detail = useCosConversation(activeId);
  const create = useCreateCosConversation();
  const post = usePostCosMessage();
  const saveNote = useSaveConversationToNotes();
  const settings = useCosSettings();
  const cosName = settings.data?.assistant_name || DEFAULT_COS_NAME;
  const avatarUrl = settings.data?.avatar_url ?? null;

  // Default to the most recent thread ONCE, on first load. Guarded by a ref so
  // that deliberately clearing activeId ("New chat" → blank composer) isn't
  // instantly undone by this effect snapping back to the latest conversation.
  const didAutoSelect = useRef(false);
  useEffect(() => {
    if (didAutoSelect.current) return;
    if (!activeId && convos.data && convos.data.length > 0) {
      didAutoSelect.current = true;
      setActiveId(convos.data[0].conversation_id);
    }
  }, [convos.data, activeId]);

  const messages = useMemo(() => detail.data?.messages ?? [], [detail.data?.messages]);
  const plans = useMemo(
    () => [...(detail.data?.plans ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [detail.data?.plans],
  );
  // Anchor each plan card under the assistant bubble that proposed it (#5);
  // plans without a resolvable anchor (legacy / system-built) fall back to
  // the end of the thread.
  const { plansByMessage, unanchoredPlans } = useMemo(() => {
    const ids = new Set(messages.map((m) => m.message_id));
    const byMsg = new Map<string, typeof plans>();
    const loose: typeof plans = [];
    for (const p of plans) {
      const anchor = p.anchor_message_id;
      if (anchor && ids.has(anchor)) {
        const arr = byMsg.get(anchor) ?? [];
        arr.push(p);
        byMsg.set(anchor, arr);
      } else {
        loose.push(p);
      }
    }
    return { plansByMessage: byMsg, unanchoredPlans: loose };
  }, [messages, plans]);
  const thinking = pendingSend || post.isPending;
  const savedNote = detail.data?.saved_note ?? null;
  const hasAssistantReply = messages.some((m) => m.role === "assistant");
  const tts = useReadAloud();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, plans.length, thinking]);

  async function handleSend(input: { content: string; input_mode: "text" | "voice"; transcribed_text?: string }) {
    setPendingSend(true);
    setContinuation(null);
    navigator.vibrate?.(8);
    try {
      // Rejections propagate to PraxisInput, which restores the draft — a
      // long message shouldn't be lost to a transient failure (502, dropped
      // connection). The mutation's onError has already surfaced a toast.
      let id = activeId;
      if (!id) {
        const conv = await create.mutateAsync({ title: input.content.slice(0, 60) });
        id = conv.conversation_id;
        setActiveId(id);
      }
      const turn = await post.mutateAsync({ conversationId: id, ...input });
      if (turn.continuation?.kind === "reprompt") setContinuation(turn.continuation);
    } finally {
      setPendingSend(false);
    }
  }

  const handleContinue = () => {
    const reply =
      continuation?.suggested_reply ??
      "Go ahead — continue exactly where you left off.";
    void handleSend({ content: reply, input_mode: "text" }).catch(() => {});
  };

  const suggest = (text: string) => {
    void handleSend({ content: text, input_mode: "text" }).catch(() => {});
  };

  const goToNotes = () => setSearchParams({ tab: "notes" });

  async function handleSaveNote() {
    if (!activeId) return;
    try {
      const result = await saveNote.mutateAsync(activeId);
      toast.success(
        result.action === "created" ? "Saved to Notes" : "Note updated",
        result.note.title || "Open the Notes tab to review.",
      );
    } catch {
      /* mutation onError already toasted */
    }
  }

  function dismissSuggestion() {
    if (!activeId) return;
    setDismissedSuggestions((prev) => {
      const next = new Set(prev);
      next.add(activeId);
      writeDismissed(next);
      return next;
    });
  }

  const newChat = () => {
    setActiveId(null);
    setContinuation(null);
    setView("chat");
  };
  const hasThread = messages.length > 0 || plans.length > 0;
  const canSaveNote = !!activeId && hasThread && !thinking && !saveNote.isPending;
  const showSaveSuggestion =
    !!activeId &&
    hasAssistantReply &&
    !savedNote &&
    !thinking &&
    !dismissedSuggestions.has(activeId);

  const pickConversation = (id: string) => {
    setActiveId(id);
    setContinuation(null);
    setView("chat");
  };
  const toggleLeft = () =>
    setLeftOpen((v) => {
      const next = !v;
      writePaneOpen(LEFT_PANE_KEY, next);
      return next;
    });
  const toggleRight = () =>
    setRightOpen((v) => {
      const next = !v;
      writePaneOpen(RIGHT_PANE_KEY, next);
      return next;
    });

  // ── Shared chat body ─────────────────────────────────────────────────────
  // The thread's four states and the composer are identical whether they sit
  // in the phone/tablet column or the desktop centre pane — build them once.
  const threadInner =
    detail.isLoading && activeId ? (
      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 rounded-2xl bg-text-primary/[0.04] animate-pulse" />
        ))}
      </div>
    ) : detail.isError ? (
      <div className="flex flex-col items-center gap-3 pt-10 text-center">
        <AlertCircle className="w-6 h-6 text-danger" />
        <p className="text-[13px] text-text-muted">Couldn't load this conversation.</p>
        <button
          type="button"
          onClick={() => detail.refetch()}
          className="inline-flex items-center gap-1.5 rounded-lg border hairline px-3 py-1.5 text-[12.5px] hover:text-text-primary"
        >
          <RotateCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    ) : !hasThread ? (
      <Welcome
        name={cosName}
        userName={(user?.name ?? "there").split(" ")[0]}
        avatarUrl={avatarUrl}
        onSuggest={suggest}
        disabled={thinking}
      />
    ) : (
      <div className="flex flex-col gap-6">
        {messages.map((m) => (
          <div key={m.message_id} className="flex flex-col gap-6">
            <Bubble msg={m} avatarUrl={avatarUrl} tts={tts} />
            {(plansByMessage.get(m.message_id) ?? []).map((p) => (
              <div key={p.plan_id} className="md:pl-11">
                <BatchPlanCard plan={p} conversationId={activeId!} />
              </div>
            ))}
          </div>
        ))}
        {unanchoredPlans.map((p) => (
          <div key={p.plan_id} className="md:pl-11">
            <BatchPlanCard plan={p} conversationId={activeId!} />
          </div>
        ))}
        {continuation && !thinking && (
          <ContinueNudge
            continuation={continuation}
            disabled={thinking}
            onContinue={handleContinue}
          />
        )}
        {showSaveSuggestion && (
          <SaveNoteSuggestion
            busy={saveNote.isPending}
            onSave={handleSaveNote}
            onDismiss={dismissSuggestion}
          />
        )}
        {savedNote && !thinking && (
          <SavedNoteFooter
            title={savedNote.title}
            onOpen={goToNotes}
            onRefresh={handleSaveNote}
            busy={saveNote.isPending}
          />
        )}
        {thinking && <Thinking name={cosName} avatarUrl={avatarUrl} />}
      </div>
    );

  const composerBody = (
    <>
      <PraxisInput
        onSend={handleSend}
        disabled={thinking}
        placeholder="What needs to get done?"
      />
      <p className="mt-1.5 text-center text-[10px] text-text-faint">
        Plans only run after you approve them.
      </p>
    </>
  );

  // ── Desktop: three panes (conversations · chat · insights) ────────────────
  // Both side panes collapse to a slim icon rail; "New chat" is the "+" that
  // starts a fresh thread, Gemini-style. Phone/tablet keep the drawer layout.
  if (isDesktop) {
    return (
      <div className="flex h-[calc(100dvh-235px)] min-h-[520px] w-full overflow-hidden rounded-[18px] border hairline bg-[rgb(var(--panel)/0.35)]">
        <ConversationsPane
          open={leftOpen}
          activeId={activeId}
          onPick={pickConversation}
          onNewChat={newChat}
          onToggle={toggleLeft}
        />

        {/* Centre — the live chat */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center gap-2 shrink-0 px-4 h-[52px] border-b hairline">
            <Sparkles className="w-4 h-4 text-accent-glow shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="font-display text-[15px] font-medium leading-tight truncate">{cosName}</div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleSaveNote}
                disabled={!canSaveNote}
                title={
                  savedNote
                    ? "Refresh the note with the latest of this chat"
                    : "Summarise this chat and add to Notes"
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border hairline px-2.5 py-1.5 text-[12px] transition-colors whitespace-nowrap",
                  canSaveNote
                    ? "text-text-muted hover:text-text-primary hover:border-accent/40"
                    : "text-text-faint cursor-not-allowed",
                )}
              >
                {saveNote.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <StickyNote className="w-3.5 h-3.5" />
                )}
                {savedNote ? "Update notes" : "Save to notes"}
              </button>
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                aria-label={`${cosName} settings`}
                title="Settings"
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg border hairline text-text-muted hover:text-text-primary"
              >
                <Settings2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain py-5">
            <div className="w-full max-w-[720px] mx-auto px-5">
              {threadInner}
              <div ref={endRef} />
            </div>
          </div>

          <div className="shrink-0 pt-2 pb-3">
            <div className="w-full max-w-[720px] mx-auto px-5">{composerBody}</div>
          </div>
        </div>

        <InsightsPane open={rightOpen} onToggle={toggleRight} />

        <CosSettings open={showSettings} onClose={() => setShowSettings(false)} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col",
        isPhone
          ? "fixed inset-0 z-[100] h-[100dvh]"
          : "h-[calc(100dvh-235px)] min-h-[460px] max-w-[760px] mx-auto w-full",
      )}
    >
      {/* Header — own glass bar in immersive mode, hairline row in-page. */}
      <div
        className={cn(
          "flex items-center gap-2 shrink-0",
          isPhone
            ? "px-2.5 pt-[max(env(safe-area-inset-top,0px),10px)] pb-2.5 border-b hairline bg-[rgb(var(--panel)/0.72)] backdrop-blur-2xl backdrop-saturate-150"
            : "pb-3 mb-1 border-b hairline",
        )}
      >
        {isPhone && onExit && (
          <button
            type="button"
            onClick={onExit}
            aria-label="Back to Workspace"
            className="grid place-items-center w-[38px] h-[38px] rounded-[11px] text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors shrink-0"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          {isPhone ? (
            <Avatar url={avatarUrl} size={34} />
          ) : (
            <Sparkles className="w-4 h-4 text-accent-glow shrink-0" />
          )}
          <div className="min-w-0">
            <div className="font-display text-[15px] font-medium leading-tight truncate">{cosName}</div>
            {/* Sub-line only when the CEO named her assistant — under the
                default name it would just repeat the title and truncate. */}
            {isPhone && cosName !== DEFAULT_COS_NAME && (
              <div className="text-[9.5px] uppercase tracking-[0.14em] text-text-faint font-semibold whitespace-nowrap truncate">
                AI Chief of Staff
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isPhone ? (
            <>
              {view === "chat" && (
                <HeaderIconButton
                  label={savedNote ? "Update note" : "Save to Notes"}
                  disabled={!canSaveNote}
                  onClick={handleSaveNote}
                >
                  {saveNote.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <StickyNote className="w-4 h-4" />
                  )}
                </HeaderIconButton>
              )}
              {view === "chat" && hasThread && (
                <HeaderIconButton label="New chat" onClick={newChat}>
                  <Plus className="w-[18px] h-[18px]" />
                </HeaderIconButton>
              )}
              <HeaderIconButton label="Past conversations" onClick={() => setShowHistory(true)}>
                <History className="w-4 h-4" />
              </HeaderIconButton>
              <HeaderIconButton
                label={view === "insights" ? "Back to chat" : "Insights"}
                active={view === "insights"}
                onClick={() => setView(view === "insights" ? "chat" : "insights")}
              >
                <LayoutGrid className="w-4 h-4" />
              </HeaderIconButton>
              <HeaderIconButton label={`${cosName} settings`} onClick={() => setShowSettings(true)}>
                <Settings2 className="w-4 h-4" />
              </HeaderIconButton>
            </>
          ) : (
            <>
              {/* Save conversation → Workspace Notes (left of the Chat/Insights toggle) */}
              {view === "chat" && (
                <button
                  type="button"
                  onClick={handleSaveNote}
                  disabled={!canSaveNote}
                  title={
                    savedNote
                      ? "Refresh the note with the latest of this chat"
                      : "Summarise this chat and add to Notes"
                  }
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border hairline px-2.5 py-1.5 text-[12px] transition-colors whitespace-nowrap",
                    canSaveNote
                      ? "text-text-muted hover:text-text-primary hover:border-accent/40"
                      : "text-text-faint cursor-not-allowed",
                  )}
                >
                  {saveNote.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <StickyNote className="w-3.5 h-3.5" />
                  )}
                  {savedNote ? "Update notes" : "Save to notes"}
                </button>
              )}
              {/* Chat / Insights toggle */}
              <div className="inline-flex rounded-lg border hairline p-0.5 bg-text-primary/[0.03]">
                {([
                  { k: "chat", label: "Chat", icon: MessageSquare },
                  { k: "insights", label: "Insights", icon: LayoutGrid },
                ] as const).map((v) => (
                  <button
                    key={v.k}
                    type="button"
                    onClick={() => setView(v.k)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-[7px] px-2.5 py-1 text-[12px] font-medium transition-colors whitespace-nowrap",
                      view === v.k ? "bg-accent-deep/90 text-[#F4E9D9]" : "text-text-muted hover:text-text-primary",
                    )}
                  >
                    <v.icon className="w-3.5 h-3.5" /> {v.label}
                  </button>
                ))}
              </div>
              {view === "chat" && hasThread && (
                <button
                  type="button"
                  onClick={newChat}
                  className="inline-flex items-center gap-1.5 rounded-lg border hairline px-2.5 py-1.5 text-[12px] text-text-muted hover:text-text-primary whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" /> New chat
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowHistory(true)}
                aria-label="Past conversations"
                title="Past conversations"
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg border hairline text-text-muted hover:text-text-primary"
              >
                <History className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                aria-label={`${cosName} settings`}
                title="Settings"
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg border hairline text-text-muted hover:text-text-primary"
              >
                <Settings2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      <CosSettings open={showSettings} onClose={() => setShowSettings(false)} />
      <HistorySheet
        open={showHistory}
        activeId={activeId}
        onPick={(id) => {
          setActiveId(id);
          setView("chat");
        }}
        onClose={() => setShowHistory(false)}
      />

      {view === "insights" ? (
        <CosIntelligencePanel />
      ) : (
        <>
          {/* Thread */}
          <div
            className={cn(
              "flex-1 min-h-0 overflow-y-auto overscroll-contain py-4",
              isPhone ? "px-4" : "pr-1",
            )}
          >
            {threadInner}
            <div ref={endRef} />
          </div>

          {/* Composer — pinned above the home indicator on phones. */}
          <div
            className={cn(
              "shrink-0 pt-2",
              isPhone && "px-3 pb-[max(env(safe-area-inset-bottom,0px),10px)]",
            )}
          >
            {composerBody}
          </div>
        </>
      )}
    </div>
  );
}
