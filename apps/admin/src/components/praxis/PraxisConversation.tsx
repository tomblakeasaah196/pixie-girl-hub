/**
 * One Praxis conversation — thread + composer, shared by the drawer and the
 * full page. Owns the turn lifecycle: lazily creates the conversation on the
 * first send, shows the user's message immediately (optimistic outbox) with a
 * thinking indicator while the turn is in flight, keeps a failed send in place
 * with a Retry, and surfaces AI_UNAVAILABLE (budget cap / flag off) as a soft
 * in-thread notice instead of a dead toast.
 */

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton, EmptyState } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import { ChatThread, type OutboxItem } from "./ChatThread";
import { PraxisInput } from "./PraxisInput";
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
}: {
  conversationId: string | null;
  onConversationCreated: (id: string) => void;
  autoFocus?: boolean;
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
      { localId, content: input.content, input_mode: input.input_mode, status: "sending", input },
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

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto px-3.5 py-4">
        {conversationId && detail.isLoading && !hasContent ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-3/5" />
            <Skeleton className="h-9 w-4/5 ml-auto" />
            <Skeleton className="h-9 w-2/3" />
          </div>
        ) : conversationId && detail.isError && !hasContent ? (
          <ErrorState
            message="Couldn't load this conversation."
            onRetry={() => detail.refetch()}
          />
        ) : !hasContent ? (
          <EmptyState
            icon={<Sparkles className="w-8 h-8" />}
            title="Ask Praxis"
            message="Query the business, draft copy, or tell it what to do — every change it proposes waits for your explicit confirmation before it runs."
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
      <div className="p-3 border-t border-line">
        <PraxisInput disabled={thinking} onSend={send} autoFocus={autoFocus} />
        <p className="mt-1.5 px-1 text-[10.5px] text-text-muted">
          Praxis acts with your permissions only — writes always ask first.
        </p>
      </div>
    </div>
  );
}
