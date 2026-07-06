/**
 * One AI insight row — severity, headline, amount, drill link, and the
 * acknowledge / resolve / dismiss lifecycle actions (§6.30). Shared by the
 * module-page slot and the Insights Center. Permission-aware: actions render
 * only when `canEdit`.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, X, ExternalLink, Loader2, CircleCheck } from "lucide-react";
import { Pill, MoneyText } from "@/components/ui/primitives";
import { useInsightAction, type Insight } from "@/lib/insights-api";
import { SEVERITY_TONE, SEVERITY_LABEL, relativeTime } from "./severity";

export function InsightRow({
  insight,
  canEdit,
  compact = false,
}: {
  insight: Insight;
  canEdit: boolean;
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const { acknowledge, resolve, dismiss } = useInsightAction();
  const [resolving, setResolving] = useState(false);
  const [reason, setReason] = useState("");

  const busy =
    acknowledge.isPending || resolve.isPending || dismiss.isPending;
  const amount = insight.amount_ngn ? parseFloat(insight.amount_ngn) : null;

  return (
    <div className="p-[13px_15px] border-b hairline last:border-0">
      <div className="flex items-start gap-3">
        <Pill tone={SEVERITY_TONE[insight.severity]} dot>
          {SEVERITY_LABEL[insight.severity]}
        </Pill>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-text-primary">
            {insight.title}
          </div>
          {insight.body && !compact && (
            <p className="text-[11.5px] text-text-muted mt-0.5">
              {insight.body}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1 text-[11px] text-text-faint">
            {insight.status !== "open" && (
              <span className="uppercase tracking-wide">{insight.status}</span>
            )}
            <span className="tabular-nums">
              {relativeTime(insight.detected_at)}
            </span>
            {insight.drill_route && (
              <button
                onClick={() => navigate(insight.drill_route as string)}
                className="inline-flex items-center gap-1 text-accent-glow hover:text-accent transition-colors"
              >
                View <ExternalLink className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
        {amount != null && (
          <MoneyText ngn={amount} className="text-[13px] shrink-0" />
        )}
      </div>

      {canEdit && insight.status !== "resolved" && insight.status !== "dismissed" && (
        <div className="flex items-center gap-2 mt-2.5 pl-1">
          {busy ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-text-faint">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Working…
            </span>
          ) : resolving ? (
            <div className="flex items-center gap-2 w-full">
              <input
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-label="Resolution note"
                placeholder="Resolution note (optional)"
                className="flex-1 h-8 px-2.5 rounded-lg text-[12px] bg-text-primary/[0.05] border hairline focus:border-accent/40 outline-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter")
                    resolve.mutate({ id: insight.insight_id, reason });
                  if (e.key === "Escape") setResolving(false);
                }} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
              />
              <button
                onClick={() => resolve.mutate({ id: insight.insight_id, reason })}
                className="no-min-h h-8 px-3 rounded-lg bg-accent-deep text-[#F4E9D9] text-[11px] font-semibold hover:bg-accent transition-colors"
              >
                Resolve
              </button>
              <button
                onClick={() => setResolving(false)}
                className="no-min-h h-8 px-2 rounded-lg text-[11px] text-text-faint hover:text-text-primary"
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              {insight.status === "open" && (
                <ActionBtn
                  icon={<Check className="w-3.5 h-3.5" />}
                  label="Acknowledge"
                  onClick={() => acknowledge.mutate(insight.insight_id)}
                />
              )}
              <ActionBtn
                icon={<CircleCheck className="w-3.5 h-3.5" />}
                label="Resolve"
                tone="accent"
                onClick={() => setResolving(true)}
              />
              <ActionBtn
                icon={<X className="w-3.5 h-3.5" />}
                label="Dismiss"
                onClick={() => dismiss.mutate(insight.insight_id)}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ActionBtn({
  icon,
  label,
  onClick,
  tone = "muted",
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: "muted" | "accent";
}) {
  return (
    <button
      onClick={onClick}
      className={
        "no-min-h inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-[11px] font-semibold border transition-colors " +
        (tone === "accent"
          ? "text-accent-glow border-accent/25 hover:bg-accent/10"
          : "text-text-muted border-line hover:bg-text-primary/[0.05] hover:text-text-primary")
      }
    >
      {icon}
      {label}
    </button>
  );
}
