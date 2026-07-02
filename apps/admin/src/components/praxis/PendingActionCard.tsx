/**
 * Pending-action confirmation card (§6.29 — the human-in-the-loop gate).
 *
 * Praxis proposes; a human disposes. The card shows the plain-language
 * summary, the exact endpoint + payload it will call, a confidence hint and
 * an expiry countdown. Confirm executes the real endpoint AS the confirming
 * user (RBAC re-applies server-side); Reject records a reason. Every state
 * of the row (proposed / executed / failed / rejected / expired) renders —
 * the card is the audit trail the CEO actually reads.
 */

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Clock,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, Pill } from "@/components/ui/primitives";
import {
  useConfirmAction,
  useRejectAction,
  type PendingAction,
} from "@/lib/praxis-api";
import { useAuthStore } from "@/stores/auth";

function countdown(expiresAt: string, now: number) {
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return null;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const STATUS_PILL: Record<
  PendingAction["status"],
  { tone: "success" | "warn" | "danger" | "info" | "accent" | "neutral"; label: string }
> = {
  proposed: { tone: "warn", label: "Awaiting confirmation" },
  confirmed: { tone: "info", label: "Executing…" },
  executed: { tone: "success", label: "Executed" },
  failed: { tone: "danger", label: "Failed" },
  rejected: { tone: "neutral", label: "Rejected" },
  expired: { tone: "neutral", label: "Expired" },
};

export function PendingActionCard({
  action,
  compact,
}: {
  action: PendingAction;
  compact?: boolean;
}) {
  const can = useAuthStore((s) => s.can);
  const canApprove = can("praxis_ai", "approve");
  const confirm = useConfirmAction();
  const reject = useRejectAction();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  // Live expiry countdown (only while proposed).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (action.status !== "proposed") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [action.status]);
  const remaining = useMemo(
    () =>
      action.status === "proposed" ? countdown(action.expires_at, now) : null,
    [action.status, action.expires_at, now],
  );

  const pill = STATUS_PILL[action.status] ?? STATUS_PILL.proposed;
  const confidence =
    action.confidence !== null && action.confidence !== undefined
      ? Math.round(Number(action.confidence) * 100)
      : null;
  const busy = confirm.isPending || reject.isPending;

  return (
    <div
      className={cn(
        "rounded-2xl border p-3.5 bg-accent/[0.05]",
        action.status === "proposed" ? "border-accent/35" : "border-line",
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 grid place-items-center w-8 h-8 rounded-[10px] bg-accent/15 text-accent-glow shrink-0">
          <ShieldCheck className="w-4.5 h-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Pill tone={pill.tone}>{pill.label}</Pill>
            {remaining && (
              <span className="inline-flex items-center gap-1 text-[11px] text-text-muted">
                <Clock className="w-3 h-3" /> expires in {remaining}
              </span>
            )}
            {confidence !== null && (
              <span className="text-[11px] text-text-muted">
                confidence {confidence}%
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-text-primary">
            {action.human_summary || action.action_key}
          </p>
          <div className="mt-1 text-[11px] font-mono text-text-muted truncate">
            {String(action.method || "").toUpperCase()} {action.route}
          </div>

          {!compact && action.payload && (
            <details className="mt-2 group">
              <summary className="flex items-center gap-1 cursor-pointer text-[11.5px] font-semibold text-text-muted hover:text-text-primary list-none">
                <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-180" />
                Exact payload
              </summary>
              <pre className="mt-1.5 max-h-48 overflow-auto rounded-xl bg-black/30 border border-line p-2.5 text-[11px] leading-snug font-mono">
                {JSON.stringify(action.payload, null, 2)}
              </pre>
            </details>
          )}

          {action.status === "executed" && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-success">
              <CheckCircle2 className="w-4 h-4" />
              Done — the record was created/updated with your permissions.
            </p>
          )}
          {action.status === "failed" && (
            <p className="mt-2 inline-flex items-start gap-1.5 text-[12px] text-danger">
              <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="break-words">
                {action.execution_error || "Execution failed."}
              </span>
            </p>
          )}
          {action.status === "rejected" && action.rejection_reason && (
            <p className="mt-2 text-[12px] text-text-muted">
              Reason: {action.rejection_reason}
            </p>
          )}

          {action.status === "proposed" &&
            (canApprove ? (
              rejecting ? (
                <div className="mt-2.5 space-y-2">
                  <input
                    autoFocus
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why reject? (optional)"
                    className="w-full h-9 px-3 rounded-xl bg-black/25 border border-line text-[13px] outline-none focus:border-accent/50"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy}
                      onClick={() =>
                        reject.mutate(
                          { id: action.pending_id, reason: reason || undefined },
                          { onSettled: () => setRejecting(false) },
                        )
                      }
                    >
                      Reject action
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setRejecting(false)}
                    >
                      Back
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-2.5 flex gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Sparkles className="w-3.5 h-3.5" />}
                    disabled={busy}
                    onClick={() => confirm.mutate(action.pending_id)}
                  >
                    {confirm.isPending ? "Running…" : "Confirm & run"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setRejecting(true)}
                  >
                    Reject
                  </Button>
                </div>
              )
            ) : (
              <p className="mt-2 text-[12px] text-text-muted">
                You don't have permission to confirm AI actions.
              </p>
            ))}
        </div>
      </div>
    </div>
  );
}
