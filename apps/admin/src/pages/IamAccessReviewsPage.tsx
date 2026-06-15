import { useState } from "react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import {
  ClipboardCheck, Plus, Check, X as XIcon, Flag, ChevronLeft,
  ChevronRight, FileSpreadsheet, FileText,
} from "lucide-react";
import { Card, Pill } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { Drawer } from "@/components/ui/Drawer";
import { ErrorState } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import {
  useAccessReviews,
  useAccessReview,
  useCreateReview,
  useUpdateReview,
  useDecideEntry,
  downloadReviewExport,
  type AccessReview,
  type AccessReviewEntry,
  type ReviewFilters,
} from "@/lib/iam";

/* ── Status config ──────────────────────────────────────────── */
const STATUS_TONE: Record<string, "info" | "warn" | "success" | "neutral"> = {
  open: "info",
  in_progress: "warn",
  completed: "success",
  cancelled: "neutral",
};
const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};
const DECISION_TONE: Record<string, "success" | "danger" | "warn" | "neutral"> = {
  pending: "neutral",
  approved: "success",
  revoked: "danger",
  flagged: "warn",
};

/* ── Page ──────────────────────────────────────────────────── */
export function IamAccessReviewsPage() {
  useBreadcrumbs([
    { label: "IAM & Security", href: "/iam-security" },
    { label: "Access Reviews" },
  ]);

  const [filters, setFilters] = useState<ReviewFilters>({ page: 1, per_page: 20 });
  const [statusFilter, setStatusFilter] = useState("");
  const reviews = useAccessReviews({ ...filters, status: statusFilter || undefined });
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (reviews.isError) return <ErrorState message="Failed to load reviews" onRetry={() => reviews.refetch()} />;

  const rows = reviews.data?.rows ?? [];
  const total = reviews.data?.total ?? 0;
  const page = filters.page ?? 1;
  const totalPages = Math.ceil(total / (filters.per_page ?? 20));

  return (
    <div className="max-w-[1000px] space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent/10 text-accent-glow border border-accent/20">
            <ClipboardCheck className="w-5 h-5" />
          </span>
          <div>
            <h2 className="font-display text-[22px] font-medium">Access Reviews</h2>
            <p className="text-text-muted text-[13px]">Periodic attestation of who can do what</p>
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-white text-[13px] font-medium hover:bg-accent/90 transition-colors"
        >
          <Plus className="w-4 h-4" /> New Review
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <select
          className="px-3 py-2 rounded-xl bg-panel border border-border-c text-[13px]"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setFilters((f) => ({ ...f, page: 1 })); }}
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <span className="text-text-faint text-[12px] ml-auto">{total} review{total !== 1 ? "s" : ""}</span>
      </div>

      {/* Reviews list */}
      {reviews.isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-5 animate-pulse h-20"><span /></Card>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="p-10 text-center">
          <ClipboardCheck className="w-10 h-10 text-text-faint mx-auto mb-3" />
          <p className="text-text-muted text-[14px] font-medium">No access reviews yet</p>
          <p className="text-text-faint text-[12px] mt-1">Create a review to snapshot and attest current user access</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <ReviewRow key={r.review_id} review={r} onSelect={() => setSelectedId(r.review_id)} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-2">
          <button
            disabled={page <= 1}
            onClick={() => setFilters((f) => ({ ...f, page: page - 1 }))}
            className="text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-text-faint text-[12px]">
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setFilters((f) => ({ ...f, page: page + 1 }))}
            className="text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Create modal */}
      <CreateReviewModal open={showCreate} onClose={() => setShowCreate(false)} />

      {/* Review detail drawer */}
      <ReviewDetailDrawer reviewId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}

/* ── Review row ─────────────────────────────────────────────── */
function ReviewRow({ review: r, onSelect }: { review: AccessReview; onSelect: () => void }) {
  const stats = r.entry_stats;
  const totalEntries = stats?.total ?? 0;
  const decided = (stats?.approved ?? 0) + (stats?.revoked ?? 0) + (stats?.flagged ?? 0);
  const pct = totalEntries > 0 ? Math.round((decided / totalEntries) * 100) : 0;

  return (
    <Card className="p-4 cursor-pointer hover:border-accent/30 transition-colors">
      <button onClick={onSelect} className="w-full text-left">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-display text-[15px] font-medium flex-1 min-w-0 truncate">{r.title}</span>
          <Pill tone={STATUS_TONE[r.status] ?? "neutral"} dot={false}>{STATUS_LABEL[r.status] ?? r.status}</Pill>
        </div>
        <div className="flex items-center gap-4 mt-2 text-[12px] text-text-muted">
          <span>Initiated {new Date(r.initiated_at).toLocaleDateString()}</span>
          {r.due_date && <span>Due {new Date(r.due_date).toLocaleDateString()}</span>}
          {totalEntries > 0 && (
            <span className="flex items-center gap-2">
              <span>{decided}/{totalEntries} decided</span>
              <span className="w-20 h-1.5 bg-text-faint/20 rounded-full overflow-hidden">
                <span
                  className="h-full bg-success rounded-full block transition-all"
                  style={{ width: `${pct}%` }}
                />
              </span>
            </span>
          )}
        </div>
      </button>
    </Card>
  );
}

