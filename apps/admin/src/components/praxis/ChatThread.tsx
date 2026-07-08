/**
 * Praxis chat thread (§6.29) — the message list for both the drawer and the
 * full page. Claude/Gemini layout: assistant turns render as flowing prose
 * (markdown) beside a soft sparkle avatar; user turns are compact right-aligned
 * bubbles. Each pending-action card threads under the assistant turn that
 * proposed it, a "thinking" shimmer shows while a turn is in flight, and
 * locally-queued (optimistic) sends render immediately with retry on failure.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles,
  Copy,
  Check,
  RotateCw,
  X,
  AlertCircle,
  ThumbsUp,
  ThumbsDown,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Markdown } from "@/components/help/Markdown";
import { useAuthStore } from "@/stores/auth";
import { useSendFeedback } from "@/lib/praxis-api";
import { PendingActionCard } from "./PendingActionCard";
import type { PendingAction, PraxisMessage } from "@/lib/praxis-api";

/** 👍/👎 on an assistant answer. For the CEO, a 👎 opens a correction box that
 *  Praxis learns from (stored + embedded server-side). */
function FeedbackBar({ msg }: { msg: PraxisMessage }) {
  const isCeo = useAuthStore((s) => s.user?.isCeo ?? false);
  const send = useSendFeedback();
  const [rated, setRated] = useState<"up" | "down" | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [correction, setCorrection] = useState("");
  const [taught, setTaught] = useState(false);

  const rate = (rating: "up" | "down") => {
    setRated(rating);
    if (rating === "down" && isCeo) setCorrecting(true);
    send.mutate({
      messageId: msg.message_id,
      rating,
      conversationId: msg.conversation_id,
    });
  };

  const saveCorrection = () => {
    if (!correction.trim()) return;
    send.mutate(
      {
        messageId: msg.message_id,
        rating: "down",
        comment: correction.trim(),
        conversationId: msg.conversation_id,
      },
      {
        onSuccess: () => {
          setTaught(true);
          setCorrecting(false);
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => rate("up")}
          title="Good answer"
          className={cn(
            "inline-flex items-center gap-1 text-[11px] transition-colors",
            rated === "up"
              ? "text-green-300"
              : "text-text-faint hover:text-text-primary",
          )}
        >
          <ThumbsUp className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={() => rate("down")}
          title={isCeo ? "Wrong — correct it" : "Bad answer"}
          className={cn(
            "inline-flex items-center gap-1 text-[11px] transition-colors",
            rated === "down"
              ? "text-danger"
              : "text-text-faint hover:text-text-primary",
          )}
        >
          <ThumbsDown className="w-3 h-3" />
        </button>
        {taught && (
          <span className="inline-flex items-center gap-1 text-[10.5px] text-green-300">
            <Check className="w-3 h-3" /> Learned
          </span>
        )}
      </div>

      {correcting && (
        <div className="flex flex-col gap-1.5 max-w-[520px]">
          <textarea
            value={correction}
            onChange={(e) => setCorrection(e.target.value)}
            placeholder="What's the correct answer? Praxis will remember this."
            rows={2}
            autoFocus
            className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[12.5px] focus:outline-none focus:border-accent/40 resize-none"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={saveCorrection}
              disabled={!correction.trim() || send.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent text-bg px-3 py-1.5 text-[12px] font-semibold hover:bg-accent-glow disabled:opacity-50"
            >
              {send.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Check className="w-3 h-3" />
              )}
              Teach Praxis
            </button>
            <button
              type="button"
              onClick={() => setCorrecting(false)}
              className="text-[11.5px] text-text-muted hover:text-text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A user message sent from this client but not yet acknowledged by the server. */
export interface OutboxItem {
  localId: string;
  content: string;
  input_mode: "text" | "voice";
  status: "sending" | "failed";
}

/** The Praxis sparkle medallion, reused by every assistant row. */
function Avatar({ pulse }: { pulse?: boolean }) {
  return (
    <div className="mt-0.5 grid place-items-center w-8 h-8 rounded-[11px] bg-[linear-gradient(140deg,rgb(var(--accent)),var(--biz-2))] text-[#F4E9D9] shrink-0 shadow-[0_4px_14px_rgb(var(--accent-deep)/0.4)]">
      <Sparkles className={cn("w-4 h-4", pulse && "animate-pulse")} />
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked — ignore */
        }
      }}
      title={copied ? "Copied" : "Copy"}
      className="inline-flex items-center gap-1 text-[11px] text-text-faint hover:text-text-primary transition-colors"
    >
      {copied ? (
        <>
          <Check className="w-3 h-3" /> Copied
        </>
      ) : (
        <>
          <Copy className="w-3 h-3" /> Copy
        </>
      )}
    </button>
  );
}

function Bubble({ msg }: { msg: PraxisMessage }) {
  const isUser = msg.role === "user";
  const text = msg.content || msg.transcribed_text || "";

  if (isUser) {
    return (
      <div className="flex flex-col items-end gap-1">
        {msg.input_mode === "voice" && (
          <span className="pr-1 text-[9.5px] uppercase tracking-[0.18em] text-text-faint font-bold">
            voice
          </span>
        )}
        <div className="max-w-[82%] rounded-[20px] rounded-br-md bg-accent-deep/90 text-[#F4E9D9] px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap break-words shadow-[0_4px_16px_rgb(var(--accent-deep)/0.35)]">
          {text}
        </div>
      </div>
    );
  }

  // Assistant — flowing prose, no heavy bubble (the Claude signature).
  return (
    <div className="group flex gap-3">
      <Avatar />
      <div className="min-w-0 flex-1 pt-0.5">
        <Markdown
          source={text}
          className="text-[14px] leading-[1.7] text-text-primary space-y-3 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_pre]:rounded-xl [&_pre]:bg-black/30 [&_pre]:border [&_pre]:border-line"
        />
        {text.trim() && (
          <div className="mt-2 flex flex-col gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <div className="flex items-center gap-3">
              <CopyButton text={text} />
              <FeedbackBar msg={msg} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Optimistic / failed user bubble (client-side, not yet server-acked). */
function OutboxBubble({
  item,
  onRetry,
  onDismiss,
}: {
  item: OutboxItem;
  onRetry: (localId: string) => void;
  onDismiss: (localId: string) => void;
}) {
  const failed = item.status === "failed";
  return (
    <div className="flex flex-col items-end gap-1">
      <div
        className={cn(
          "max-w-[82%] rounded-[20px] rounded-br-md px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap break-words",
          failed
            ? "bg-danger/15 border border-danger/40 text-text-primary"
            : "bg-accent-deep/60 text-[#F4E9D9]/90",
        )}
      >
        {item.content}
      </div>
      {failed ? (
        <div className="flex items-center gap-2 pr-1 text-[11px] text-danger">
          <AlertCircle className="w-3 h-3" />
          <span>Not sent</span>
          <button
            type="button"
            onClick={() => onRetry(item.localId)}
            className="inline-flex items-center gap-1 text-accent-glow hover:underline"
          >
            <RotateCw className="w-3 h-3" /> Retry
          </button>
          <button
            type="button"
            onClick={() => onDismiss(item.localId)}
            className="inline-flex items-center gap-1 text-text-faint hover:text-text-primary"
          >
            <X className="w-3 h-3" /> Dismiss
          </button>
        </div>
      ) : (
        <span className="pr-1 text-[10.5px] text-text-faint">Sending…</span>
      )}
    </div>
  );
}

export function ChatThread({
  messages,
  pendingActions,
  thinking,
  errorNotice,
  outbox = [],
  onRetry,
  onDismiss,
}: {
  messages: PraxisMessage[];
  pendingActions: PendingAction[];
  thinking?: boolean;
  /** e.g. the AI_UNAVAILABLE budget/flag message — shown as a system note. */
  errorNotice?: string | null;
  outbox?: OutboxItem[];
  onRetry?: (localId: string) => void;
  onDismiss?: (localId: string) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [
    messages.length,
    pendingActions.length,
    thinking,
    errorNotice,
    outbox.length,
  ]);

  // Thread each pending card under the assistant message that proposed it;
  // cards with no message anchor render at the end (e.g. after a refetch).
  const byMessage = useMemo(() => {
    const map = new Map<string, PendingAction[]>();
    const loose: PendingAction[] = [];
    for (const p of pendingActions) {
      if (p.message_id) {
        const arr = map.get(p.message_id) ?? [];
        arr.push(p);
        map.set(p.message_id, arr);
      } else loose.push(p);
    }
    return { map, loose };
  }, [pendingActions]);

  return (
    <div className="flex flex-col gap-6">
      {messages.map((m) => (
        <div key={m.message_id} className="flex flex-col gap-2.5">
          <Bubble msg={m} />
          {(byMessage.map.get(m.message_id) ?? []).map((p) => (
            <div key={p.pending_id} className="pl-11">
              <PendingActionCard action={p} />
            </div>
          ))}
        </div>
      ))}
      {byMessage.loose.map((p) => (
        <div key={p.pending_id} className="pl-11">
          <PendingActionCard action={p} />
        </div>
      ))}

      {outbox.map((item) => (
        <OutboxBubble
          key={item.localId}
          item={item}
          onRetry={onRetry ?? (() => {})}
          onDismiss={onDismiss ?? (() => {})}
        />
      ))}

      {thinking && (
        <div className="flex gap-3 items-center">
          <Avatar pulse />
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
            Praxis is thinking…
          </span>
        </div>
      )}

      {errorNotice && (
        <div className="ml-11 rounded-xl border border-warn/40 bg-warn/10 px-3.5 py-2.5 text-[12.5px] text-warn">
          {errorNotice}
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
