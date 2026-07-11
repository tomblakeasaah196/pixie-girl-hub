import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import {
  OUTCOME_LABELS,
  fmtCallDuration,
  type CallOutcome,
} from "@/lib/calls-api";
import type { PendingOutcome } from "@/stores/call";

const OUTCOME_ORDER: CallOutcome[] = [
  "deal_closed",
  "order_placed",
  "follow_up",
  "enquiry",
  "complaint",
  "wrong_number",
  "other",
];

/**
 * Mandatory post-call disposition (option 5a). The dialog can't be
 * dismissed without picking an outcome — closing attempts just wiggle
 * a hint; "Other" is always available so the agent is never stuck.
 */
export function OutcomeDialog({
  pending,
  saving,
  onSubmit,
}: {
  pending: PendingOutcome;
  saving: boolean;
  onSubmit: (outcome: CallOutcome, notes?: string) => void;
}) {
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [notes, setNotes] = useState("");
  const [nudge, setNudge] = useState(false);

  const refuseClose = () => {
    setNudge(true);
    setTimeout(() => setNudge(false), 700);
  };

  return (
    <Modal
      open
      onClose={refuseClose}
      size="sm"
      title="How did the call go?"
    >
      <div className={cn(nudge && "animate-pulse")}>
        <p className="text-[12.5px] text-text-muted mb-3">
          {pending.caller_name || "The customer"} ·{" "}
          {fmtCallDuration(pending.duration_seconds)} — pick an outcome to
          close out this call. It lands on the customer's timeline.
        </p>
        <div className="grid grid-cols-2 gap-2 mb-3" role="radiogroup" aria-label="Call outcome">
          {OUTCOME_ORDER.map((key) => (
            <button
              key={key}
              role="radio"
              aria-checked={outcome === key}
              onClick={() => setOutcome(key)}
              className={cn(
                "h-10 px-3 rounded-xl border text-[12.5px] font-semibold transition-colors text-left",
                outcome === key
                  ? "bg-accent/15 border-accent/50 text-text-primary"
                  : "bg-text-primary/[0.04] border-line text-text-muted hover:text-text-primary hover:bg-text-primary/[0.08]",
              )}
            >
              {OUTCOME_LABELS[key]}
            </button>
          ))}
        </div>
        <label className="block text-[10px] uppercase tracking-[0.18em] text-text-faint mb-1">
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Anything worth remembering — price discussed, promised follow-up…"
          className="w-full rounded-xl border border-line bg-text-primary/[0.03] px-3 py-2 text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-accent/50 resize-none"
        />
        <div className="mt-4 flex justify-end">
          <Button
            variant="primary"
            disabled={!outcome || saving}
            onClick={() => outcome && onSubmit(outcome, notes.trim() || undefined)}
          >
            {saving ? "Saving…" : "Save outcome"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
