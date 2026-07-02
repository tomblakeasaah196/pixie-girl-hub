import { useState } from "react";
import { Star, Check, RotateCcw, ShieldQuestion } from "lucide-react";
import {
  Card,
  Pill,
  EmptyState,
  Skeleton,
  Button,
} from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import { useJobs, useStudioLifecycle } from "./hooks";
import { JobWorkPanel } from "./JobWorkPanel";
import type { ServiceJob } from "./types";

/**
 * Ops QC queue — every wig handed back, waiting to be checked. One card per wig
 * with what the stylist did, a star rating, and two clear choices: pass it on,
 * or send it back for rework.
 */
export function QcQueue() {
  const { data, isLoading, isError, refetch } = useJobs({
    status: "returned_for_qc",
    page_size: 100,
  });

  if (isLoading) return <Skeleton className="h-40" />;
  if (isError)
    return (
      <ErrorState
        message="Couldn't load the QC queue."
        onRetry={() => refetch()}
      />
    );

  const jobs = data?.data ?? [];
  if (jobs.length === 0) {
    return (
      <EmptyState
        icon={<ShieldQuestion size={26} />}
        title="Nothing waiting for QC"
        message="When a stylist hands a wig back, it lands here to check."
      />
    );
  }

  return (
    <div className="grid gap-4">
      {jobs.map((job) => (
        <QcCard key={job.job_id} job={job} />
      ))}
    </div>
  );
}

function QcCard({ job }: { job: ServiceJob }) {
  const life = useStudioLifecycle(job.job_id);
  const [rating, setRating] = useState(0);
  const [notes, setNotes] = useState("");

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-xs text-muted">{job.job_number}</div>
          <div className="font-display text-lg">
            {job.service_type_name ?? "Styling job"}
          </div>
        </div>
        <Pill tone="warn">Returned · QC</Pill>
      </div>

      {/* What happened on the wig */}
      <JobWorkPanel job={job} canLog />

      {/* Rate it */}
      <div className="flex items-center gap-1">
        <span className="text-sm text-muted mr-1">Quality:</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            aria-label={`${n} star`}
            className={n <= rating ? "text-accent-glow" : "text-text-faint"}
          >
            <Star size={20} fill={n <= rating ? "currentColor" : "none"} />
          </button>
        ))}
      </div>
      <textarea
        className="w-full rounded-lg border border-line bg-white/5 px-3 py-2 text-sm outline-none focus:border-accent"
        rows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="QC notes (what to fix on rework, or a compliment)…"
      />

      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          icon={<Check className="w-4 h-4" />}
          disabled={life.qc.isPending}
          onClick={() =>
            life.qc.mutate({
              result: "pass",
              quality_rating: rating || undefined,
              quality_notes: notes || undefined,
            })
          }
        >
          Pass QC
        </Button>
        <Button
          variant="danger"
          icon={<RotateCcw className="w-4 h-4" />}
          disabled={life.qc.isPending}
          onClick={() =>
            life.qc.mutate({
              result: "rework",
              quality_rating: rating || undefined,
              quality_notes: notes || undefined,
            })
          }
        >
          Send back for rework
        </Button>
      </div>
    </Card>
  );
}
