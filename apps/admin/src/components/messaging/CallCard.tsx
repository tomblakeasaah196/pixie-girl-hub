import { Phone, PhoneMissed, PhoneOff } from "lucide-react";
import { cn } from "@/lib/cn";
import { fmtClockTime } from "@/lib/messaging-utils";
import { OUTCOME_LABELS, fmtCallDuration, type CallOutcome } from "@/lib/calls-api";
import type { Message } from "@/lib/smartcomm-types";

/**
 * Timeline entry for a WhatsApp voice call — rendered centred in the
 * thread like a system event, but as a richer glass chip: status icon,
 * duration, who answered, and the recorded outcome.
 */
export function CallCard({ message }: { message: Message }) {
  const meta = message.metadata ?? {};
  const status = meta.call_status ?? "completed";
  const missed = status === "missed" || status === "rejected";
  const failed = status === "failed";

  const Icon = missed ? PhoneMissed : failed ? PhoneOff : Phone;
  const label = missed
    ? status === "rejected"
      ? "Missed call (declined)"
      : "Missed call"
    : failed
      ? "Call failed"
      : `Call · ${fmtCallDuration(meta.duration_seconds)}`;

  const outcome = meta.outcome
    ? OUTCOME_LABELS[meta.outcome as CallOutcome] ?? meta.outcome
    : null;

  return (
    <div className="flex justify-center py-1.5">
      <div
        className={cn(
          "inline-flex flex-col items-center gap-0.5 px-3.5 py-2 rounded-2xl border text-[12px]",
          missed || failed
            ? "border-danger/30 bg-danger/[0.06] text-danger"
            : "border-line bg-panel-2 text-text-primary",
        )}
      >
        <div className="inline-flex items-center gap-1.5 font-semibold">
          <Icon className="w-3.5 h-3.5" />
          <span>WhatsApp {label}</span>
          <span className="text-[10.5px] font-normal opacity-60">
            {fmtClockTime(message.created_at)}
          </span>
        </div>
        {(meta.answered_by_name || outcome) && (
          <div className="text-[11px] text-text-muted text-center">
            {meta.answered_by_name && <>answered by {meta.answered_by_name}</>}
            {meta.answered_by_name && outcome && " · "}
            {outcome && (
              <span className="inline-flex items-center px-1.5 py-[1px] rounded-full bg-accent/10 border border-accent/25 text-accent-glow text-[10.5px]">
                {outcome}
              </span>
            )}
          </div>
        )}
        {meta.outcome_notes && (
          <div className="text-[11px] text-text-faint max-w-[280px] text-center truncate">
            “{meta.outcome_notes}”
          </div>
        )}
      </div>
    </div>
  );
}
