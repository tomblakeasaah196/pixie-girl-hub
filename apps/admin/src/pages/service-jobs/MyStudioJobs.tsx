import { Play, CheckCircle2, RefreshCw, Sparkles } from "lucide-react";
import {
  Card,
  Pill,
  EmptyState,
  Skeleton,
  Button,
} from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import { useAuthStore } from "@/stores/auth";
import { useJobs, useStudioLifecycle } from "./hooks";
import { JOB_STATUS_META } from "./constants";
import { JobWorkPanel } from "./JobWorkPanel";
import type { ServiceJob } from "./types";

/**
 * "My Jobs" — the stylist's own cockpit. The wigs assigned to me, each with the
 * work panel (timer, materials, brief) right there and ONE obvious next action.
 */
export function MyStudioJobs() {
  const userId = useAuthStore((s) => s.user?.id) ?? null;
  const { data, isLoading, isError, refetch } = useJobs(
    userId ? { assigned_staff_user_id: userId, page_size: 100 } : undefined,
  );

  if (isLoading) {
    return (
      <div className="grid gap-3">
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

  const active = (data?.data ?? []).filter(
    (j) =>
      !["completed", "handed_to_sales", "cancelled", "rejected"].includes(
        j.status,
      ),
  );

  if (active.length === 0) {
    return (
      <EmptyState
        icon={<Sparkles size={26} />}
        title="You're all caught up"
        message="No wigs are waiting on you right now. Nice work."
      />
    );
  }

  return (
    <div className="grid gap-3">
      {active.map((job) => (
        <MyJobCard key={job.job_id} job={job} />
      ))}
    </div>
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
          <div className="font-mono text-xs text-muted">{job.job_number}</div>
          <div className="font-display text-lg">
            {job.service_type_name ?? "Styling job"}
          </div>
          {job.hair_description && (
            <div className="text-muted text-sm">{job.hair_description}</div>
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
        {[
          "returned_for_qc",
          "qc_passed",
          "ready_for_dispatch",
          "on_hold",
        ].includes(job.status) && (
          <span className="text-muted text-sm">
            Handed back — waiting on the operations manager.
          </span>
        )}
      </div>
    </Card>
  );
}
