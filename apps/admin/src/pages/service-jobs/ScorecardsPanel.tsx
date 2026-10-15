import { useSearchParams } from "react-router-dom";
import { Trophy, User, ArrowLeft, AlertTriangle } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  Card,
  KpiTile,
  Pill,
  EmptyState,
  Skeleton,
} from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import { useStylistScorecards, useStylistScorecard } from "./hooks";
import { JOB_STATUS_META } from "./constants";
import type { StylistScorecardSummary } from "./types";

/**
 * Team Scorecards — INTERNAL Stylist Studio only. This is deliberately a
 * separate tab from the Stylist Partner Programme's own review system
 * (Grow > Stylists > Reviews, a different module backed by
 * shared.stylist_partners / stylist_assignments and a customer-facing
 * token-verified review flow). Nothing here reads or writes those tables —
 * this is purely in-house staff (assigned_staff_user_id) job history.
 */
export function ScorecardsPanel() {
  const [sp, setSp] = useSearchParams();
  const stylistId = sp.get("stylist");
  const setStylistId = (id: string | null) =>
    setSp((p) => {
      const next = new URLSearchParams(p);
      if (id) next.set("stylist", id);
      else next.delete("stylist");
      return next;
    });

  if (stylistId) {
    return (
      <StylistScorecardDetail
        userId={stylistId}
        onBack={() => setStylistId(null)}
      />
    );
  }
  return <ScorecardRoster onSelect={setStylistId} />;
}

function ScorecardRoster({
  onSelect,
}: {
  onSelect: (userId: string) => void;
}) {
  const { data = [], isLoading, isError, refetch } = useStylistScorecards();

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <ErrorState
        message="Couldn't load stylist scorecards."
        onRetry={() => refetch()}
      />
    );
  }
  if (data.length === 0) {
    return (
      <EmptyState
        icon={<Trophy className="w-7 h-7" />}
        title="No job history yet"
        message="Once jobs have been assigned and completed, each stylist's scorecard shows up here."
      />
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((s) => (
        <ScorecardCard key={s.user_id} s={s} onClick={() => onSelect(s.user_id)} />
      ))}
    </div>
  );
}

function ScorecardCard({
  s,
  onClick,
}: {
  s: StylistScorecardSummary;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="glass rounded-lg p-4 text-left space-y-2 hover:border-accent/40 border border-line transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-accent/[0.1] grid place-items-center overflow-hidden shrink-0">
          {s.avatar_url ? (
            <img src={s.avatar_url} alt={s.full_name} className="w-full h-full object-cover" />
          ) : (
            <User className="w-4 h-4 text-accent-glow" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{s.full_name}</div>
          <div className="text-[11px] text-text-muted truncate">
            {s.job_title ?? "Stylist"}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs pt-1">
        <div>
          <div className="font-mono font-semibold">
            {s.avg_quality_rating ?? "—"}
          </div>
          <div className="text-text-muted">quality</div>
        </div>
        <div>
          <div className="font-mono font-semibold">
            {s.on_time_pct != null ? `${s.on_time_pct}%` : "—"}
          </div>
          <div className="text-text-muted">on time</div>
        </div>
        <div>
          <div className="font-mono font-semibold">{s.jobs_completed}</div>
          <div className="text-text-muted">completed</div>
        </div>
      </div>
      {s.rework_count > 0 && (
        <Pill tone="warn">
          {s.rework_count} rework{s.rework_count === 1 ? "" : "s"}
        </Pill>
      )}
    </button>
  );
}

export function StylistScorecardDetail({
  userId,
  onBack,
}: {
  userId: string;
  onBack: () => void;
}) {
  const { data, isLoading, isError, refetch } = useStylistScorecard(userId);

  if (isLoading) return <Skeleton className="h-64" />;
  if (isError || !data) {
    return (
      <ErrorState
        message="Couldn't load this stylist's scorecard."
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> All stylists
      </button>

      <div className="flex items-center gap-3">
        <div className="w-14 h-14 rounded-full bg-accent/[0.1] grid place-items-center overflow-hidden shrink-0">
          {data.avatar_url ? (
            <img src={data.avatar_url} alt={data.full_name} className="w-full h-full object-cover" />
          ) : (
            <User className="w-6 h-6 text-accent-glow" />
          )}
        </div>
        <div>
          <div className="font-display text-lg">{data.full_name}</div>
          <div className="text-sm text-text-muted">{data.job_title ?? "Stylist"}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiTile label="Jobs completed" value={`${data.jobs_completed}/${data.jobs_total}`} tone="neutral" />
        <KpiTile label="Avg quality" value={data.avg_quality_rating ?? "—"} tone="accent" />
        <KpiTile
          label="On-time"
          value={data.on_time_pct != null ? `${data.on_time_pct}%` : "—"}
          tone={
            data.on_time_pct != null && Number(data.on_time_pct) < 70 ? "warn" : "success"
          }
        />
        <KpiTile
          label="Rework"
          value={String(data.rework_count)}
          tone={data.rework_count > 0 ? "warn" : "neutral"}
        />
      </div>

      {/* Job history — the "reviews over time" trend */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border-subtle">
          <h3 className="font-display text-lg">Job history</h3>
        </div>
        {data.jobs.length === 0 ? (
          <EmptyState
            icon={<User className="w-7 h-7" />}
            title="No jobs yet"
            message="Nothing assigned to this stylist yet."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="text-left text-text-muted">
                  <th className="px-4 py-2 font-medium">Job</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Quality</th>
                  <th className="px-4 py-2 font-medium">Happiness</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {data.jobs.map((j) => {
                  const m = JOB_STATUS_META[j.status];
                  return (
                    <tr key={j.job_id} className="border-t border-border-subtle">
                      <td className="px-4 py-2 font-mono text-xs">{j.job_number}</td>
                      <td className="px-4 py-2">
                        <Pill tone={m.tone}>{m.label}</Pill>
                      </td>
                      <td className="px-4 py-2">
                        {j.quality_rating ? `★ ${j.quality_rating}` : "—"}
                      </td>
                      <td className="px-4 py-2">{j.customer_rating ?? "—"}</td>
                      <td className="px-4 py-2 text-text-muted">
                        {formatDate(j.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Rework history — every fail cycle with its reason, not just a count */}
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
          <AlertTriangle size={16} className="text-warn" />
          <h3 className="font-display text-lg">Rework history</h3>
        </div>
        {data.rework.length === 0 ? (
          <EmptyState
            icon={<Trophy className="w-7 h-7" />}
            title="No rework on record"
            message="Every QC pass has gone through clean."
          />
        ) : (
          <div className="divide-y divide-border-subtle">
            {data.rework.map((r) => (
              <div key={r.log_id} className="px-4 py-3 text-sm space-y-0.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs">{r.job_number}</span>
                  <span className="text-[11px] text-text-muted">
                    {formatDateTime(r.occurred_at)} · {r.user_name}
                  </span>
                </div>
                {r.after_state?.quality_notes && (
                  <p className="text-text-muted">
                    &ldquo;{r.after_state.quality_notes}&rdquo;
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
