import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ReceiptText,
  CheckCircle2,
  BellRing,
  AlertTriangle,
  HelpCircle,
} from "lucide-react";
import { formatDate } from "@/lib/format";
import {
  Card,
  KpiTile,
  Pill,
  Button,
  EmptyState,
  Skeleton,
  MoneyText,
} from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import { useUnbilledJobs, useUnbilledMutations } from "./hooks";
import { REVENUE_KIND_LABEL } from "./types";
import type { RevenueKind, UnbilledJob } from "./types";

type Filter = RevenueKind | "unclassified" | "all";

/**
 * Unbilled Jobs — every job with no sale behind it, at EVERY stage.
 *
 * §6.30 already flagged this, but only for `completed` jobs: the
 * `no_sale_linked` insight and the "No Sale (risk)" tile both fire after the
 * styling is done and the hair has gone back to the customer. That is the
 * worst moment to learn nobody raised an invoice.
 *
 * It was also one undifferentiated count — a wig styled for an Instagram shoot
 * sat in the same number as a customer job nobody billed, which is why the
 * number was safe to ignore. Jobs now say WHY they have no sale, so this
 * splits into a queue you can actually clear:
 *
 *   Unclassified      — nobody has decided. Leads the list.
 *   Customer (ours)   — a sale is OWED. Chase it.
 *   Customer (own)    — styling fee OWED, no stock involved.
 *   Internal          — never owed a sale. Visible, but not counted as debt.
 *
 * "Show all" is deliberate: internal jobs are filtered out of the default view
 * but never hidden, because being able to see every unbilled job — including
 * the ones that are fine — is the point of an audit surface.
 */
