/**
 * Chief of Staff — Batch Plan card (PR3).
 *
 * The CoS proposes a whole plan (goal + milestones + tasks + events + notes) as
 * ONE card. The CEO approves it once; the steps then execute in order and the
 * card shows live per-step status. Extends the PendingActionCard idea from a
 * single action to an ordered batch. Design canon: glass surface, accent
 * tokens, four states covered inline (proposed / executing / done / failed).
 */

import { useEffect, useMemo, useState } from "react";
import {
  Target,
  Flag,
  CheckSquare,
  CalendarClock,
  StickyNote,
  Link2,
  Check,
  X,
  Loader2,
  AlertTriangle,
  ChevronDown,
  Clock,
  RotateCw,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  useConfirmCosPlan,
  useRejectCosPlan,
  type Plan,
  type PlanStep,
  type StepStatus,
} from "@/lib/cos-api";

const GROUPS: {
  label: string;
  icon: typeof Target;
  keys: string[];
}[] = [
  { label: "Goal", icon: Target, keys: ["workspace.create_goal", "workspace.update_goal"] },
  { label: "Milestones", icon: Flag, keys: ["workspace.add_milestone", "workspace.update_milestone"] },
  {
    label: "Tasks",
    icon: CheckSquare,
    keys: ["workspace.create_task", "workspace.update_task", "workspace.move_task", "workspace.add_subtask"],
  },
  {
    label: "Calendar",
    icon: CalendarClock,
    keys: ["workspace.create_event", "workspace.update_event", "workspace.reschedule_event"],
  },
  { label: "Notes", icon: StickyNote, keys: ["workspace.create_note"] },
  {
    label: "People & links",
    icon: Link2,
    keys: ["workspace.attach_stakeholder", "workspace.link_task", "workspace.link_event"],
  },
];

const STEP_CHIP: Record<StepStatus, { label: string; cls: string }> = {
  proposed: { label: "Queued", cls: "text-text-faint bg-text-primary/[0.06]" },
  confirmed: { label: "Queued", cls: "text-text-faint bg-text-primary/[0.06]" },
  executed: { label: "Done", cls: "text-green-300 bg-green-500/10" },
  failed: { label: "Failed", cls: "text-danger bg-danger/10" },
  cancelled: { label: "Cancelled", cls: "text-text-faint bg-text-primary/[0.06]" },
  expired: { label: "Expired", cls: "text-text-faint bg-text-primary/[0.06]" },
};

function StepRow({ step }: { step: PlanStep }) {
  const [open, setOpen] = useState(false);
  const chip = STEP_CHIP[step.status] ?? STEP_CHIP.proposed;
  const hasPayload = step.payload && Object.keys(step.payload).length > 0;
  return (
    <div className="rounded-[12px] bg-text-primary/[0.02] border hairline px-3 py-2">
      <div className="flex items-start gap-2">
        <span className="flex-1 text-[12.5px] leading-snug text-text-primary">
          {step.human_summary || step.action_key}
        </span>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", chip.cls)}>
          {chip.label}
        </span>
        {hasPayload && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 text-text-faint hover:text-text-primary"
            aria-label={open ? "Hide step details" : "Show step details"}
            aria-expanded={open}
          >
            <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", open && "rotate-180")} />
          </button>
        )}
      </div>
      {step.status === "failed" && step.execution_error && (
        <div className="mt-1 text-[11px] text-danger">{step.execution_error}</div>
      )}
      {open && hasPayload && (
        <pre className="mt-2 overflow-x-auto rounded-lg bg-black/30 border border-line p-2 text-[11px] leading-relaxed text-text-muted">
          {JSON.stringify(step.payload, null, 2)}
        </pre>
      )}
    </div>
  );
}

function Countdown({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const mins = Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 60000));
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-text-faint">
      <Clock className="w-3 h-3" />
      {mins > 0 ? `Expires in ${mins} min` : "Expired"}
    </span>
  );
}

