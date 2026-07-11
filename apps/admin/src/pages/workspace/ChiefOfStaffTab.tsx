/**
 * AI Chief of Staff — chat tab (PR3).
 *
 * Talk to the CoS in plain language; it proposes a BATCH PLAN (goal + milestones
 * + tasks + events + notes) that you approve once via BatchPlanCard, then it
 * runs the whole thing as you. Reuses the Praxis composer (PraxisInput) and the
 * Markdown renderer; the plan-approval gate is CoS-specific. The assistant's
 * custom name (default "Chief of Staff") becomes configurable in PR6.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Plus, MessagesSquare, Target, CalendarClock, AlertCircle, RotateCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { Markdown } from "@/components/help/Markdown";
import { PraxisInput } from "@/components/praxis/PraxisInput";
import { BatchPlanCard } from "./BatchPlanCard";
import {
  useCosConversations,
  useCosConversation,
  useCreateCosConversation,
  usePostCosMessage,
  type CosMessage,
} from "@/lib/cos-api";

const COS_NAME = "Chief of Staff"; // PR6: from cos_settings.assistant_name

function Avatar({ pulse }: { pulse?: boolean }) {
  return (
    <div className="mt-0.5 grid place-items-center w-8 h-8 rounded-[11px] bg-[linear-gradient(140deg,rgb(var(--accent)),var(--biz-2))] text-[#F4E9D9] shrink-0 shadow-[0_4px_14px_rgb(var(--accent-deep)/0.4)]">
      <Sparkles className={cn("w-4 h-4", pulse && "animate-pulse")} />
    </div>
  );
}

function Bubble({ msg }: { msg: CosMessage }) {
  const text = msg.content || msg.transcribed_text || "";
  if (msg.role === "user") {
    return (
      <div className="flex flex-col items-end gap-1">
        {msg.input_mode === "voice" && (
          <span className="pr-1 text-[9.5px] uppercase tracking-[0.18em] text-text-faint font-bold">voice</span>
        )}
        <div className="max-w-[82%] rounded-[20px] rounded-br-md bg-accent-deep/90 text-[#F4E9D9] px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap break-words shadow-[0_4px_16px_rgb(var(--accent-deep)/0.35)]">
          {text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <Avatar />
      <div className="min-w-0 flex-1 pt-0.5">
        <Markdown
          source={text}
          className="text-[14px] leading-[1.7] text-text-primary space-y-3 [&_ul]:my-1.5 [&_ol]:my-1.5"
        />
      </div>
    </div>
  );
}

function Thinking() {
  return (
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
        {COS_NAME} is drafting your plan…
      </span>
    </div>
  );
}

function Welcome() {
  return (
    <div className="max-w-[560px] mx-auto text-center pt-6 pb-2">
      <div className="w-[64px] h-[64px] rounded-[20px] mx-auto mb-4 grid place-items-center text-accent-glow bg-accent/10 border border-accent/20">
        <Sparkles className="w-7 h-7" />
      </div>
      <h2 className="font-display text-xl font-medium mb-1.5">Meet your {COS_NAME}</h2>
      <p className="text-[13px] text-text-muted max-w-[440px] mx-auto mb-6">
        Just talk. Describe a goal in plain language and I'll draft the whole plan — milestones, tasks,
        deadlines and reminders — for you to approve in one tap.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
        {[
          { icon: <MessagesSquare className="w-4 h-4" />, title: "Chat to plan", body: "“Launch Accessories in August” → a structured plan." },
          { icon: <Target className="w-4 h-4" />, title: "One-tap approval", body: "Review the full plan, approve it all at once." },
          { icon: <CalendarClock className="w-4 h-4" />, title: "Runs it for you", body: "Creates the goal, milestones, tasks and events." },
        ].map((f) => (
          <div key={f.title} className="rounded-[14px] bg-text-primary/[0.03] border hairline p-3.5">
            <div className="text-accent-glow mb-1.5">{f.icon}</div>
            <div className="text-[13px] font-semibold mb-0.5">{f.title}</div>
            <div className="text-[11.5px] text-text-muted">{f.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChiefOfStaffTab() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingSend, setPendingSend] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const convos = useCosConversations();
  const detail = useCosConversation(activeId);
  const create = useCreateCosConversation();
  const post = usePostCosMessage();

  // Default to the most recent thread once conversations load.
  useEffect(() => {
    if (!activeId && convos.data && convos.data.length > 0) {
      setActiveId(convos.data[0].conversation_id);
    }
  }, [convos.data, activeId]);

  const messages = detail.data?.messages ?? [];
  const plans = useMemo(
    () => [...(detail.data?.plans ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [detail.data?.plans],
  );
  const thinking = pendingSend || post.isPending;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, plans.length, thinking]);

  async function handleSend(input: { content: string; input_mode: "text" | "voice"; transcribed_text?: string }) {
    setPendingSend(true);
    try {
      let id = activeId;
      if (!id) {
        const conv = await create.mutateAsync({ title: input.content.slice(0, 60) });
        id = conv.conversation_id;
        setActiveId(id);
      }
      await post.mutateAsync({ conversationId: id, ...input });
    } catch {
      /* ApiError is toasted by the mutation; keep the composer usable */
    } finally {
      setPendingSend(false);
    }
  }

  const newChat = () => setActiveId(null);
  const hasThread = messages.length > 0 || plans.length > 0;

  return (
    <div className="flex flex-col h-[calc(100vh-220px)] min-h-[440px] max-w-[760px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 mb-1 border-b hairline">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent-glow" />
          <span className="font-display text-[15px] font-medium">{COS_NAME}</span>
        </div>
        {hasThread && (
          <button
            type="button"
            onClick={newChat}
            className="inline-flex items-center gap-1.5 rounded-lg border hairline px-2.5 py-1.5 text-[12px] text-text-muted hover:text-text-primary"
          >
            <Plus className="w-3.5 h-3.5" /> New chat
          </button>
        )}
      </div>

      {/* Thread */}
      <div className="flex-1 overflow-y-auto py-4 pr-1">
        {detail.isLoading && activeId ? (
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
          <Welcome />
        ) : (
          <div className="flex flex-col gap-6">
            {messages.map((m) => (
              <Bubble key={m.message_id} msg={m} />
            ))}
            {plans.map((p) => (
              <div key={p.plan_id} className="pl-11">
                <BatchPlanCard plan={p} conversationId={activeId!} />
              </div>
            ))}
            {thinking && <Thinking />}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div className="pt-3">
        <PraxisInput
          onSend={handleSend}
          disabled={thinking}
          placeholder={`Tell your ${COS_NAME} what you want to get done…`}
        />
      </div>
    </div>
  );
}
