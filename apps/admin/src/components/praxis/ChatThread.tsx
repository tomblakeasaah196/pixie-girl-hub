/**
 * Praxis chat thread (§6.29) — the message list for both the drawer and the
 * full page. Renders user/assistant bubbles, threads each pending-action
 * card under the assistant turn that proposed it, shows a thinking indicator
 * while a turn is in flight, and auto-sticks to the bottom.
 */

import { useEffect, useMemo, useRef } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { PendingActionCard } from "./PendingActionCard";
import type { PendingAction, PraxisMessage } from "@/lib/praxis-api";

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
          "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap break-words",
          isUser
            ? "bg-accent-deep/85 text-[#F4E9D9] rounded-br-md"
            : "bg-text-primary/[0.05] border border-line rounded-bl-md",
        )}
      >
        {msg.input_mode === "voice" && (
          <span className="block text-[10px] uppercase tracking-wide opacity-60 mb-0.5">
            voice
          </span>
        )}
        {text}
      </div>
    </div>
  );
}

export function ChatThread({
  messages,
  pendingActions,
  thinking,
  errorNotice,
}: {
  messages: PraxisMessage[];
  pendingActions: PendingAction[];
  thinking?: boolean;
  /** e.g. the AI_UNAVAILABLE budget/flag message — shown as a system note. */
  errorNotice?: string | null;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pendingActions.length, thinking, errorNotice]);

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