/* ── Create review modal ────────────────────────────────────── */
function CreateReviewModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const create = useCreateReview();

  function handleCreate() {
    if (!title.trim()) return;
    create.mutate(
      { title: title.trim(), description: description.trim() || undefined, due_date: dueDate || undefined },
      {
        onSuccess: () => {
          setTitle("");
          setDescription("");
          setDueDate("");
          onClose();
        },
      },
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="New Access Review">
      <div className="space-y-4">
        <p className="text-text-muted text-[13px]">
          This will snapshot every active user with their current roles and permissions for attestation.
        </p>
        <div>
          <label className="text-[12px] font-medium text-text-muted block mb-1">Title *</label>
          <input
            type="text"
            className="w-full px-3 py-2 rounded-xl bg-panel border border-border-c text-[13px]"
            placeholder="Q2 2026 Access Review"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div>
          <label className="text-[12px] font-medium text-text-muted block mb-1">Description</label>
          <textarea
            className="w-full px-3 py-2 rounded-xl bg-panel border border-border-c text-[13px] min-h-[80px] resize-y"
            placeholder="Quarterly attestation of staff access..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div>
          <label className="text-[12px] font-medium text-text-muted block mb-1">Due date</label>
          <input
            type="date"
            className="w-full px-3 py-2 rounded-xl bg-panel border border-border-c text-[13px]"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-text-muted text-[13px] hover:text-text transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!title.trim() || create.isPending}
            className="px-4 py-2 rounded-xl bg-accent text-white text-[13px] font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {create.isPending ? "Creating..." : "Create Review"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ── Review detail drawer ───────────────────────────────────── */
function ReviewDetailDrawer({ reviewId, onClose }: { reviewId: string | null; onClose: () => void }) {
  const review = useAccessReview(reviewId);
  const updateReview = useUpdateReview();
  const decideEntry = useDecideEntry();
  const [noteEntryId, setNoteEntryId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [exporting, setExporting] = useState(false);

  const r = review.data;
  const entries = r?.entries ?? [];
  const stats = r?.entry_stats;

  async function handleExport(format: "csv" | "xlsx") {
    if (!reviewId) return;
    setExporting(true);
    try {
      await downloadReviewExport(reviewId, format);
    } finally {
      setExporting(false);
    }
  }

  function handleDecide(entryId: string, decision: "approved" | "revoked" | "flagged") {
    if (!reviewId) return;
    const note = noteEntryId === entryId ? noteText : undefined;
    decideEntry.mutate(
      { reviewId, entryId, decision, reviewer_note: note },
      {
        onSuccess: () => {
          setNoteEntryId(null);
          setNoteText("");
        },
      },
    );
  }

  function handleComplete() {
    if (!reviewId) return;
    updateReview.mutate({ reviewId, patch: { status: "completed" } });
  }

  return (
    <Drawer
      open={!!reviewId}
      onClose={onClose}
      title={r?.title ?? "Access Review"}
      subtitle={r ? `${STATUS_LABEL[r.status]} · ${entries.length} entries` : undefined}
      wide
      footer={
        r && r.status !== "completed" && r.status !== "cancelled" ? (
          <div className="flex items-center justify-between gap-3 px-5 py-3">
            <div className="flex gap-2">
              <button
                onClick={() => handleExport("csv")}
                disabled={exporting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-text-muted hover:text-text border border-border-c transition-colors"
              >
                <FileText className="w-3.5 h-3.5" /> CSV
              </button>
              <button
                onClick={() => handleExport("xlsx")}
                disabled={exporting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-text-muted hover:text-text border border-border-c transition-colors"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
              </button>
            </div>
            <button
              onClick={handleComplete}
              disabled={updateReview.isPending}
              className="px-4 py-2 rounded-xl bg-success text-white text-[13px] font-medium hover:bg-success/90 disabled:opacity-50 transition-colors"
            >
              Complete Review
            </button>
          </div>
        ) : r ? (
          <div className="flex gap-2 px-5 py-3">
            <button
              onClick={() => handleExport("csv")}
              disabled={exporting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-text-muted hover:text-text border border-border-c transition-colors"
            >
              <FileText className="w-3.5 h-3.5" /> CSV
            </button>
            <button
              onClick={() => handleExport("xlsx")}
              disabled={exporting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-text-muted hover:text-text border border-border-c transition-colors"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
            </button>
          </div>
        ) : null
      }
    >
      {review.isLoading ? (
        <div className="space-y-3 p-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-text-faint/10 animate-pulse" />
          ))}
        </div>
      ) : !r ? (
        <p className="text-text-muted text-center py-8">Review not found</p>
      ) : (
        <div className="space-y-5 p-1">
          {/* Summary stats */}
          {stats && (
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: "Pending", value: stats.pending, tone: "text-text-muted" },
                { label: "Approved", value: stats.approved, tone: "text-success" },
                { label: "Revoked", value: stats.revoked, tone: "text-danger" },
                { label: "Flagged", value: stats.flagged, tone: "text-warn" },
              ].map((s) => (
                <div key={s.label} className="text-center p-3 rounded-xl bg-text-faint/5">
                  <div className={cn("font-display text-[20px] font-medium", s.tone)}>{s.value}</div>
                  <div className="text-[11px] text-text-faint mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {r.description && (
            <p className="text-text-muted text-[13px] leading-relaxed">{r.description}</p>
          )}

          {/* Entry list */}
          <div className="space-y-2">
            {entries.map((entry) => (
              <EntryCard
                key={entry.entry_id}
                entry={entry}
                reviewStatus={r.status}
                onDecide={(d) => handleDecide(entry.entry_id, d)}
                isDeciding={decideEntry.isPending}
                noteOpen={noteEntryId === entry.entry_id}
                onToggleNote={() => {
                  setNoteEntryId(noteEntryId === entry.entry_id ? null : entry.entry_id);
                  setNoteText("");
                }}
                noteText={noteText}
                onNoteChange={setNoteText}
              />
            ))}
          </div>
        </div>
      )}
    </Drawer>
  );
}

/* ── Entry card ─────────────────────────────────────────────── */
function EntryCard({
  entry: e,
  reviewStatus,
  onDecide,
  isDeciding,
  noteOpen,
  onToggleNote,
  noteText,
  onNoteChange,
}: {
  entry: AccessReviewEntry;
  reviewStatus: string;
  onDecide: (d: "approved" | "revoked" | "flagged") => void;
  isDeciding: boolean;
  noteOpen: boolean;
  onToggleNote: () => void;
  noteText: string;
  onNoteChange: (v: string) => void;
}) {
  const canDecide = reviewStatus !== "completed" && reviewStatus !== "cancelled";

  return (
    <div className="rounded-xl border border-border-c bg-panel p-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-accent/10 grid place-items-center shrink-0">
          <span className="text-[13px] font-bold text-accent-glow">
            {e.user_name.charAt(0).toUpperCase()}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-medium truncate">{e.user_name}</span>
            {e.role_name && <Pill tone="neutral" dot={false}>{e.role_name}</Pill>}
            <Pill tone={DECISION_TONE[e.decision] ?? "neutral"} dot={false}>
              {e.decision}
            </Pill>
          </div>
          <div className="text-[11px] text-text-faint mt-0.5">
            {e.user_email ?? "No email"} · {e.businesses.join(", ")}
            {e.permissions_snapshot.length > 0 && ` · ${e.permissions_snapshot.length} permissions`}
          </div>
        </div>
      </div>

      {e.reviewer_note && (
        <div className="mt-2 ml-11 text-[12px] text-text-muted italic bg-text-faint/5 rounded-lg px-3 py-2">
          {e.reviewer_note}
        </div>
      )}

      {canDecide && e.decision === "pending" && (
        <div className="mt-3 ml-11">
          {noteOpen && (
            <textarea
              className="w-full mb-2 px-3 py-2 rounded-lg bg-bg border border-border-c text-[12px] min-h-[50px] resize-y"
              placeholder="Add a note (optional)..."
              value={noteText}
              onChange={(ev) => onNoteChange(ev.target.value)}
            />
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => onDecide("approved")}
              disabled={isDeciding}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-success/10 text-success text-[12px] font-medium hover:bg-success/20 transition-colors disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" /> Approve
            </button>
            <button
              onClick={() => onDecide("revoked")}
              disabled={isDeciding}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-danger/10 text-danger text-[12px] font-medium hover:bg-danger/20 transition-colors disabled:opacity-50"
            >
              <XIcon className="w-3.5 h-3.5" /> Revoke
            </button>
            <button
              onClick={() => onDecide("flagged")}
              disabled={isDeciding}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-warn/10 text-warn text-[12px] font-medium hover:bg-warn/20 transition-colors disabled:opacity-50"
            >
              <Flag className="w-3.5 h-3.5" /> Flag
            </button>
            <button
              onClick={onToggleNote}
              className="text-[11px] text-text-faint hover:text-text-muted ml-auto transition-colors"
            >
              {noteOpen ? "Hide note" : "Add note"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
