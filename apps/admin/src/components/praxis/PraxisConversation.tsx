/**
 * One Praxis conversation — thread + composer, shared by the drawer and the
 * full page. Owns the turn lifecycle: lazily creates the conversation on the
 * first send, shows the thinking indicator while a turn is in flight, and
 * surfaces AI_UNAVAILABLE (budget cap / flag off) as a soft in-thread notice
 * instead of a dead toast.
 */

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Skeleton, EmptyState } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import { ChatThread } from "./ChatThread";
import { PraxisInput } from "./PraxisInput";
import {
  useConversation,
  useCreateConversation,
  usePostMessage,
} from "@/lib/praxis-api";
import { ApiError } from "@/lib/api";

export function PraxisConversation({
  conversationId,
  onConversationCreated,
  autoFocus,
}: {
  conversationId: string | null;
  onConversationCreated: (id: string) => void;
  autoFocus?: boolean;
}) {
  const detail = useConversation(conversationId);
  const createConv = useCreateConversation();
  const post = usePostMessage(conversationId);
  const [notice, setNotice] = useState<string | null>(null);
  // A send that raced conversation creation — replayed once the id exists.
  const [creating, setCreating] = useState(false);

  const send = async (input: {
    content: string;
    input_mode: "text" | "voice";
    transcribed_text?: string;
  }) => {
    setNotice(null);
    try {
      if (!conversationId) {
        setCreating(true);
        const conv = await createConv.mutateAsync({
          title: input.content.slice(0, 80),
          is_voice_started: input.input_mode === "voice",
        });
        onConversationCreated(conv.conversation_id);
        // Post into the fresh conversation directly (the hook is bound to the
        // old null id) — the detail query for the new id will fetch the turn.
        const { api } = await import("@/lib/api");
        await api.post(
          `/praxis/conversations/${conv.conversation_id}/messages`,
          input,
        );
        return;
      }
      await post.mutateAsync(input);
    } catch (err) {
      if (err instanceof ApiError && err.code === "AI_UNAVAILABLE") {
        setNotice(
          "Praxis is paused — the AI budget cap was reached or the feature is disabled in AI Control.",
        );
      } else if (err instanceof ApiError && err.status === 403) {
        setNotice("You don't have access to Praxis. Ask the CEO to grant it.");
      } else {
        setNotice("That didn't go through — please try again.");
      }
    } finally {
      setCreating(false);
    }
  };

  const thinking = post.isPending || creating;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto px-3.5 py-4">
        {conversationId && detail.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-3/5" />
            <Skeleton className="h-9 w-4/5 ml-auto" />
            <Skeleton className="h-9 w-2/3" />
          </div>
        ) : conversationId && detail.isError ? (
          <ErrorState
            message="Couldn't load this conversation."
            onRetry={() => detail.refetch()}
          />
        ) : !conversationId ||
          (detail.data && detail.data.messages.length === 0 && !thinking) ? (
          <EmptyState
            icon={<Sparkles className="w-8 h-8" />}
            title="Ask Praxis"
            message="Query the business, draft copy, or tell it what to do — every change it proposes waits for your explicit confirmation before it runs."
          />
        ) : (
          <ChatThread
            messages={detail.data?.messages ?? []}
            pendingActions={detail.data?.pending_actions ?? []}
            thinking={thinking}
            errorNotice={notice}
          />
        )}
        {!conversationId && notice && (
          <div className="mt-3 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-[12.5px] text-warn">
            {notice}
          </div>
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
