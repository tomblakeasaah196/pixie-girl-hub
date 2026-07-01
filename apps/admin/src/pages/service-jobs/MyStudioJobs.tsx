import {
  Play,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  LinkIcon,
} from "lucide-react";
import {
  Card,
  Pill,
  EmptyState,
  Skeleton,
  Button,
} from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import { useAuthStore } from "@/stores/auth";
import { useJobs, useStudioLifecycle, useJobReferences } from "./hooks";
import { JOB_STATUS_META } from "./constants";
import type { ServiceJob, JobReference } from "./types";

/**
 * "My Jobs" — the stylist's own cockpit. Deliberately dead-simple: the wigs
 * assigned to me, each with ONE obvious next action and the style brief right
 * there. No hunting, no menus.
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

  // The wigs that actually need me now (hide finished/handed-off).
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
  const { data: refs } = useJobReferences(job.job_id);
  const meta = JOB_STATUS_META[job.status];

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

      {/* Style brief — right where the work happens */}
      <StyleBrief refs={refs} />

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

function StyleBrief({ refs }: { refs: JobReference[] | undefined }) {
  if (!refs || refs.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-muted text-sm">
        No reference yet — check with the operations manager.
      </div>
    );
  }
  const creative = refs.some((r) => r.ref_type === "creative_freedom");
  const images = refs.filter((r) => r.ref_type === "image");
  const links = refs.filter((r) => r.ref_type === "video_link" && r.url);
  const notes = refs.filter((r) => (r.ref_type === "text" || r.body) && r.body);

  return (
    <div className="rounded-lg border border-accent/20 bg-accent/5 p-3 space-y-2">
      <div className="text-xs text-accent-glow font-semibold">Style brief</div>
      {creative && (
        <Pill tone="accent">🎨 Creative freedom — interpret freely</Pill>
      )}
      {images.length > 0 && (
        <div className="text-sm">
          {images.length} reference photo{images.length === 1 ? "" : "s"}
        </div>
      )}
      {links.map((l) => (
        <a
          key={l.reference_id}
          href={l.url ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-info text-sm hover:underline"
        >
          <LinkIcon size={13} /> {l.url}
        </a>
      ))}
      {notes.map((n) => (
        <p key={n.reference_id} className="text-sm text-text-primary">
          “{n.body}”
        </p>
      ))}
    </div>
  );
}
