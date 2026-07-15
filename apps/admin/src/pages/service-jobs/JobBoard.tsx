import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Package,
  UserCheck,
  UserPlus,
  User,
  Copy,
  Check,
  Clock,
  AlertTriangle,
} from "lucide-react";
import {
  Button,
  Pill,
  Skeleton,
  EmptyState,
  MoneyText,
} from "@/components/ui/primitives";
import { formatDate, formatDateTime } from "@/lib/format";
import { Drawer } from "@/components/ui/Drawer";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/controls";
import { ErrorState } from "@/components/ui/controls";
import type { ServiceJob, ServiceType, JobStatus } from "./types";
import {
  useJobs,
  useJob,
  useJobActions,
  useJobChemicals,
  useRecordChemical,
  useServiceTypes,
  useRecipes,
  useRecipe,
  useCreateJob,
  useAssignableStylists,
  useJobActivity,
  useJobMaterials,
  useJobReferences,
  useJobCustody,
  useAccountability,
} from "./hooks";
import {
  JOB_STATUS_META,
  JOB_NEXT_STATES,
  BOARD_COLUMNS,
  SERVICE_KEY_ICON,
  RATING_LABELS,
  CHEMICAL_UNITS,
  CUSTOMER_HAPPINESS_FACES,
  HAPPINESS_EMOJI,
} from "./constants";

// Human-readable label for each audit action_key the job lifecycle writes.
const ACTIVITY_LABELS: Record<string, string> = {
  "service_jobs.create": "Job created",
  "service_jobs.from_order": "Job opened from order",
  "service_jobs.assign": "Assigned to stylist",
  "service_jobs.assign_staff": "Assigned to stylist",
  "service_jobs.start": "Started work",
  "service_jobs.pause": "Paused",
  "service_jobs.resume": "Resumed",
  "service_jobs.return": "Returned for QC",
  "service_jobs.qc": "QC reviewed",
  "service_jobs.dispatch": "Dispatched",
  "service_jobs.hand_to_sales": "Handed to sales",
  "service_jobs.outcome": "Outcome recorded",
  "service_jobs.update": "Details updated",
  "service_jobs.advance": "Status advanced",
  "service_jobs.write_off": "Wig written off",
};

// ── Star rating display ────────────────────────────────────

function StarRating({
  value,
  max = 5,
}: {
  value: number | null;
  max?: number;
}) {
  if (!value) return <span className="text-text-muted text-sm">Not rated</span>;
  return (
    <span className="text-sm font-mono">
      {"★".repeat(value)}
      {"☆".repeat(max - value)}
      <span className="text-text-muted ml-1">({RATING_LABELS[value]})</span>
    </span>
  );
}

// ── Interactive star picker ────────────────────────────────

function StarPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`text-xl transition-colors ${n <= value ? "text-yellow-400" : "text-text-muted"}`}
          onClick={() => onChange(n)}
        >
          ★
        </button>
      ))}
    </div>
  );
}

// ── Customer happiness (tap-a-face) ────────────────────────

/**
 * The friendliest possible capture: staff just tap the face that matches how
 * the customer looked at collection. No stars, no reading required — meant for
 * fast, low-stress use at the front desk.
 */
function FacePicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {CUSTOMER_HAPPINESS_FACES.map((f) => {
        const active = f.value === value;
        return (
          <button
            key={f.value}
            type="button"
            onClick={() => onChange(f.value)}
            aria-label={f.label}
            aria-pressed={active}
            className={`flex flex-col items-center gap-1 rounded-xl border px-3 py-2 transition-all ${
              active
                ? "border-accent bg-accent/10 scale-105"
                : "border-line opacity-70 hover:opacity-100"
            }`}
          >
            <span className="text-2xl leading-none">{f.emoji}</span>
            <span className="text-[11px] text-text-muted">{f.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Read-only face for the "at a glance" rating card — same face set as
// FacePicker, no interaction.
function FaceDisplay({ value }: { value: number | null }) {
  if (!value)
    return <span className="text-text-muted text-sm">Not rated yet</span>;
  const f = CUSTOMER_HAPPINESS_FACES.find((x) => x.value === value);
  if (!f) return null;
  return (
    <span className="text-sm">
      <span className="text-xl align-middle mr-1">{f.emoji}</span>
      {f.label}
    </span>
  );
}

// ── "Copy it onto the tag" confirmation ────────────────────
//
// Shown once, right after the assignment that actually allocates a fresh
// tag_code (never on a later reassignment of the same job — the code stays
// stable once it's written on the physical tag). Forces a deliberate
// acknowledgement rather than a toast that's easy to miss, since the whole
// point of the code is that it makes it onto the tag before anyone walks
// away from the desk.
function TagConfirmModal({
  code,
  onClose,
}: {
  code: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Write this on the tag"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={copy} icon={<Copy className="w-3.5 h-3.5" />}>
            {copied ? "Copied" : "Copy code"}
          </Button>
          <Button onClick={onClose} icon={<Check className="w-3.5 h-3.5" />}>
            I've written it on the tag
          </Button>
        </>
      }
    >
      <div className="text-center py-4 space-y-2">
        <p className="text-sm text-text-muted">
          Pin this code to the customer's hair now, before it leaves the desk.
        </p>
        <p className="font-mono text-4xl tracking-[0.2em] text-accent-glow">
          {code}
        </p>
      </div>
    </Modal>
  );
}

// ── Job card (Kanban cell) ─────────────────────────────────

function JobCard({
  job,
  serviceTypes,
  onClick,
}: {
  job: ServiceJob;
  serviceTypes: ServiceType[];
  onClick: () => void;
}) {
  const navigate = useNavigate();
  const st = serviceTypes.find(
    (t) => t.service_type_id === job.service_type_id,
  );
  const icon = st ? (SERVICE_KEY_ICON[st.service_key] ?? "🔧") : "🔧";
  const isPocketing =
    job.status === "completed" &&
    !job.sales_order_id &&
    !job.intercompany_transaction_id;

  return (
    <button
      type="button"
      onClick={onClick}
      className="glass w-full text-left p-3 rounded-lg border border-line hover:border-accent/40 transition-colors space-y-1.5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-text-muted">{job.job_number}</span>
        {isPocketing && (
          <span
            className="text-danger text-xs font-semibold"
            title="Completed without linked sale"
          >
            ⚠ No Sale
          </span>
        )}
      </div>
      {/* Source order chip — one tap jumps to the sales order that opened this
          job, so the studio floor can answer "who's this wig for?" instantly. */}
      {job.sales_order_id && (
        <span
          role="link"
          tabIndex={0}
          className="inline-flex items-center gap-1 text-[11px] font-mono text-accent hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/sales/orders/${job.sales_order_id}`);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              navigate(`/sales/orders/${job.sales_order_id}`);
            }
          }}
        >
          <Package className="w-3 h-3" />
          {job.sales_order_number ?? "Order"}
        </span>
      )}
      <div className="flex items-center gap-1.5">
        <span>{icon}</span>
        <span className="text-sm font-medium truncate">
          {st?.display_name ?? job.service_type_id}
        </span>
      </div>
      {job.hair_description && (
        <p className="text-xs text-text-muted truncate">{job.hair_description}</p>
      )}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <span className="text-xs text-text-muted">
          {job.assigned_staff_user_id
            ? "Staff assigned"
            : job.assigned_stylist_id
              ? "Stylist assigned"
              : "Unassigned"}
        </span>
        {job.scheduled_for && (
          <span className="text-xs font-mono text-text-muted">
            {formatDate(job.scheduled_for)}
          </span>
        )}
      </div>
      {job.quality_rating !== null && <StarRating value={job.quality_rating} />}
      {job.customer_rating !== null && (
        <div className="text-sm" title={`Customer: ${RATING_LABELS[job.customer_rating]}`}>
          <span className="mr-1">{HAPPINESS_EMOJI[job.customer_rating]}</span>
          <span className="text-text-muted text-xs">customer</span>
        </div>
      )}
    </button>
  );
}

// ── Chemicals tab ──────────────────────────────────────────

function ChemicalsTab({ jobId }: { jobId: string }) {
  const { data: chemicals = [], isLoading } = useJobChemicals(jobId);
  const record = useRecordChemical(jobId);
  const [form, setForm] = useState({
    chemical_name: "",
    chemical_brand: "",
    qty_used: "",
    unit: "ml",
    cost_ngn: "",
    notes: "",
  });

  const handleAdd = () => {
    if (!form.chemical_name || !form.qty_used) return;
    record.mutate(
      {
        chemical_name: form.chemical_name,
        chemical_brand: form.chemical_brand || undefined,
        qty_used: parseFloat(form.qty_used),
        unit: form.unit,
        cost_ngn: form.cost_ngn ? parseFloat(form.cost_ngn) : undefined,
        notes: form.notes || undefined,
      },
      {
        onSuccess: () =>
          setForm({
            chemical_name: "",
            chemical_brand: "",
            qty_used: "",
            unit: "ml",
            cost_ngn: "",
            notes: "",
          }),
      },
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">Chemicals consumed for this job</p>

      {isLoading ? (
        <Skeleton className="h-24" />
      ) : chemicals.length === 0 ? (
        <EmptyState
          icon={<span className="text-2xl">🧴</span>}
          title="No chemicals recorded"
          message="Add below"
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-text-muted text-xs">
                <th className="text-left py-1 pr-3">Chemical</th>
                <th className="text-left py-1 pr-3">Brand</th>
                <th className="text-right py-1 pr-3">Qty</th>
                <th className="text-right py-1 pr-3">Unit</th>
                <th className="text-right py-1">Cost</th>
              </tr>
            </thead>
            <tbody>
              {chemicals.map((c) => (
                <tr key={c.consumption_id} className="border-b border-line">
                  <td className="py-1.5 pr-3 font-medium">{c.chemical_name}</td>
                  <td className="py-1.5 pr-3 text-text-muted">
                    {c.chemical_brand ?? "—"}
                  </td>
                  <td className="py-1.5 pr-3 text-right font-mono">
                    {c.qty_used}
                  </td>
                  <td className="py-1.5 pr-3 text-right text-text-muted">
                    {c.unit}
                  </td>
                  <td className="py-1.5 text-right">
                    {c.cost_ngn ? (
                      <MoneyText ngn={parseFloat(c.cost_ngn)} />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-line pt-4">
        <p className="text-xs text-text-muted mb-3 font-semibold uppercase tracking-wide">
          Add chemical
        </p>
        <div className="grid grid-cols-2 gap-2">
          <input
            className="input col-span-2"
            placeholder="Chemical name *"
            value={form.chemical_name}
            onChange={(e) =>
              setForm((f) => ({ ...f, chemical_name: e.target.value }))
            } autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
          />
          <input
            className="input"
            placeholder="Brand"
            value={form.chemical_brand}
            onChange={(e) =>
              setForm((f) => ({ ...f, chemical_brand: e.target.value }))
            } autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
          />
          <input
            className="input"
            placeholder="Notes"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
          />
          <input
            className="input"
            type="number"
            min="0"
            step="0.001"
            placeholder="Quantity *"
            value={form.qty_used}
            onChange={(e) =>
              setForm((f) => ({ ...f, qty_used: e.target.value }))
            } autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
          />
          <Select
            value={form.unit}
            onChange={(v) => setForm((f) => ({ ...f, unit: v }))}
            options={CHEMICAL_UNITS}
          />
          <input
            className="input col-span-2"
            type="number"
            min="0"
            placeholder="Cost (NGN)"
            value={form.cost_ngn}
            onChange={(e) =>
              setForm((f) => ({ ...f, cost_ngn: e.target.value }))
            } autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
          />
        </div>
        <Button
          className="mt-3"
          onClick={handleAdd}
          disabled={!form.chemical_name || !form.qty_used || record.isPending}
        >
          {record.isPending ? "Saving…" : "Add Chemical"}
        </Button>
      </div>
    </div>
  );
}

// ── Outcome tab ────────────────────────────────────────────

function OutcomeTab({ job, jobId }: { job: ServiceJob; jobId: string }) {
  const { outcome } = useJobActions(jobId);
  const [qRating, setQRating] = useState(job.quality_rating ?? 0);
  const [qNotes, setQNotes] = useState(job.quality_notes ?? "");
  const [cRating, setCRating] = useState(job.customer_rating ?? 0);
  const [cFeedback, setCFeedback] = useState(job.customer_feedback ?? "");

  const handleSave = () => {
    outcome.mutate({
      quality_rating: qRating || undefined,
      quality_notes: qNotes || undefined,
      customer_rating: cRating || undefined,
      customer_feedback: cFeedback || undefined,
    });
  };

  return (
    <div className="space-y-5">
      {/* Customer happiness — the headline question, tap-a-face simple */}
      <div className="glass p-4 rounded-lg space-y-3 border border-accent/30">
        <div>
          <p className="text-base font-semibold">
            How happy was the customer? 💛
          </p>
          <p className="text-xs text-text-muted">
            Tap the face that matches how they looked at collection.
          </p>
        </div>
        <FacePicker value={cRating} onChange={setCRating} />
        <textarea
          className="input w-full h-20 text-sm"
          placeholder="Anything they said? (optional)"
          value={cFeedback}
          onChange={(e) => setCFeedback(e.target.value)}
        />
      </div>

      {/* Internal quality — for the team, kept secondary */}
      <div className="glass p-4 rounded-lg space-y-3">
        <p className="text-sm font-semibold">Internal Quality Rating</p>
        <StarPicker value={qRating} onChange={setQRating} />
        <textarea
          className="input w-full h-20 text-sm"
          placeholder="Quality notes…"
          value={qNotes}
          onChange={(e) => setQNotes(e.target.value)}
        />
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={outcome.isPending}>
          {outcome.isPending ? "Saving…" : "Save Outcome"}
        </Button>
        {outcome.isSuccess && (
          <span className="text-success text-sm">Saved ✓</span>
        )}
      </div>
    </div>
  );
}

// ── Recipe card (inside detail drawer) ────────────────────

function RecipeCard({ recipeId }: { recipeId: string }) {
  const { data: recipe, isLoading } = useRecipe(recipeId);
  if (isLoading) return <Skeleton className="h-24" />;
  if (!recipe) return null;

  return (
    <div className="glass p-3 rounded-lg space-y-2">
      <p className="text-sm font-semibold">{recipe.display_name}</p>
      {recipe.target_shade && (
        <p className="text-xs text-text-muted">
          Target shade: {recipe.target_shade}
        </p>
      )}
      <div className="space-y-1">
        {recipe.ingredients.map((ing, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="text-text-muted w-4">{i + 1}.</span>
            <span className="font-medium">{ing.chemical_name}</span>
            {ing.brand && <span className="text-text-muted">({ing.brand})</span>}
            {(ing.qty_ml || ing.qty_g) && (
              <span className="font-mono ml-auto">
                {ing.qty_ml ? `${ing.qty_ml} ml` : `${ing.qty_g} g`}
              </span>
            )}
            {ing.role && <span className="text-text-muted italic">{ing.role}</span>}
          </div>
        ))}
      </div>
      {recipe.instructions && (
        <p className="text-xs text-text-muted border-t border-line pt-2">
          {recipe.instructions}
        </p>
      )}
    </div>
  );
}

// ── Intercompany Flow-1 panel ──────────────────────────────

/**
 * Flow-1 (Faitlyn styles Pixie's hair): make the cross-entity link explicit on
 * the job side and show the matched FLH styling invoice. When the job crosses
 * entities but isn't linked yet, it flags the books risk and lets finance
 * attach the recorded inter-company transaction.
 */
function IntercompanyPanel({ job }: { job: ServiceJob }) {
  const { linkIntercompany } = useJobActions(job.job_id);
  const [icId, setIcId] = useState("");
  const linked = !!job.intercompany_number;

  return (
    <div className="border-t border-line pt-4 space-y-2">
      <p className="text-xs text-text-muted uppercase tracking-wide font-semibold">
        Inter-company · Flow 1
      </p>
      {linked ? (
        <div className="glass p-3 rounded-lg space-y-1.5 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-text-muted">Styling invoice</span>
            <span className="font-mono">
              {job.intercompany_seller_doc ?? job.intercompany_number}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-text-muted">
              {job.intercompany_seller_brand} → {job.intercompany_buyer_brand}
            </span>
            {job.intercompany_status && (
              <Pill tone="info">{job.intercompany_status}</Pill>
            )}
          </div>
          {job.intercompany_amount_ngn && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-text-muted">Amount</span>
              <MoneyText ngn={parseFloat(job.intercompany_amount_ngn)} />
            </div>
          )}
        </div>
      ) : (
        <div className="glass p-3 rounded-lg space-y-2 border border-warn/30">
          <p className="text-sm text-warn font-medium">
            ⚠ No matched inter-company invoice yet
          </p>
          <p className="text-xs text-text-muted">
            This wig belongs to another entity. Record the FLH styling invoice
            in Intercompany, then paste its transaction ID here to link it.
          </p>
          <div className="flex items-center gap-2">
            <input
              className="input flex-1 text-sm font-mono"
              placeholder="Intercompany transaction ID"
              value={icId}
              onChange={(e) => setIcId(e.target.value)} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
            />
            <Button
              size="sm"
              disabled={!icId.trim() || linkIntercompany.isPending}
              onClick={() => linkIntercompany.mutate(icId.trim())}
            >
              {linkIntercompany.isPending ? "Linking…" : "Link"}
            </Button>
          </div>
          {linkIntercompany.isError && (
            <p className="text-xs text-danger">
              {(linkIntercompany.error as Error)?.message ??
                "Could not link — check the transaction ID."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Stylist assignment panel ───────────────────────────────
//
// Two visual states:
//   1. Already assigned → show the stylist's name + avatar + a "Change" chip
//      that reopens the picker (re-assignment is legal but requires the wig
//      to be returned first — the backend enforces that).
//   2. Unassigned → show the picker. Selecting a row calls POST /:id/assign,
//      which sets assigned_staff_user_id and moves the job to 'assigned'; the
//      DB trigger raises shared.tasks, the service layer sends a push, and
//      the target-progress subscriber will bump the stylist's monthly count
//      once the job completes.
//
// Nothing here is decorative — the entire HR + tasks + performance chain
// waits on the assignment happening through the /assign route rather than
// through a bare status advance.
function AssignmentPanel({
  job,
  jobId,
}: {
  job: ServiceJob;
  jobId: string;
}) {
  const [picking, setPicking] = useState(false);
  const [confirmTag, setConfirmTag] = useState<string | null>(null);
  const assigned = !!job.assigned_staff_user_id;
  const showPicker = !assigned || picking;

  return (
    <div className="border-t border-line pt-4 space-y-2">
      <p className="text-xs text-text-muted uppercase tracking-wide font-semibold">
        Assignment
      </p>
      {assigned && !picking && (
        <AssignedRow job={job} onChange={() => setPicking(true)} />
      )}
      {showPicker && (
        <StylistPicker
          jobId={jobId}
          currentUserId={job.assigned_staff_user_id}
          onDone={() => setPicking(false)}
          onAssigned={(assignedJob) => {
            if (assignedJob.is_new_tag && assignedJob.tag_code)
              setConfirmTag(assignedJob.tag_code);
          }}
        />
      )}
      {confirmTag && (
        <TagConfirmModal code={confirmTag} onClose={() => setConfirmTag(null)} />
      )}
    </div>
  );
}

function AssignedRow({
  job,
  onChange,
}: {
  job: ServiceJob;
  onChange: () => void;
}) {
  const { data: stylists = [] } = useAssignableStylists(true);
  const current = stylists.find(
    (s) => s.user_id === job.assigned_staff_user_id,
  );
  return (
    <div className="glass p-3 rounded-lg flex items-center gap-3">
      <div className="w-9 h-9 rounded-full bg-accent/[0.12] grid place-items-center overflow-hidden shrink-0">
        {current?.avatar_url ? (
          // eslint-disable-next-line jsx-a11y/img-redundant-alt
          <img
            src={current.avatar_url}
            alt={current.full_name}
            className="w-full h-full object-cover"
          />
        ) : (
          <UserCheck className="w-4 h-4 text-accent-glow" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate">
          {current?.full_name ?? "Assigned stylist"}
        </div>
        <div className="text-[11px] text-text-muted truncate flex items-center gap-1.5">
          <span>{current?.job_title ?? "Stylist"}</span>
          {current && (
            <span>
              · {current.open_jobs_count} open job
              {current.open_jobs_count === 1 ? "" : "s"} right now
            </span>
          )}
          {current?.on_leave_today && (
            <Pill tone="warn">On leave today</Pill>
          )}
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={onChange}>
        Change
      </Button>
    </div>
  );
}

function StylistPicker({
  jobId,
  currentUserId,
  onDone,
  onAssigned,
}: {
  jobId: string;
  currentUserId: string | null;
  onDone: () => void;
  onAssigned?: (job: ServiceJob) => void;
}) {
  const { assign } = useJobActions(jobId);
  const { data: stylists = [], isLoading } = useAssignableStylists(true);

  if (isLoading) {
    return (
      <div className="glass p-3 rounded-lg text-sm text-text-muted">
        Loading stylists…
      </div>
    );
  }
  if (stylists.length === 0) {
    return (
      <div className="glass p-3 rounded-lg text-sm text-text-muted">
        No stylists available. Junior/Senior/Head Stylists in the Operations
        department of the business you&rsquo;re currently viewing — with an
        active login account and not on a fixed-term contract that&rsquo;s
        already ended — show here.
      </div>
    );
  }

  return (
    <div className="glass p-2 rounded-lg space-y-1">
      {stylists.map((s) => {
        const isCurrent = s.user_id === currentUserId;
        const disabled = s.on_leave_today || assign.isPending;
        return (
          <button
            key={s.user_id}
            type="button"
            disabled={disabled}
            onClick={() => {
              assign.mutate(s.user_id, {
                onSuccess: (assignedJob) => {
                  onAssigned?.(assignedJob);
                  onDone();
                },
              });
            }}
            className={
              "w-full flex items-center gap-3 px-2.5 py-2 rounded-md text-left transition-colors " +
              (disabled
                ? "opacity-50 cursor-not-allowed"
                : "hover:bg-text-primary/[0.05]") +
              (isCurrent ? " bg-accent/[0.06]" : "")
            }
          >
            <div className="w-8 h-8 rounded-full bg-accent/[0.1] grid place-items-center overflow-hidden shrink-0">
              {s.avatar_url ? (
                <img
                  src={s.avatar_url}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-4 h-4 text-accent-glow" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate flex items-center gap-2">
                {s.full_name}
                {isCurrent && <Pill tone="accent">Current</Pill>}
              </div>
              <div className="text-[11px] text-text-muted truncate">
                {s.job_title} · {s.open_jobs_count} open
                {s.on_leave_today ? " · on leave today" : ""}
              </div>
            </div>
            {!isCurrent && !disabled && (
              <UserPlus className="w-4 h-4 text-text-muted shrink-0" />
            )}
          </button>
        );
      })}
      {assign.isError && (
        <p className="text-xs text-danger px-2 pt-1">
          {(assign.error as Error)?.message ?? "Could not assign — try again."}
        </p>
      )}
      {currentUserId && (
        <div className="pt-1 flex justify-end">
          <Button variant="ghost" size="sm" onClick={onDone}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Style brief (customer's references) — condensed read view ──
//
// Mirrors JobWorkPanel's brief rendering exactly (image/audio show as a
// labelled chip, not a thumbnail — there's no doc-id→URL resolution wired
// up anywhere in this module yet, so a real gallery is future work, not
// this one). Renders nothing at all when there's no brief on file.
function JobReferencesBrief({ jobId }: { jobId: string }) {
  const { data: refs = [] } = useJobReferences(jobId);
  if (refs.length === 0) return null;
  return (
    <div className="rounded-lg border border-accent/20 bg-accent/5 p-3 space-y-2">
      <div className="text-xs text-accent-glow font-semibold">
        Style brief — what they asked for
      </div>
      {refs.map((r) => (
        <div key={r.reference_id} className="flex items-start gap-2 text-sm">
          {r.ref_type === "creative_freedom" && (
            <Pill tone="accent">🎨 Creative freedom</Pill>
          )}
          {r.ref_type === "video_link" && r.url && (
            <a
              href={r.url}
              target="_blank"
              rel="noreferrer"
              className="text-info hover:underline break-all"
            >
              {r.url}
            </a>
          )}
          {(r.ref_type === "text" || r.body) && r.body && (
            <span className="text-text-primary">&ldquo;{r.body}&rdquo;</span>
          )}
          {(r.ref_type === "image" || r.ref_type === "audio") && (
            <span className="text-text-muted">
              {r.ref_type === "image" ? "📷 photo" : "🎙 voice note"}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Cost breakdown — materials + chemicals + labour ─────────
function CostBreakdown({ job, jobId }: { job: ServiceJob; jobId: string }) {
  const { data: materialsUsed = [] } = useJobMaterials(jobId);
  const materials = parseFloat(job.materials_cost_ngn || "0");
  const chemicals = parseFloat(job.chemicals_cost_ngn || "0");
  const labour = parseFloat(job.actual_cost_ngn || job.agreed_cost_ngn || "0");
  const total = materials + chemicals + labour;
  if (total <= 0 && materialsUsed.length === 0) return null;
  return (
    <div className="glass rounded-lg p-3 space-y-2">
      <p className="text-[11px] text-text-muted uppercase tracking-wide font-semibold">
        Materials &amp; cost
      </p>
      {materialsUsed.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {materialsUsed.map((m) => (
            <Pill key={m.material_id} tone={m.kind === "chemical" ? "info" : "accent"}>
              {m.chemical_name ?? "item"}
              {m.quantity ? ` ×${m.quantity}` : ""}
            </Pill>
          ))}
        </div>
      )}
      {total > 0 && (
        <>
          <div className="grid grid-cols-2 gap-y-1 text-sm">
            {materials > 0 && (
              <>
                <span className="text-text-muted">Materials</span>
                <MoneyText ngn={materials} />
              </>
            )}
            {chemicals > 0 && (
              <>
                <span className="text-text-muted">Chemicals</span>
                <MoneyText ngn={chemicals} />
              </>
            )}
            {labour > 0 && (
              <>
                <span className="text-text-muted">Labour</span>
                <MoneyText ngn={labour} />
              </>
            )}
            <span className="font-semibold border-t border-line pt-1 mt-1">
              Total
            </span>
            <span className="font-semibold border-t border-line pt-1 mt-1">
              <MoneyText ngn={total} />
            </span>
          </div>
          {materials > 0 && (
            <p className="text-[10px] text-text-muted">
              Materials cost is best-effort — priced from stock at the time
              it was deducted, where deducted from tracked stock.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ── Wig custody mini-timeline ────────────────────────────────
function WigCustodyMini({ jobId }: { jobId: string }) {
  const { data: entries = [] } = useJobCustody(jobId);
  const { data: accountability } = useAccountability();
  if (entries.length === 0) return null;
  const outEntry = entries.find((e) => e.event === "out");
  const hasReturn = entries.some((e) =>
    ["return", "dispatched", "write_off"].includes(e.event),
  );
  const daysOut = outEntry
    ? Math.floor(
        (Date.now() - new Date(outEntry.created_at).getTime()) / 86400000,
      )
    : 0;
  const overdue =
    !hasReturn &&
    outEntry &&
    accountability &&
    daysOut > accountability.threshold_days;
  const EVENT_LABEL: Record<string, string> = {
    out: "Out with stylist",
    return: "Returned",
    dispatched: "Dispatched",
    write_off: "Written off",
  };
  return (
    <div className="glass rounded-lg p-3 space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-text-muted uppercase tracking-wide font-semibold">
          Wig custody
        </p>
        {overdue && (
          <Pill tone="danger">
            <AlertTriangle className="w-3 h-3 inline mr-1" />
            {daysOut}d overdue
          </Pill>
        )}
      </div>
      <div className="space-y-1 text-sm">
        {entries.map((e) => (
          <div key={e.entry_id} className="flex items-center gap-2">
            <Clock className="w-3 h-3 text-text-muted shrink-0" />
            <span>{EVENT_LABEL[e.event] ?? e.event}</span>
            <span className="text-text-muted text-[11px] ml-auto">
              {formatDateTime(e.created_at)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Activity timeline tab ────────────────────────────────────
function ActivityTab({ jobId }: { jobId: string }) {
  const { data: entries = [], isLoading } = useJobActivity(jobId);
  if (isLoading)
    return <Skeleton className="h-24" />;
  if (entries.length === 0)
    return (
      <p className="text-sm text-text-muted py-4">
        No activity recorded for this job yet.
      </p>
    );
  return (
    <div className="space-y-3">
      {entries.map((e) => (
        <div key={e.log_id} className="flex items-start gap-3 text-sm">
          <div className="w-2 h-2 rounded-full bg-accent mt-1.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-medium">
              {ACTIVITY_LABELS[e.action] ?? e.action}
            </div>
            <div className="text-[11px] text-text-muted">
              {e.user_name} · {formatDateTime(e.occurred_at)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Job detail drawer ──────────────────────────────────────

function JobDetailDrawer({
  jobId,
  serviceTypes,
  onClose,
}: {
  jobId: string;
  serviceTypes: ServiceType[];
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { data: job, isLoading } = useJob(jobId);
  const actions = useJobActions(jobId);
  const [tab, setTab] = useState<
    "details" | "chemicals" | "outcome" | "activity"
  >("details");
  const [costInput, setCostInput] = useState("");

  if (isLoading) {
    return (
      <Drawer open onClose={onClose} title="Service Job">
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
  const nextStates = JOB_NEXT_STATES[job.status] ?? [];
  const st = serviceTypes.find(
    (t) => t.service_type_id === job.service_type_id,
  );
  const isPocketing =
    job.status === "completed" &&
    !job.sales_order_id &&
    !job.intercompany_transaction_id;

  return (
    <Drawer open onClose={onClose} title={job.job_number}>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <Pill tone={meta.tone}>{meta.label}</Pill>
          {st && (
            <span className="text-sm">
              {SERVICE_KEY_ICON[st.service_key] ?? "🔧"} {st.display_name}
            </span>
          )}
          {isPocketing && (
            <span className="text-xs font-semibold text-danger border border-danger/40 rounded px-2 py-0.5">
              ⚠ No linked sale
            </span>
          )}
          {job.sales_order_id && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Package className="w-3.5 h-3.5" />}
              onClick={() =>
                navigate(`/sales/orders/${job.sales_order_id}`)
              }
            >
              {job.sales_order_number ?? "View order"}
            </Button>
          )}
        </div>

        {/* Identity strip — always visible regardless of tab. The photo is
            the fastest way to match a physical wig to its job; customer +
            order date give the "who/when" without opening the order. */}
        {(job.styled_product_name ||
          job.base_product_name ||
          job.customer_name) && (
          <div className="glass rounded-lg p-3 flex items-center gap-3">
            <div className="w-14 h-14 rounded-lg bg-accent/[0.08] grid place-items-center overflow-hidden shrink-0">
              {job.styled_product_image_url ? (
                // eslint-disable-next-line jsx-a11y/img-redundant-alt
                <img
                  src={job.styled_product_image_url}
                  alt={job.styled_product_name ?? "Styled product"}
                  className="w-full h-full object-cover"
                />
              ) : (
                <Package className="w-5 h-5 text-text-muted" />
              )}
            </div>
            <div className="flex-1 min-w-0 text-sm">
              <div className="font-semibold truncate">
                {job.styled_product_name ??
                  job.base_product_name ??
                  "Custom job"}
              </div>
              {job.styled_product_name && job.base_product_name && (
                <div className="text-[11px] text-text-muted truncate">
                  Base: {job.base_product_name}
                </div>
              )}
              <div className="text-[11px] text-text-muted truncate">
                {job.customer_name ?? "Walk-in / no customer on file"}
                {job.order_placed_at &&
                  ` · ordered ${formatDateTime(job.order_placed_at)}`}
              </div>
            </div>
          </div>
        )}

        {/* Tab bar */}
        <div className="flex border-b border-line gap-4">
          {(["details", "chemicals", "outcome", "activity"] as const).map(
            (t) => (
              <button
                key={t}
                type="button"
                className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
                  tab === t
                    ? "border-accent text-text-primary"
                    : "border-transparent text-text-muted hover:text-text-primary"
                }`}
                onClick={() => setTab(t)}
              >
                {t === "details"
                  ? "Details"
                  : t === "chemicals"
                    ? "Chemicals"
                    : t === "outcome"
                      ? "Outcome"
                      : "Activity"}
              </button>
            ),
          )}
        </div>

        {/* Details tab */}
        {tab === "details" && (
          <div className="space-y-4">
            {/* Ratings at a glance — open the whole time the job is live, not
                just once QC returns it, so a delay is visible immediately
                (a low/sad rating here is a live signal, not a retrospective
                one). Editing still happens on the Outcome tab; this is the
                read view. */}
            {(job.quality_rating || job.customer_rating) && (
              <div className="grid grid-cols-2 gap-3">
                <div className="glass rounded-lg p-3 space-y-1">
                  <p className="text-[11px] text-text-muted uppercase tracking-wide font-semibold">
                    Quality
                  </p>
                  <StarRating value={job.quality_rating} />
                </div>
                <div className="glass rounded-lg p-3 space-y-1">
                  <p className="text-[11px] text-text-muted uppercase tracking-wide font-semibold">
                    Customer happiness
                  </p>
                  <FaceDisplay value={job.customer_rating} />
                </div>
              </div>
            )}
            <JobReferencesBrief jobId={jobId} />
            <div className="grid grid-cols-2 gap-3 text-sm">
              {job.hair_description && (
                <>
                  <span className="text-text-muted">Hair</span>
                  <span>{job.hair_description}</span>
                </>
              )}
              {job.scheduled_for && (
                <>
                  <span className="text-text-muted">Scheduled</span>
                  <span className="font-mono">
                    {formatDateTime(job.scheduled_for)}
                  </span>
                </>
              )}
              {job.expected_completion_at && (
                <>
                  <span className="text-text-muted">Due</span>
                  <span className="font-mono">
                    {formatDateTime(job.expected_completion_at)}
                  </span>
                </>
              )}
              {job.tag_code && (
                <>
                  <span className="text-text-muted">Tag code</span>
                  <span className="font-mono tracking-widest">
                    {job.tag_code}
                  </span>
                </>
              )}
              {job.agreed_cost_ngn && !job.sales_order_id && (
                <>
                  <span className="text-text-muted">Agreed cost</span>
                  <MoneyText ngn={parseFloat(job.agreed_cost_ngn)} />
                </>
              )}
              {job.actual_cost_ngn && (
                <>
                  <span className="text-text-muted">Actual cost</span>
                  <MoneyText ngn={parseFloat(job.actual_cost_ngn)} />
                </>
              )}
              {job.is_intercompany && (
                <>
                  <span className="text-text-muted">Type</span>
                  <Pill tone="info">Intercompany</Pill>
                </>
              )}
            </div>

            {/* Order-sourced jobs: styling is prepaid via the sale. Show as
                context, not as an outstanding charge. */}
            {job.sales_order_id && job.agreed_cost_ngn && (
              <div className="rounded-[11px] border border-line/60 bg-accent/[0.04] px-3 py-2.5 flex items-center gap-2 text-[12px]">
                <Package className="w-3.5 h-3.5 text-accent-glow shrink-0" />
                <span className="text-text-muted">
                  Styling <span className="text-accent-glow font-semibold">included</span> in{" "}
                  {job.sales_order_number
                    ? `Order ${job.sales_order_number}`
                    : "the source order"}{" "}
                  · internal labour{" "}
                  <MoneyText ngn={parseFloat(job.agreed_cost_ngn)} />
                </span>
              </div>
            )}

            {/* Assignment card — the DB task trigger + push + HR target
                countdown all wait on assigned_staff_user_id being set. */}
            <AssignmentPanel job={job} jobId={jobId} />

            <CostBreakdown job={job} jobId={jobId} />
            <WigCustodyMini jobId={jobId} />

            {job.recipe_id && (
              <div>
                <p className="text-xs text-text-muted mb-1.5 uppercase tracking-wide font-semibold">
                  Recipe
                </p>
                <RecipeCard recipeId={job.recipe_id} />
              </div>
            )}

            {(job.is_intercompany || job.intercompany_number) && (
              <IntercompanyPanel job={job} />
            )}

            {(() => {
              // 'assigned' has its own picker (AssignmentPanel) — hide the raw
              // advance button so the operator can't skip picking a stylist.
              const buttons = nextStates.filter((s) => s !== "assigned");
              if (buttons.length === 0) return null;
              return (
                <div className="border-t border-line pt-4 space-y-2">
                  <p className="text-xs text-text-muted uppercase tracking-wide font-semibold">
                    Advance status
                  </p>
                  {buttons.includes("completed") && (
                    <input
                      className="input w-full text-sm"
                      type="number"
                      min="0"
                      placeholder="Actual cost NGN (optional)"
                      value={costInput}
                      onChange={(e) => setCostInput(e.target.value)} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
                    />
                  )}
                  <div className="flex flex-wrap gap-2">
                    {buttons.map((s) => {
                      const m = JOB_STATUS_META[s];
                      return (
                        <Button
                          key={s}
                          variant="secondary"
                          disabled={actions.advance.isPending}
                          onClick={() =>
                            actions.advance.mutate({
                              status: s,
                              actual_cost_ngn:
                                s === "completed" && costInput
                                  ? parseFloat(costInput)
                                  : undefined,
                            })
                          }
                        >
                          → {m.label}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {tab === "chemicals" && <ChemicalsTab jobId={jobId} />}
        {tab === "outcome" && <OutcomeTab job={job} jobId={jobId} />}
        {tab === "activity" && <ActivityTab jobId={jobId} />}
      </div>
    </Drawer>
  );
}

// ── Create job drawer ──────────────────────────────────────

function CreateJobDrawer({
  onClose,
  serviceTypes,
}: {
  onClose: () => void;
  serviceTypes: ServiceType[];
}) {
  const { data: recipes = [] } = useRecipes(true);
  const create = useCreateJob();
  const [form, setForm] = useState({
    service_type_id: serviceTypes[0]?.service_type_id ?? "",
    hair_description: "",
    recipe_id: "",
    scheduled_for: "",
    expected_completion_at: "",
    agreed_cost_ngn: "",
  });

  const handleCreate = () => {
    if (!form.service_type_id) return;
    create.mutate(
      {
        service_type_id: form.service_type_id,
        hair_description: form.hair_description || undefined,
        recipe_id: form.recipe_id || undefined,
        scheduled_for: form.scheduled_for || undefined,
        expected_completion_at: form.expected_completion_at || undefined,
        agreed_cost_ngn: form.agreed_cost_ngn
          ? parseFloat(form.agreed_cost_ngn)
          : undefined,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Drawer open onClose={onClose} title="New Service Job">
      <div className="space-y-4">
        <div>
          <label className="label">Service type</label>
          <Select
            value={form.service_type_id}
            onChange={(v) => setForm((f) => ({ ...f, service_type_id: v }))}
            options={serviceTypes.map((t) => ({
              value: t.service_type_id,
              label: `${SERVICE_KEY_ICON[t.service_key] ?? "🔧"} ${t.display_name}`,
            }))}
          />
        </div>

        <div>
          <label className="label">Hair description</label>
          <input
            className="input w-full"
            placeholder="e.g. 22in Body Wave 150% - Unit #A023"
            value={form.hair_description}
            onChange={(e) =>
              setForm((f) => ({ ...f, hair_description: e.target.value }))
            } autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
          />
        </div>

        {recipes.length > 0 && (
          <div>
            <label className="label">Recipe (optional)</label>
            <Select
              value={form.recipe_id}
              onChange={(v) => setForm((f) => ({ ...f, recipe_id: v }))}
              options={[
                { value: "", label: "None" },
                ...recipes.map((r) => ({
                  value: r.recipe_id,
                  label: r.display_name,
                })),
              ]}
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Scheduled for</label>
            <input
              type="datetime-local"
              className="input w-full"
              value={form.scheduled_for}
              onChange={(e) =>
                setForm((f) => ({ ...f, scheduled_for: e.target.value }))
              }
            />
          </div>
          <div>
            <label className="label">Expected completion</label>
            <input
              type="datetime-local"
              className="input w-full"
              value={form.expected_completion_at}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  expected_completion_at: e.target.value,
                }))
              }
            />
          </div>
        </div>

        <div>
          <label className="label">Agreed cost (NGN)</label>
          <input
            className="input w-full"
            type="number"
            min="0"
            placeholder="Leave blank to use service type default"
            value={form.agreed_cost_ngn}
            onChange={(e) =>
              setForm((f) => ({ ...f, agreed_cost_ngn: e.target.value }))
            } autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!form.service_type_id || create.isPending}
          >
            {create.isPending ? "Creating…" : "Create Job"}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

// ── Main board ─────────────────────────────────────────────

export function JobBoard({ canCreate }: { canCreate: boolean }) {
  const { data: serviceTypes = [] } = useServiceTypes(true);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [tagQuery, setTagQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  // The open job drawer is URL-driven (?job=<id>) so deep links from the
  // Order page + notifications land directly on the job, and closing it
  // cleans the param back off.
  const [sp, setSp] = useSearchParams();
  const detailJobId = sp.get("job");
  const setDetailJobId = (id: string | null) =>
    setSp((p) => {
      const next = new URLSearchParams(p);
      if (id) next.set("job", id);
      else next.delete("job");
      return next;
    });

  const { data, isLoading, isError } = useJobs(
    statusFilter
      ? { status: statusFilter, page_size: 200 }
      : { page_size: 200 },
  );
  const allJobs = data?.data ?? [];
  const tagQueryTrimmed = tagQuery.trim();
  const tagQueryLower = tagQueryTrimmed.toLowerCase();
  const jobs = tagQueryTrimmed
    ? allJobs.filter(
        (j) =>
          j.tag_code?.includes(tagQueryTrimmed) ||
          j.customer_name?.toLowerCase().includes(tagQueryLower) ||
          j.sales_order_number?.toLowerCase().includes(tagQueryLower),
      )
    : allJobs;

  const pocketingCount = jobs.filter(
    (j) =>
      j.status === "completed" &&
      !j.sales_order_id &&
      !j.intercompany_transaction_id,
  ).length;

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }
  if (isError) return <ErrorState />;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            className={`pill-btn ${!statusFilter ? "active" : ""}`}
            onClick={() => setStatusFilter("")}
          >
            All ({data?.meta?.total ?? 0})
          </button>
          {BOARD_COLUMNS.map((s) => {
            const m = JOB_STATUS_META[s];
            const count = jobs.filter((j) => j.status === s).length;
            return (
              <button
                key={s}
                type="button"
                className={`pill-btn ${statusFilter === s ? "active" : ""}`}
                onClick={() => setStatusFilter(statusFilter === s ? "" : s)}
              >
                {m.label} ({count})
              </button>
            );
          })}
          {pocketingCount > 0 && (
            <span className="text-xs font-semibold text-danger border border-danger/40 rounded-full px-3 py-1">
              ⚠ {pocketingCount} completed with no sale
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={tagQuery}
            onChange={(e) => setTagQuery(e.target.value)}
            placeholder="Tag, customer, order…"
            className="input w-44 text-sm"
            aria-label="Search by tag code, customer, or order number"
          />
          {canCreate && (
            <Button onClick={() => setShowCreate(true)}>+ New Job</Button>
          )}
        </div>
      </div>

      {/* Board */}
      {jobs.length === 0 ? (
        <EmptyState
          icon={<span className="text-3xl">📋</span>}
          title="No service jobs"
          message={
            tagQueryTrimmed
              ? `No job matches "${tagQueryTrimmed}"`
              : statusFilter
                ? `No jobs with status "${statusFilter}"`
                : "Create your first job above"
          }
          action={
            canCreate ? (
              <Button size="sm" onClick={() => setShowCreate(true)}>
                New Job
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {(statusFilter ? [statusFilter as JobStatus] : BOARD_COLUMNS).map(
            (col) => {
              const m = JOB_STATUS_META[col];
              const colJobs = jobs.filter((j) => j.status === col);
              return (
                <div key={col} className="space-y-2">
                  <div className="flex items-center gap-2 mb-2">
                    <Pill tone={m.tone}>{m.label}</Pill>
                    <span className="text-xs text-text-muted">{colJobs.length}</span>
                  </div>
                  {colJobs.length === 0 ? (
                    <div className="text-xs text-text-muted text-center py-6 border border-dashed border-line rounded-lg">
                      Empty
                    </div>
                  ) : (
                    colJobs.map((job) => (
                      <JobCard
                        key={job.job_id}
                        job={job}
                        serviceTypes={serviceTypes}
                        onClick={() => setDetailJobId(job.job_id)}
                      />
                    ))
                  )}
                </div>
              );
            },
          )}
        </div>
      )}

      {detailJobId && (
        <JobDetailDrawer
          jobId={detailJobId}
          serviceTypes={serviceTypes}
          onClose={() => setDetailJobId(null)}
        />
      )}

      {showCreate && (
        <CreateJobDrawer
          serviceTypes={serviceTypes}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
