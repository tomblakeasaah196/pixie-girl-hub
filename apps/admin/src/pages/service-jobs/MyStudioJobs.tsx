import { Play, CheckCircle2, RefreshCw, Sparkles, Trophy } from "lucide-react";
import {
  Card,
  Pill,
  EmptyState,
  Skeleton,
  Button,
  KpiTile,
} from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import { useAuthStore } from "@/stores/auth";
import { useJobs, useStudioLifecycle, useStylistScorecard } from "./hooks";
import { JOB_STATUS_META } from "./constants";
import { JobWorkPanel } from "./JobWorkPanel";
import type { ServiceJob } from "./types";

/**
 * "My Jobs" — the stylist's own cockpit. The wigs assigned to me plus a
 * personal scorecard tile at the top. Each job card has the work panel
 * (timer, materials, brief) right there and ONE obvious next action.
 *
 * Historical jobs that Ops has since reassigned to someone else still show
 * up here (via the wig_custody_ledger own-scope OR-clause), tagged so it's
 * clear this is no longer the stylist's active work — but the completion
 * still counts on their scorecard.
 */
export function MyStudioJobs() {
  const userId = useAuthStore((s) => s.user?.id) ?? null;
  const { data, isLoading, isError, refetch } = useJobs(
    userId ? { page_size: 100 } : undefined,
  );

  if (isLoading) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    );
  }
  if (isError) {
    return (
      <ErrorState
        message="Couldn't load your jobs."
        onRetry={() => refetch()}
      />
    );
  }

  const all = data?.data ?? [];
  const active = all.filter(
    (j) =>
      j.assigned_staff_user_id === userId &&
      !["completed", "cancelled", "rejected"].includes(j.status),
  );
  // Jobs I once worked on but have since been reassigned to someone else —
  // still visible so I keep the history, clearly marked as read-only.
  const reassignedAway = all.filter(
    (j) =>
      j.assigned_staff_user_id !== userId &&
      !["completed", "cancelled", "rejected"].includes(j.status),
  );

  return (
    <div className="space-y-4">
      {userId && <MyScorecardTile userId={userId} />}

      {active.length === 0 && reassignedAway.length === 0 ? (
        <EmptyState
          icon={<Sparkles size={26} />}
          title="You're all caught up"
          message="No wigs are waiting on you right now. Nice work."
        />
      ) : (
        <div className="grid gap-3">
          {active.map((job) => (
            <MyJobCard key={job.job_id} job={job} />
          ))}
          {reassignedAway.length > 0 && (
            <div className="pt-4 space-y-2">
              <p className="text-xs uppercase tracking-wide text-text-muted font-semibold">
                Reassigned away
              </p>
              {reassignedAway.map((job) => (
                <ReassignedAwayCard key={job.job_id} job={job} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Personal scorecard summary — motivating solo numbers, no team leaderboard. */
function MyScorecardTile({ userId }: { userId: string }) {
  const { data, isLoading } = useStylistScorecard(userId);
  if (isLoading || !data) return null;
  const quality = data.avg_quality_rating
    ? Number(data.avg_quality_rating).toFixed(1)
    : "—";
  const onTime = data.on_time_pct != null ? `${data.on_time_pct}%` : "—";
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm text-text-muted">
        <Trophy className="w-4 h-4" />
        <span className="font-semibold uppercase tracking-wide text-xs">
          Your scorecard
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile label="Completed" value={String(data.jobs_completed)} />
        <KpiTile label="On-time" value={onTime} />
        <KpiTile label="Avg quality" value={quality} />
        <KpiTile
          label="Rework"
          value={String(data.rework_count)}
          tone={data.rework_count > 0 ? "warn" : "neutral"}
        />
      </div>
    </Card>
  );
}

function MyJobCard({ job }: { job: ServiceJob }) {
  const life = useStudioLifecycle(job.job_id);
  const meta = JOB_STATUS_META[job.status];
  const working = ["in_progress", "assigned", "rework"].includes(job.status);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-xs text-text-muted">{job.job_number}</div>
          <div className="font-display text-lg">
            {job.service_type_name ?? "Styling job"}
          </div>
          {job.hair_description && (
            <div className="text-text-muted text-sm">{job.hair_description}</div>
          )}
        </div>
        <Pill tone={meta.tone}>{meta.label}</Pill>
      </div>

      {/* The work: timer, materials, style brief. Stylist can log while working. */}
      <JobWorkPanel job={job} canLog={working} />

      {/* One obvious next action */}
      <div className="pt-1">
        {job.status === "assigned" && (
          <Button
            variant="primary"
            icon={<Play className="w-4 h-4" />}
            disabled={life.start.isPending}
            onClick={() => life.start.mutate()}
          >
            Start work
          </Button>
        )}
        {job.status === "in_progress" && (
          <Button
            variant="primary"
            icon={<CheckCircle2 className="w-4 h-4" />}
            disabled={life.returnForQc.isPending}
            onClick={() => life.returnForQc.mutate()}
          >
            Mark done → hand back
          </Button>
        )}
        {job.status === "rework" && (
          <Button
            variant="primary"
            icon={<RefreshCw className="w-4 h-4" />}
            disabled={life.start.isPending}
            onClick={() => life.start.mutate()}
          >
            Start rework
          </Button>
        )}
        {["returned_for_qc", "on_hold"].includes(job.status) && (
          <span className="text-text-muted text-sm">
            Handed back — waiting on the operations manager.
          </span>
        )}
      </div>
    </Card>
  );
}

/** A read-only tile for a job that used to be mine but Ops has reassigned. */
function ReassignedAwayCard({ job }: { job: ServiceJob }) {
  const meta = JOB_STATUS_META[job.status];
  return (
    <Card className="p-3 space-y-1 border border-warn/30 bg-warn/[0.04]">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-xs text-text-muted">{job.job_number}</div>
          <div className="text-sm truncate">
            {job.service_type_name ?? "Styling job"}
            {job.customer_name ? ` · ${job.customer_name}` : ""}
          </div>
        </div>
        <Pill tone={meta.tone}>{meta.label}</Pill>
      </div>
      <p className="text-xs text-text-muted">
        Reassigned to another stylist. History is kept on your scorecard.
      </p>
    </Card>
  );
}
