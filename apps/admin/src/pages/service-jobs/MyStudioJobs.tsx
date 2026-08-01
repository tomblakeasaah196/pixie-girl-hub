import { useState } from "react";
import {
  Play,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  Trophy,
  Search,
  Package,
  Maximize2,
} from "lucide-react";
import {
  Card,
  Pill,
  EmptyState,
  Skeleton,
  Button,
  KpiTile,
} from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import { Drawer } from "@/components/ui/Drawer";
import { Lightbox } from "@/components/ui/Lightbox";
import { useAuthStore } from "@/stores/auth";
import {
  useJobs,
  useJob,
  useStudioLifecycle,
  useStylistScorecard,
} from "./hooks";
import { JOB_STATUS_META } from "./constants";
import { JobWorkPanel } from "./JobWorkPanel";
import type { ServiceJob } from "./types";

/**
 * "My Jobs" — the stylist's own cockpit. The wigs assigned to me, shown as
 * picture-first cards plus a personal scorecard tile at the top. Tapping a card
 * opens a rich, deliberately-simple drawer: the style photo big, who it's for,
 * the tag to write, the deadline, the customer's brief + any notes from the
 * operations manager, and ONE obvious button (Start / Mark done). No costs, no
 * assignment controls, no ops clutter — those live on the manager's board.
 *
 * Built for staff who are here to do the hair, not read an admin console:
 * short plain words, big tap targets, the picture leading every card.
 *
 * Historical jobs that Ops has since reassigned to someone else still show up
 * here (via the wig_custody_ledger own-scope OR-clause), tagged so it's clear
 * this is no longer the stylist's active work — but the completion still counts
 * on their scorecard.
 */