export function UnbilledPanel({ canEdit }: { canEdit: boolean }) {
  const [filter, setFilter] = useState<Filter>("owed" as Filter);
  const navigate = useNavigate();
  // "owed" isn't a server-side kind — it's the default (everything except
  // internal), which the endpoint returns when no kind is passed.
  const kindParam = filter === ("owed" as Filter) ? undefined : filter;
  const { data, isLoading, isError, refetch } = useUnbilledJobs(kindParam);
  const { requestSale, classify } = useUnbilledMutations();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="grid gap-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }
  // Guard the SHAPE, not just presence. This payload rides a double envelope
  // (see the note in ./api.ts) and every tile below reads `counts` unguarded,
  // so if the envelope ever comes apart again `counts.owed` throws and the
  // error boundary blanks the whole tab. A retryable error state is the honest
  // failure — the same four-states rule as every other screen.
  if (isError || !data?.counts || !Array.isArray(data.data)) {
    return (
      <ErrorState
        message="Couldn't load unbilled jobs."
        onRetry={() => refetch()}
      />
    );
  }

  const { data: jobs, counts } = data;

  const chips: { id: Filter; label: string; n: number }[] = [
    { id: "owed" as Filter, label: "Owes a sale", n: counts.owed },
    { id: "unclassified", label: "Unclassified", n: counts.unclassified },
    {
      id: "customer_our_hair",
      label: "Customer — our hair",
      n: counts.customer_our_hair,
    },
    {
      id: "customer_own_hair",
      label: "Customer — own hair",
      n: counts.customer_own_hair,
    },
    { id: "internal", label: "Internal", n: counts.internal },
    {
      id: "all",
      label: "Show all",
      n: counts.owed + counts.internal,
    },
  ];

  const onRequestSale = async (job: UnbilledJob) => {
    setBusyId(job.job_id);
    try {
      await requestSale.mutateAsync(job.job_id);
    } finally {
      setBusyId(null);
    }
  };

  const onMarkInternal = async (job: UnbilledJob) => {
    const reason = window.prompt(
      `What is ${job.job_number} for? (e.g. "July campaign shoot", "showroom piece")`,
    );
    if (!reason?.trim()) return;
    setBusyId(job.job_id);
    try {
      await classify.mutateAsync({
        jobId: job.job_id,
        revenue_kind: "internal",
        internal_reason: reason.trim(),
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile
          label="Owes a sale"
          value={String(counts.owed)}
          tone={counts.owed > 0 ? "warn" : "success"}
        />
        <KpiTile
          label="Unclassified"
          value={String(counts.unclassified)}
          tone={counts.unclassified > 0 ? "warn" : "neutral"}
        />
        <KpiTile
          label="Customer work"
          value={String(counts.customer_our_hair + counts.customer_own_hair)}
          tone="accent"
        />
        <KpiTile
          label="Internal (no sale due)"
          value={String(counts.internal)}
          tone="neutral"
        />
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setFilter(c.id)}
            className={[
              "px-3 py-1.5 rounded-full text-sm border transition-colors",
              filter === c.id
                ? "bg-accent text-on-accent border-accent"
                : "border-border-subtle text-text-muted hover:text-text",
            ].join(" ")}
          >
            {c.label}
            <span className="ml-1.5 opacity-70">{c.n}</span>
          </button>
        ))}
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
          <ReceiptText size={16} className="text-accent-glow" />
          <h3 className="font-display text-lg">Jobs with no sale</h3>
        </div>

        {jobs.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 size={26} />}
            title="Nothing unbilled"
            message="Every styling job in this view has a sale behind it."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left text-text-muted">
                  <th className="px-4 py-2 font-medium">Job</th>
                  <th className="px-4 py-2 font-medium">Customer</th>
                  <th className="px-4 py-2 font-medium">Why no sale</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium text-right">Value</th>
                  <th className="px-4 py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const owed = j.revenue_kind !== "internal";
                  const asked = Boolean(j.sale_requested_at);
                  return (
                    <tr
                      key={j.job_id}
                      className="border-t border-border-subtle align-top"
                    >
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          className="font-mono text-accent-glow hover:underline"
                          onClick={() =>
                            navigate(`/service-jobs?tab=board&job=${j.job_id}`)
                          }
                        >
                          {j.job_number}
                        </button>
                        <div className="text-text-muted text-xs mt-0.5">
                          {j.service_type_name ?? "—"}
                          {j.tag_code ? ` · tag ${j.tag_code}` : ""}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {j.customer_name ?? (
                          <span className="text-text-muted">—</span>
                        )}
                        <div className="text-text-muted text-xs mt-0.5">
                          {j.assigned_staff_name
                            ? `with ${j.assigned_staff_name}`
                            : "unassigned"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {j.revenue_kind ? (
                          <>
                            <Pill tone={owed ? "warn" : "neutral"}>
                              {REVENUE_KIND_LABEL[j.revenue_kind]}
                            </Pill>
                            {j.internal_reason && (
                              <div className="text-text-muted text-xs mt-1">
                                {j.internal_reason}
                              </div>
                            )}
                          </>
                        ) : (
                          <Pill tone="danger">
                            <HelpCircle size={12} className="inline mr-1" />
                            Unclassified
                          </Pill>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Pill
                          tone={j.status === "completed" ? "danger" : "neutral"}
                        >
                          {j.status}
                        </Pill>
                        <div className="text-text-muted text-xs mt-1">
                          {formatDate(j.completed_at ?? j.created_at)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {j.agreed_cost_ngn || j.actual_cost_ngn ? (
                          <MoneyText
                            ngn={parseFloat(
                              j.actual_cost_ngn ?? j.agreed_cost_ngn ?? "0",
                            )}
                          />
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!owed ? (
                          <span className="text-text-muted text-xs">
                            No sale due
                          </span>
                        ) : asked ? (
                          <span className="text-text-muted text-xs">
                            Sales notified{" "}
                            {formatDate(j.sale_requested_at as string)}
                            {j.sale_requested_by_name
                              ? ` by ${j.sale_requested_by_name}`
                              : ""}
                          </span>
                        ) : (
                          <div className="flex flex-col items-end gap-1">
                            <Button
                              size="sm"
                              disabled={!canEdit || busyId === j.job_id}
                              icon={<BellRing className="w-3.5 h-3.5" />}
                              onClick={() => onRequestSale(j)}
                            >
                              Notify Sales
                            </Button>
                            {/* The honest escape hatch: this job never owed a
                                sale. Recording that is what keeps the queue
                                meaningful instead of permanently noisy. */}
                            <button
                              type="button"
                              disabled={!canEdit || busyId === j.job_id}
                              className="text-xs text-text-muted hover:text-text disabled:opacity-50"
                              onClick={() => onMarkInternal(j)}
                            >
                              Mark internal
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {counts.unclassified > 0 && (
        <Card className="p-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-warn shrink-0 mt-0.5" />
          <div className="text-sm text-text-muted">
            <span className="text-text font-medium">
              {counts.unclassified} job
              {counts.unclassified === 1 ? "" : "s"} nobody has classified.
            </span>{" "}
            These were opened before the Studio asked why a job has no sale, so
            we can't tell an unpaid customer job from a photoshoot piece. Notify
            Sales for the ones that are owed, mark the rest internal.
          </div>
        </Card>
      )}
    </div>
  );
}