export function BatchPlanCard({
  plan,
  conversationId,
}: {
  plan: Plan;
  conversationId: string;
}) {
  const confirm = useConfirmCosPlan(conversationId);
  const reject = useRejectCosPlan(conversationId);

  const grouped = useMemo(() => {
    const steps = [...plan.steps].sort((a, b) => a.plan_step - b.plan_step);
    return GROUPS.map((g) => ({
      ...g,
      steps: steps.filter((s) => g.keys.includes(s.action_key)),
    })).filter((g) => g.steps.length > 0);
  }, [plan.steps]);

  const isProposed = plan.status === "proposed";
  const isBusy = confirm.isPending || reject.isPending || plan.status === "executing";
  const doneCount = plan.steps.filter((s) => s.status === "executed").length;

  return (
    <div className="rounded-[18px] border border-accent/25 bg-[linear-gradient(160deg,rgb(var(--accent)/0.06),transparent)] backdrop-blur-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b hairline flex items-start gap-3">
        <div className="mt-0.5 grid place-items-center w-8 h-8 rounded-[11px] bg-accent/12 border border-accent/25 text-accent-glow shrink-0">
          <Target className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold text-text-primary">{plan.title}</div>
          <p className="mt-0.5 text-[12px] text-text-muted whitespace-pre-wrap">{plan.summary}</p>
          <div className="mt-1.5 flex items-center gap-3">
            <span className="text-[11px] text-text-faint">
              {plan.steps.length} step{plan.steps.length === 1 ? "" : "s"}
              {doneCount > 0 && ` · ${doneCount} done`}
            </span>
            {isProposed && <Countdown expiresAt={plan.expires_at} />}
          </div>
        </div>
      </div>

      {/* Steps, grouped in canonical order */}
      <div className="px-4 py-3 space-y-3">
        {grouped.map((g) => (
          <div key={g.label}>
            <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-text-faint">
              <g.icon className="w-3 h-3" />
              {g.label}
            </div>
            <div className="space-y-1.5">
              {g.steps.map((s) => (
                <StepRow key={s.pending_id} step={s} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Footer — one Approve / one Reject, or live status */}
      <div className="px-4 py-3 border-t hairline">
        {isProposed ? (
          <div className="flex items-center gap-2" role="group" aria-label={`Approve or reject: ${plan.title}`}>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => confirm.mutate(plan.plan_id)}
              aria-label={`Approve plan “${plan.title}”`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-accent text-bg px-4 py-2 text-[13px] font-semibold hover:bg-accent-glow disabled:opacity-50"
            >
              {confirm.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Approve plan
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => reject.mutate({ planId: plan.plan_id })}
              aria-label={`Reject plan “${plan.title}”`}
              className="inline-flex items-center gap-1.5 rounded-xl border hairline px-3.5 py-2 text-[13px] text-text-muted hover:text-text-primary hover:border-line disabled:opacity-50"
            >
              <X className="w-3.5 h-3.5" />
              Reject
            </button>
          </div>
        ) : plan.status === "executing" ? (
          <span role="status" aria-live="polite" className="inline-flex items-center gap-2 text-[12.5px] text-accent-glow">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Running your plan…
          </span>
        ) : plan.status === "executed" ? (
          <span role="status" className="inline-flex items-center gap-1.5 text-[12.5px] text-green-300">
            <Check className="w-3.5 h-3.5" /> Plan completed — all {plan.steps.length} steps done.
          </span>
        ) : plan.status === "partially_failed" ? (
          <div className="flex items-center gap-3" role="status">
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-warn">
              <AlertTriangle className="w-3.5 h-3.5" /> Some steps didn't complete.
            </span>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => confirm.mutate(plan.plan_id)}
              className="inline-flex items-center gap-1.5 rounded-lg border hairline px-3 py-1.5 text-[12px] text-text-muted hover:text-text-primary disabled:opacity-50"
            >
              {confirm.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCw className="w-3 h-3" />}
              Retry remaining
            </button>
          </div>
        ) : (
          <span className="text-[12px] text-text-faint capitalize">{plan.status}</span>
        )}
      </div>
    </div>
  );
}
