/**
 * Praxis chat thread (§6.29) — the message list for both the drawer and the
 * full page. Renders user/assistant bubbles (assistant output is markdown),
 * threads each pending-action card under the assistant turn that proposed it,
 * shows a thinking indicator while a turn is in flight, renders locally-queued
 * (optimistic) sends immediately, and offers retry on a failed send.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Copy, Check, RotateCw, X, AlertCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { Markdown } from "@/components/help/Markdown";
import { PendingActionCard } from "./PendingActionCard";
import type { PendingAction, PraxisMessage } from "@/lib/praxis-api";

/** A user message sent from this client but not yet acknowledged by the server. */
export interface OutboxItem {
  localId: string;
  content: string;
  input_mode: "text" | "voice";
  status: "sending" | "failed";
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
  return (
    <div className={cn("flex gap-2.5", isUser && "flex-row-reverse")}>
      {!isUser && (
        <div className="mt-1 grid place-items-center w-7 h-7 rounded-[9px] bg-[linear-gradient(140deg,rgb(var(--accent)),var(--biz-2))] text-[#F4E9D9] shrink-0">
          <Sparkles className="w-3.5 h-3.5" />
        </div>
      )}
      <div
        className={cn(
          "group max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed break-words",
          isUser
            ? "bg-accent-deep/85 text-[#F4E9D9] rounded-br-md whitespace-pre-wrap"
            : "bg-text-primary/[0.05] border border-line rounded-bl-md",
        )}
      >
        {msg.input_mode === "voice" && (
          <span className="block text-[10px] uppercase tracking-wide opacity-60 mb-0.5">
            voice
          </span>
        )}
        {isUser ? (
          text
        ) : (
          <>
            <Markdown
              source={text}
              className="text-[13.5px] leading-relaxed space-y-2.5 [&_ul]:my-1 [&_ol]:my-1"
            />
            {text.trim() && (
              <div className="mt-1.5 pt-1.5 border-t border-line/70 opacity-0 group-hover:opacity-100 transition-opacity">
                <CopyButton text={text} />
              </div>
            )}
          </>
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
      <div className="flex gap-2.5 flex-row-reverse w-full">
        <div
          className={cn(
            "max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap break-words",
            failed
              ? "bg-danger/15 border border-danger/40 text-text-primary"
              : "bg-accent-deep/60 text-[#F4E9D9]/90",
          )}
        >
          {item.content}
        </div>
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
  }, [messages.length, pendingActions.length, thinking, errorNotice, outbox.length]);

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
    <div className="flex flex-col gap-3">
      {messages.map((m) => (
        <div key={m.message_id} className="flex flex-col gap-2">
          <Bubble msg={m} />
          {(byMessage.map.get(m.message_id) ?? []).map((p) => (
            <div key={p.pending_id} className="pl-9">
              <PendingActionCard action={p} />
            </div>
          ))}
        </div>
      ))}
      {byMessage.loose.map((p) => (
        <div key={p.pending_id} className="pl-9">
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
        <div className="flex gap-2.5">
          <div className="mt-1 grid place-items-center w-7 h-7 rounded-[9px] bg-[linear-gradient(140deg,rgb(var(--accent)),var(--biz-2))] text-[#F4E9D9] shrink-0">
            <Sparkles className="w-3.5 h-3.5 animate-pulse" />
          </div>
          <div className="rounded-2xl rounded-bl-md bg-text-primary/[0.05] border border-line px-3.5 py-2.5">
            <span className="inline-flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce"
                  style={{ animationDelay: `${i * 140}ms` }}
                />
              ))}
            </span>
          </div>
        </div>
      )}

      {errorNotice && (
        <div className="mx-9 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-[12.5px] text-warn">
          {errorNotice}
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
