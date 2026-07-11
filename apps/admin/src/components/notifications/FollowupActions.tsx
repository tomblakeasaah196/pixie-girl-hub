/**
 * Chief of Staff accountability action buttons (PR4).
 *
 * Renders a notification's inline `actions` (✅ Done / 🟡 In Progress / 🔴
 * Delayed) and drives the follow-up state machine right in the notification:
 *   answer → (on "Delayed") a "why?" input → suggestion chips → act.
 *
 * Self-contained: it reads the follow-up id off the action endpoint and posts
 * back through the CoS follow-up hooks, which invalidate the notifications +
 * goals surfaces so everything stays in sync.
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useMarkRead, type AppNotification } from "@/lib/notifications-api";
import {
  useRespondFollowup,
  useReasonFollowup,
  useActFollowup,
  followupIdFromEndpoint,
  type SuggestedAction,
  type FollowupAnswer,
} from "@/lib/cos-api";

type Phase = "idle" | "reason" | "suggestions" | "done";

const chipClass =
  "inline-flex items-center gap-1 rounded-full border hairline px-2.5 py-1 " +
  "text-[11px] font-medium text-text-muted hover:bg-accent/10 hover:text-accent " +
  "disabled:opacity-50 disabled:pointer-events-none transition-colors";

export function FollowupActions({ n }: { n: AppNotification }) {
  const actions = n.actions ?? [];
  const [phase, setPhase] = useState<Phase>("idle");
  const [followupId, setFollowupId] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [suggestions, setSuggestions] = useState<SuggestedAction[]>([]);
  const [doneLabel, setDoneLabel] = useState("");

  const respond = useRespondFollowup();
  const reason = useReasonFollowup();
  const act = useActFollowup();
  const markRead = useMarkRead();

  if (!actions.length) return null;

  function touchRead() {
    if (!n.is_read) markRead.mutate(n.notification_id);
  }

  function onAnswer(a: { value: string; endpoint: string }) {
    touchRead();
    const parsed = followupIdFromEndpoint(a.endpoint);
    setFollowupId(parsed);
    respond.mutate(
      { endpoint: a.endpoint, answer: a.value as FollowupAnswer },
      {
        onSuccess: (res) => {
          if (!parsed && res?.followup) setFollowupId(res.followup.followup_id);
          if (a.value === "delayed") {
            setPhase("reason");
          } else {
            setDoneLabel(
              a.value === "done" ? "✓ Marked done" : "✓ Noted — in progress",
            );
            setPhase("done");
          }
        },
      },
    );
  }

  function submitReason() {
    if (!followupId || !reasonText.trim()) return;
    reason.mutate(
      { id: followupId, reason: reasonText.trim() },
      {
        onSuccess: (res) => {
          setSuggestions(res.suggested_actions ?? []);
          setPhase("suggestions");
        },
      },
    );
  }

  function onChip(s: SuggestedAction) {
    if (!followupId) return;
    act.mutate(
      { id: followupId, action: s },
      { onSuccess: () => { setDoneLabel(`✓ ${s.label}`); setPhase("done"); } },
    );
  }

  if (phase === "done") {
    return (
      <div className="mt-2 text-[11.5px] font-medium text-success">
        {doneLabel}
      </div>
    );
  }

  return (
    <div className="mt-2" onClick={(e) => e.stopPropagation()}>
      {phase === "idle" && (
        <div className="flex flex-wrap gap-1.5">
          {actions.map((a) => (
            <button
              key={a.value}
              onClick={() => onAnswer(a)}
              disabled={respond.isPending}
              className={chipClass}
            >
              {respond.isPending && (
                <Loader2 className="w-3 h-3 animate-spin" />
              )}
              {a.label}
            </button>
          ))}
        </div>
      )}

      {phase === "reason" && (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitReason();
            }}
            placeholder="What caused the delay?"
            className="flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-accent"
          />
          <button
            onClick={submitReason}
            disabled={!reasonText.trim() || reason.isPending}
            className={cn(chipClass, "bg-accent/10 text-accent")}
          >
            {reason.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            Send
          </button>
        </div>
      )}

      {phase === "suggestions" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-full text-[11px] text-text-faint">
            How should I help?
          </span>
          {suggestions.map((s) => (
            <button
              key={s.kind}
              onClick={() => onChip(s)}
              disabled={act.isPending}
              className={chipClass}
            >
              {act.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
