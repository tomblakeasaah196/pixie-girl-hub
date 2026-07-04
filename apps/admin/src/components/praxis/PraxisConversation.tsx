/**
 * One Praxis conversation — thread + composer, shared by the drawer and the
 * full page. Owns the turn lifecycle: lazily creates the conversation on the
 * first send, shows the user's message immediately (optimistic outbox) with a
 * thinking indicator while the turn is in flight, keeps a failed send in place
 * with a Retry, and surfaces AI_UNAVAILABLE (budget cap / flag off) as a soft
 * in-thread notice instead of a dead toast.
 *
 * Empty state is the Claude/Gemini welcome (greeting + starter prompts); the
 * composer floats as a pinned glass pill. `variant` scales the layout: "page"
 * centres a comfortable reading column, "drawer" fills the narrow panel.
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import { ChatThread, type OutboxItem } from "./ChatThread";
import { PraxisInput } from "./PraxisInput";
import { PraxisWelcome } from "./PraxisWelcome";
import {
  useConversation,
  useCreateConversation,
  usePostMessage,
  praxisKeys,
} from "@/lib/praxis-api";
import { ApiError } from "@/lib/api";

type SendInput = {
  content: string;
  input_mode: "text" | "voice";
  transcribed_text?: string;
};

export function PraxisConversation({
  conversationId,
  onConversationCreated,
  autoFocus,
  variant = "page",
}: {
  conversationId: string | null;
  onConversationCreated: (id: string) => void;
  autoFocus?: boolean;
  variant?: "drawer" | "page";
}) {
  const qc = useQueryClient();
  const detail = useConversation(conversationId);
  const createConv = useCreateConversation();
  const post = usePostMessage(conversationId);
  const [notice, setNotice] = useState<string | null>(null);
  // Locally-queued sends (shown immediately; removed on ack, kept on failure).
  const [outbox, setOutbox] = useState<(OutboxItem & { input: SendInput })[]>(
    [],
  );

  const mark = (localId: string, status: "sending" | "failed") =>
    setOutbox((o) =>
      o.map((x) => (x.localId === localId ? { ...x, status } : x)),
    );
  const remove = (localId: string) =>
    setOutbox((o) => o.filter((x) => x.localId !== localId));

  const run = async (localId: string, input: SendInput) => {
    setNotice(null);
    mark(localId, "sending");
    try {
      if (!conversationId) {
        const conv = await createConv.mutateAsync({
          title: input.content.slice(0, 80),
          is_voice_started: input.input_mode === "voice",
        });
        onConversationCreated(conv.conversation_id);
        const { api } = await import("@/lib/api");
        await api.post(
          `/praxis/conversations/${conv.conversation_id}/messages`,
          input,
        );
        // The detail query for the new id must refetch to pick up the turn.
        qc.invalidateQueries({
          queryKey: praxisKeys.conversation(conv.conversation_id),
        });
        qc.invalidateQueries({ queryKey: praxisKeys.conversations });
      } else {
        await post.mutateAsync(input);
      }
      remove(localId); // server now has the turn — drop the optimistic copy
    } catch (err) {
      mark(localId, "failed");
      if (err instanceof ApiError && err.code === "AI_UNAVAILABLE") {
        setNotice(
          "Praxis is paused — the AI budget cap was reached or the feature is disabled in AI Control.",
        );
      } else if (err instanceof ApiError && err.status === 403) {
        setNotice("You don't have access to Praxis. Ask the CEO to grant it.");
      } else {
        setNotice("That didn't go through — you can retry below.");
      }
    }
  };

  const send = (input: SendInput) => {
    const localId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : String(Date.now() + Math.random());
    setOutbox((o) => [
      ...o,
      {
        localId,
        content: input.content,
        input_mode: input.input_mode,
        status: "sending",
        input,
      },
    ]);
    run(localId, input);
  };

  const retry = (localId: string) => {
    const item = outbox.find((x) => x.localId === localId);
    if (item) run(localId, item.input);
  };

  const sending = outbox.some((x) => x.status === "sending");
  const thinking = sending || post.isPending;
  const serverMsgs = detail.data?.messages ?? [];
  const hasContent = serverMsgs.length > 0 || outbox.length > 0 || thinking;

  // Reading column: comfortable centred measure on the page, full-bleed in the
  // narrow drawer.
  const col = variant === "page" ? "max-w-3xl mx-auto w-full" : "w-full";

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div
          className={cn(
            col,
            variant === "page" ? "px-4 sm:px-6 py-6" : "px-3.5 py-4",
          )}
        >
          {conversationId && detail.isLoading && !hasContent ? (
            <div className="space-y-5 pt-4">
              <div className="flex gap-3">
                <Skeleton className="w-8 h-8 rounded-[11px]" />
                <Skeleton className="h-16 flex-1 rounded-xl" />
              </div>
              <Skeleton className="h-10 w-1/2 ml-auto rounded-[20px]" />
              <div className="flex gap-3">
                <Skeleton className="w-8 h-8 rounded-[11px]" />
                <Skeleton className="h-24 flex-1 rounded-xl" />
              </div>
            </div>
          ) : conversationId && detail.isError && !hasContent ? (
            <ErrorState
              message="Couldn't load this conversation."
              onRetry={() => detail.refetch()}
            />
          ) : !hasContent ? (
            <PraxisWelcome
              variant={variant}
              onPick={(prompt) => send({ content: prompt, input_mode: "text" })}
            />
          ) : (
            <ChatThread
              messages={serverMsgs}
              pendingActions={detail.data?.pending_actions ?? []}
              thinking={thinking}
              errorNotice={notice}
              outbox={outbox}
              onRetry={retry}
              onDismiss={remove}
            />
          )}
        </div>
      </div>

      <div
        className={cn(
          variant === "page" ? "px-4 sm:px-6 pb-4 pt-2" : "px-3 pb-3 pt-2",
        )}
      >
        <div className={col}>
          <PraxisInput disabled={thinking} onSend={send} autoFocus={autoFocus} />
          <p className="mt-2 px-2 text-center text-[10.5px] text-text-faint">
            Praxis acts with your permissions only — writes always ask first.
          </p>
        </div>
      </div>
    </div>
  );
}