export function MyStudioJobs() {
  const userId = useAuthStore((s) => s.user?.id) ?? null;
  // `mine: true` narrows the list to jobs I hold or once held — even for
  // team/all-scope callers (Ops, CEO), who would otherwise get the whole
  // brand's jobs back and see every one mislabelled as "reassigned away".
  const { data, isLoading, isError, refetch } = useJobs(
    userId ? { mine: true, page_size: 100 } : undefined,
  );
  // The open job drawer (kept in local state — My Jobs isn't deep-linked the
  // way the ops board is, and this keeps it clear of the page's ?tab= param).
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  // One search box for the whole queue — tag written on the wig, product name,
  // customer name, order number or job number. Case-insensitive "contains".
  const [q, setQ] = useState("");

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
      <ErrorState message="Couldn't load your jobs." onRetry={() => refetch()} />
    );
  }

  const all = data?.data ?? [];
  const matches = (j: ServiceJob) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return [
      j.tag_code,
      j.styled_product_name,
      j.customer_name,
      j.service_type_name,
      j.sales_order_number,
      j.job_number,
    ].some((v) => v?.toLowerCase().includes(s));
  };

  const isOpen = (j: ServiceJob) =>
    !["completed", "cancelled", "rejected"].includes(j.status);
  const active = all
    .filter((j) => j.assigned_staff_user_id === userId && isOpen(j))
    .filter(matches);
  // Jobs I once worked on but have since been reassigned to someone else —
  // still visible so I keep the history, clearly marked as read-only.
  const reassignedAway = all
    .filter((j) => j.assigned_staff_user_id !== userId && isOpen(j))
    .filter(matches);

  const hasAnyJobs = all.some(isOpen);
  const nothingToShow = active.length === 0 && reassignedAway.length === 0;

  return (
    <div className="space-y-4">
      {userId && <MyScorecardTile userId={userId} />}

      {/* Search — only worth showing once there's a queue to search. */}
      {hasAnyJobs && (
        <div className="relative">
          <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your jobs — tag, name, customer or order…"
            aria-label="Search your jobs by tag, product, customer or order"
            className="input w-full pl-9 text-sm"
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore=""
            data-form-type="other"
          />
        </div>
      )}

      {nothingToShow ? (
        <EmptyState
          icon={<Sparkles size={26} />}
          title={
            q.trim() && hasAnyJobs ? "No job matches" : "You're all caught up"
          }
          message={
            q.trim() && hasAnyJobs
              ? `Nothing found for "${q.trim()}". Try the tag or the customer's name.`
              : "No wigs are waiting on you right now. Nice work."
          }
        />
      ) : (
        <div className="grid gap-3">
          {active.map((job) => (
            <MyJobCard
              key={job.job_id}
              job={job}
              onOpen={() => setOpenJobId(job.job_id)}
            />
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

      {openJobId && (
        <StylistJobDrawer
          jobId={openJobId}
          onClose={() => setOpenJobId(null)}
        />
      )}
    </div>
  );
}

// ── Friendly deadline ──────────────────────────────────────
// Plain words instead of a raw timestamp — "Overdue", "Due today", "Due in 3
// days". Built for quick reading, colour-coded so an approaching deadline is
// obvious at a glance.
type DueTone = "danger" | "warn" | "neutral";
function friendlyDue(
  iso: string | null | undefined,
): { label: string; tone: DueTone } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  if (d.getTime() < now.getTime()) return { label: "Overdue", tone: "danger" };
  const days = Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000);
  if (days <= 0) return { label: "Due today", tone: "warn" };
  if (days === 1) return { label: "Due tomorrow", tone: "warn" };
  return { label: `Due in ${days} days`, tone: "neutral" };
}
const DUE_TEXT: Record<DueTone, string> = {
  danger: "text-danger",
  warn: "text-warn",
  neutral: "text-text-muted",
};

// ── The one obvious next action ────────────────────────────
// Shared by the card and the drawer so "Start" behaves identically in both.
// Every non-terminal status resolves to a single control or a plain status
// line — never a wall of buttons.
function JobPrimaryAction({ job, full }: { job: ServiceJob; full?: boolean }) {
  const life = useStudioLifecycle(job.job_id);
  const cls = full ? "w-full justify-center" : "";

  if (job.status === "assigned") {
    return (
      <Button
        variant="primary"
        className={cls}
        icon={<Play className="w-4 h-4" />}
        disabled={life.start.isPending}
        onClick={() => life.start.mutate()}
      >
        Start work
      </Button>
    );
  }
  if (job.status === "in_progress") {
    return (
      <Button
        variant="primary"
        className={cls}
        icon={<CheckCircle2 className="w-4 h-4" />}
        disabled={life.returnForQc.isPending}
        onClick={() => life.returnForQc.mutate()}
      >
        Mark done → hand back
      </Button>
    );
  }
  if (job.status === "rework") {
    return (
      <Button
        variant="primary"
        className={cls}
        icon={<RefreshCw className="w-4 h-4" />}
        disabled={life.start.isPending}
        onClick={() => life.start.mutate()}
      >
        Start rework
      </Button>
    );
  }
  if (["returned_for_qc", "on_hold"].includes(job.status)) {
    return (
      <span className="text-text-muted text-sm">
        Handed back — waiting on the operations manager.
      </span>
    );
  }
  // qc_passed / ready_for_dispatch / handed_to_sales — nothing left for the
  // stylist to do; reassure rather than show a dead control.
  return (
    <span className="text-text-muted text-sm">
      Finished — it&rsquo;s with the office now.
    </span>
  );
}

// ── Picture-first job card ─────────────────────────────────
function JobCardThumb({ job, size }: { job: ServiceJob; size: string }) {
  if (job.styled_product_image_url) {
    return (
      <img
        src={job.styled_product_image_url}
        alt={job.styled_product_name ?? "Style photo"}
        className={`${size} rounded-lg object-cover shrink-0 bg-accent/[0.08]`}
      />
    );
  }
  return (
    <div
      className={`${size} rounded-lg bg-accent/[0.08] grid place-items-center shrink-0`}
    >
      <Package className="w-5 h-5 text-text-muted" />
    </div>
  );
}

function MyJobCard({ job, onOpen }: { job: ServiceJob; onOpen: () => void }) {
  const meta = JOB_STATUS_META[job.status];
  const due = friendlyDue(job.expected_completion_at);

  return (
    <Card className="p-0 overflow-hidden">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open job ${job.job_number}`}
        className="w-full text-left flex gap-3 p-3 hover:bg-text-primary/[0.03] transition-colors"
      >
        <JobCardThumb job={job} size="w-16 h-16" />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] text-text-muted">
              {job.job_number}
            </span>
            <Pill tone={meta.tone}>{meta.label}</Pill>
          </div>
          <div className="font-display text-base leading-tight truncate">
            {job.styled_product_name ?? job.service_type_name ?? "Styling job"}
          </div>
          {job.customer_name && (
            <div className="text-sm text-text-muted truncate">
              For {job.customer_name}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            {job.tag_code && (
              <span className="font-mono tracking-widest text-accent-glow">
                🏷 {job.tag_code}
              </span>
            )}
            {job.sales_order_number && (
              <span className="text-text-muted font-mono">
                📦 {job.sales_order_number}
              </span>
            )}
            {due && (
              <span className={`font-semibold ${DUE_TEXT[due.tone]}`}>
                {due.label}
              </span>
            )}
          </div>
        </div>
      </button>
      {/* Quick action on the card too, so an experienced stylist can start
          with one tap without opening the drawer first. */}
      <div className="px-3 pb-3">
        <JobPrimaryAction job={job} full />
      </div>
    </Card>
  );
}

// ── Stylist job drawer — rich, but only what a stylist needs ──
function StylistJobDrawer({
  jobId,
  onClose,
}: {
  jobId: string;
  onClose: () => void;
}) {
  const { data: job, isLoading } = useJob(jobId);
  const [photoOpen, setPhotoOpen] = useState(false);

  if (isLoading) {
    return (
      <Drawer open onClose={onClose} title="Your job">
        <div className="space-y-3 p-1">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </div>
      </Drawer>
    );
  }
  if (!job) return null;

  const meta = JOB_STATUS_META[job.status];
  const due = friendlyDue(job.expected_completion_at);
  const working = ["in_progress", "assigned", "rework"].includes(job.status);
  const photoName =
    [job.job_number, job.styled_product_name].filter(Boolean).join(" - ") ||
    "style-photo";

  return (
    <Drawer
      open
      // While the full-screen photo is up, Esc should close only the photo.
      onClose={() => {
        if (!photoOpen) onClose();
      }}
      title={job.job_number}
    >
      <div className="space-y-4">
        {/* The photo, big — this is what the stylist works from. */}
        {job.styled_product_image_url ? (
          <button
            type="button"
            onClick={() => setPhotoOpen(true)}
            aria-label="View style photo full screen"
            title="Tap to see it big"
            className="group relative w-full aspect-square max-h-80 rounded-xl bg-accent/[0.08] overflow-hidden cursor-zoom-in"
          >
            <img
              src={job.styled_product_image_url}
              alt={job.styled_product_name ?? "Style photo"}
              className="w-full h-full object-cover"
            />
            <span className="absolute inset-0 grid place-items-center bg-black/0 group-hover:bg-black/30 group-focus-visible:bg-black/30 transition-colors">
              <Maximize2 className="w-7 h-7 text-white opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity" />
            </span>
          </button>
        ) : (
          <div className="w-full aspect-square max-h-56 rounded-xl bg-accent/[0.08] grid place-items-center">
            <div className="text-center text-text-muted">
              <Package className="w-8 h-8 mx-auto mb-1" />
              <p className="text-xs">No photo on file</p>
            </div>
          </div>
        )}

        {/* Status + service */}
        <div className="flex items-center gap-2 flex-wrap">
          <Pill tone={meta.tone}>{meta.label}</Pill>
          <span className="text-sm font-medium">
            {job.styled_product_name ?? job.service_type_name ?? "Styling job"}
          </span>
        </div>

        {/* The facts, in plain words */}
        <div className="glass rounded-lg p-3 grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
          <Fact label="Client" value={job.customer_name ?? "—"} />
          <Fact label="Order" value={job.sales_order_number ?? "—"} mono />
          <Fact label="Tag to write" value={job.tag_code ?? "—"} mono wide />
          <Fact
            label="Deadline"
            value={due?.label ?? "No deadline set"}
            tone={due?.tone}
          />
        </div>

        {/* The style + any notes from the manager, and the working tools
            (timer + materials). JobWorkPanel's "Style brief" box is where the
            operations manager / assigner's notes appear. */}
        <p className="text-xs text-text-muted uppercase tracking-wide font-semibold">
          The style &amp; notes for you
        </p>
        <JobWorkPanel job={job} canLog={working} />

        {/* One big action */}
        <div className="pt-1">
          <JobPrimaryAction job={job} full />
        </div>
      </div>

      {photoOpen && job.styled_product_image_url && (
        <Lightbox
          url={job.styled_product_image_url}
          name={photoName}
          onClose={() => setPhotoOpen(false)}
        />
      )}
    </Drawer>
  );
}

function Fact({
  label,
  value,
  mono,
  wide,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wide?: boolean;
  tone?: DueTone;
}) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <div className="text-[11px] text-text-muted uppercase tracking-wide">
        {label}
      </div>
      <div
        className={`${mono ? "font-mono tracking-widest" : ""} ${
          tone ? `font-semibold ${DUE_TEXT[tone]}` : ""
        } truncate`}
      >
        {value}
      </div>
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

/** A read-only tile for a job that used to be mine but Ops has reassigned. */
function ReassignedAwayCard({ job }: { job: ServiceJob }) {
  const meta = JOB_STATUS_META[job.status];
  return (
    <Card className="p-3 space-y-1 border border-warn/30 bg-warn/[0.04]">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-xs text-text-muted">
            {job.job_number}
          </div>
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
