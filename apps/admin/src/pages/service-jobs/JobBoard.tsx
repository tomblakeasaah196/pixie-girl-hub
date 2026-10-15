import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Package,
  PackageSearch,
  BellRing,
  UserCheck,
  UserPlus,
  User,
  Copy,
  Check,
  Clock,
  AlertTriangle,
  ShieldAlert,
  Trophy,
  Sparkles,
  Maximize2,
  RotateCcw,
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
import { Lightbox } from "@/components/ui/Lightbox";
import { Select } from "@/components/ui/controls";
import { ErrorState } from "@/components/ui/controls";
import { TextInput } from "@/components/ui/Form";
import { useAuthStore } from "@/stores/auth";
import { ApiError } from "@/lib/api";
import type {
  ServiceJob,
  ServiceType,
  JobStatus,
  JobReference,
  RevenueKind,
} from "./types";

/**
 * A stylist may open a deep link (from an old push, an email, or a bookmark)
 * to a job that Ops has since reassigned to someone else. The backend now
 * responds with a 403 whose `error.reassigned` payload names the current
 * assignee, so we can show a friendly hand-off card instead of a bare
 * "permission denied" wall. This pulls the payload out of the ApiError.
 */
function extractReassigned(err: unknown): {
  to_name: string | null;
  job_number: string | null;
} | null {
  if (!(err instanceof ApiError)) return null;
  if (err.status !== 403) return null;
  const body = err.body as {
    error?: {
      code?: string;
      reassigned?: { to_name?: string | null; job_number?: string | null };
    };
  } | null;
  const r = body?.error?.reassigned;
  if (body?.error?.code !== "NO_LONGER_ASSIGNED" || !r) return null;
  return { to_name: r.to_name ?? null, job_number: r.job_number ?? null };
}
/**
 * A refusal that carries its own fix — {label, url} on the error body. Used by
 * WIG_NOT_IN_STOCK so "this hair isn't in stock" is a door into Stock →
 * Reception rather than a dead end: receiving the hair is the only real
 * resolution, and no acknowledgement tick can substitute for it.
 */
function extractResolveAction(
  err: unknown,
): { label: string; url: string } | null {
  if (!(err instanceof ApiError)) return null;
  const body = err.body as {
    error?: { resolve_action?: { label?: string; url?: string } };
  } | null;
  const a = body?.error?.resolve_action;
  if (!a?.url || !a?.label) return null;
  return { label: a.label, url: a.url };
}

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
  useSummarizeJob,
  useStylistScorecard,
  useStudioLifecycle,
  useUnbilledMutations,
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

// ── Deadline helpers (assign-time due date) ────────────────
// `datetime-local` inputs speak local wall-clock, not ISO/UTC, so we convert
// on the way in and out. Empty string ⇢ no value (input renders blank).

/** ISO/UTC string → `YYYY-MM-DDTHH:mm` in the viewer's local time. */
function toDatetimeLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The default deadline: 48 hours from now, as a `datetime-local` value. */
function plus48hLocalInput(): string {
  return toDatetimeLocalInput(
    new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  );
}

/** `datetime-local` value → ISO string (or undefined when blank). */
function localInputToIso(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

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
          <Button
            variant="ghost"
            onClick={copy}
            icon={<Copy className="w-3.5 h-3.5" />}
          >
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
  // No longer gated on `completed`: waiting until the work is finished meant
  // the first anyone heard of an unbilled job was after the hair went back to
  // the customer. Internal jobs (shoot/sample/staff) never owe a sale, so
  // flagging them is what made the old warning safe to ignore.
  const isPocketing =
    !job.sales_order_id &&
    !job.intercompany_transaction_id &&
    job.revenue_kind !== "internal" &&
    job.status !== "cancelled" &&
    job.status !== "rejected";

  return (
    <button
      type="button"
      onClick={onClick}
      className="glass w-full text-left p-3 rounded-lg border border-line hover:border-accent/40 transition-colors space-y-1.5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-text-muted">
          {job.job_number}
        </span>
        {isPocketing && (
          <span
            className="text-danger text-xs font-semibold"
            title={
              job.sale_requested_at
                ? "No sale yet — Sales has been notified"
                : "No sale behind this job"
            }
          >
            {job.sale_requested_at ? "⏳ Sale asked" : "⚠ No Sale"}
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
      {/* Who it's for + what's being styled — so the floor reads the card
          without opening the drawer. */}
      {(job.customer_name || job.styled_product_name) && (
        <div className="space-y-0.5">
          {job.customer_name && (
            <p className="text-xs text-text-primary/90 truncate">
              {job.customer_name}
            </p>
          )}
          {job.styled_product_name && (
            <p className="text-[11px] text-text-muted truncate">
              {job.styled_product_name}
            </p>
          )}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <span>{icon}</span>
        <span className="text-sm font-medium truncate">
          {st?.display_name ?? job.service_type_id}
        </span>
      </div>
      {job.hair_description && (
        <p className="text-xs text-text-muted truncate">
          {job.hair_description}
        </p>
      )}
      {((job as any).order_specific_instructions ||
        (job.specification as any)?.order_specific_instructions) && (
        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 border border-amber-500/20">
          📝 Specific instructions
        </span>
      )}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <span
          className="text-xs text-text-muted truncate min-w-0"
          title={
            job.assigned_staff_user_id
              ? (job.assigned_staff_name ?? "Staff assigned")
              : undefined
          }
        >
          {job.assigned_staff_user_id
            ? (job.assigned_staff_name ?? "Staff assigned")
            : job.assigned_stylist_id
              ? "Stylist assigned"
              : "Unassigned"}
        </span>
        {job.scheduled_for && (
          <span className="text-xs font-mono text-text-muted shrink-0">
            {formatDate(job.scheduled_for)}
          </span>
        )}
      </div>
      {job.quality_rating !== null && <StarRating value={job.quality_rating} />}
      {job.customer_rating !== null && (
        <div
          className="text-sm"
          title={`Customer: ${RATING_LABELS[job.customer_rating]}`}
        >
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
            }
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore=""
            data-form-type="other"
          />
          <input
            className="input"
            placeholder="Brand"
            value={form.chemical_brand}
            onChange={(e) =>
              setForm((f) => ({ ...f, chemical_brand: e.target.value }))
            }
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore=""
            data-form-type="other"
          />
          <input
            className="input"
            placeholder="Notes"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore=""
            data-form-type="other"
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
            }
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore=""
            data-form-type="other"
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
            }
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore=""
            data-form-type="other"
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
            {ing.brand && (
              <span className="text-text-muted">({ing.brand})</span>
            )}
            {(ing.qty_ml || ing.qty_g) && (
              <span className="font-mono ml-auto">
                {ing.qty_ml ? `${ing.qty_ml} ml` : `${ing.qty_g} g`}
              </span>
            )}
            {ing.role && (
              <span className="text-text-muted italic">{ing.role}</span>
            )}
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
              onChange={(e) => setIcId(e.target.value)}
              autoComplete="off"
              data-lpignore="true"
              data-1p-ignore=""
              data-form-type="other"
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
// ── Burnout guardrail ──────────────────────────────────────
// A stylist holding more than this share of the whole bench's open workload is
// flagged light-red in the assignment picker so work gets spread out; at or
// under it they read green (safe to load). Share = the stylist's open jobs ÷ the
// team's total open jobs, so an idle stylist is 0% (green) and an obvious pick.
const BURNOUT_THRESHOLD_PCT = 30;

function workloadPct(openJobs: number, teamOpenJobs: number): number {
  if (teamOpenJobs <= 0) return 0;
  return Math.round((openJobs / teamOpenJobs) * 100);
}

function WorkloadPill({
  openJobs,
  teamOpenJobs,
}: {
  openJobs: number;
  teamOpenJobs: number;
}) {
  const pct = workloadPct(openJobs, teamOpenJobs);
  const burnout = pct > BURNOUT_THRESHOLD_PCT;
  return (
    <span
      className="shrink-0"
      title={
        burnout
          ? `${pct}% of the team's open workload — over ${BURNOUT_THRESHOLD_PCT}%, risk of burnout`
          : `${pct}% of the team's open workload — healthy`
      }
    >
      <Pill tone={burnout ? "danger" : "success"}>{pct}%</Pill>
    </span>
  );
}

// Confirmation gate before an assignment lands — "never make a mistake". Shows
// the job + stylist to review, and warns that reversing needs CEO approval.
//
// A job with NO sales order behind it gets a second, sterner gate. The sale is
// the only thing that draws stock, so an unlinked job moves no stock at all and
// nothing downstream ever reconciles it against a sale — the assigner has to
// tick the acknowledgement before Confirm unlocks, and the API rejects the
// assignment without it.
function AssignConfirmModal({
  job,
  stylistName,
  dueLabel,
  onConfirm,
  onCancel,
  pending,
  error,
  rawError,
}: {
  job: ServiceJob;
  stylistName: string;
  // The deadline about to be stamped (formatted), so it's reviewed before it
  // commits — this is what lands on the stylist's My Day.
  dueLabel?: string | null;
  onConfirm: (ack: {
    acknowledgeUnlinked: boolean;
    acknowledgeTransfer: boolean;
  }) => void;
  onCancel: () => void;
  pending: boolean;
  error?: string | null;
  /** Raw error, so a refusal carrying a resolve_action can offer it. */
  rawError?: unknown;
}) {
  const navigate = useNavigate();
  const resolve = extractResolveAction(rawError);
  const label = job.styled_product_name || job.service_type_name || "this job";
  const unlinked = !job.sales_order_id;
  const [acknowledged, setAcknowledged] = useState(false);
  // The wig is physically with someone else. This is no longer a refusal: with
  // the tick below the API returns the unit off the current holder and pushes
  // it straight to the new stylist in one move.
  const currentHolder =
    job.assigned_staff_name || job.last_custody_holder_name || null;
  const transferring = Boolean(job.assigned_staff_user_id);
  const [transferAck, setTransferAck] = useState(false);
  return (
    <Modal
      open
      onClose={onCancel}
      title="Confirm assignment"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onConfirm({
                acknowledgeUnlinked: unlinked && acknowledged,
                acknowledgeTransfer: transferring && transferAck,
              })
            }
            disabled={
              pending ||
              (unlinked && !acknowledged) ||
              (transferring && !transferAck)
            }
            icon={<UserCheck className="w-3.5 h-3.5" />}
          >
            {pending
              ? transferring
                ? "Transferring…"
                : "Assigning…"
              : transferring
                ? "Confirm transfer"
                : "Confirm"}
          </Button>
        </>
      }
    >
      <div className="space-y-3 py-1">
        <p className="text-sm leading-relaxed">
          Assign <span className="font-semibold">{job.job_number}</span> —{" "}
          <span className="font-semibold">{label}</span> to{" "}
          <span className="font-semibold text-accent-glow">{stylistName}</span>?
        </p>
        {dueLabel && (
          <p className="text-[12px] text-text-muted">
            Due{" "}
            <span className="font-semibold text-text-primary">{dueLabel}</span>{" "}
            · shows on their My Day.
          </p>
        )}
        <div className="glass rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
          <p className="text-[11px] text-text-muted leading-snug">
            Review this before confirming. To reverse it you&rsquo;ll need
            approval from hierarchy — only a CEO can revert an assignment.
          </p>
        </div>

        {transferring && (
          <div className="rounded-lg p-3.5 border border-warn/40 bg-warn/[0.07] space-y-2.5">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-warn shrink-0" />
              <span className="text-[12px] font-bold uppercase tracking-wide text-warn">
                Custody transfer
              </span>
            </div>
            <p className="text-[12px] text-text-secondary leading-relaxed">
              This wig is currently with{" "}
              <span className="font-semibold text-text-primary">
                {currentHolder || "another stylist"}
              </span>
              . Confirming moves <span className="font-semibold">1 unit</span>{" "}
              of stock{" "}
              {job.tag_code ? (
                <>
                  (tag <span className="font-semibold">{job.tag_code}</span>
                  ){" "}
                </>
              ) : null}
              straight to{" "}
              <span className="font-semibold text-accent-glow">
                {stylistName}
              </span>{" "}
              — no physical return to the desk is needed. The custody ledger is
              balanced automatically and{" "}
              {currentHolder || "the previous stylist"} is notified that they
              are no longer accountable for it.
            </p>
            <label className="flex items-start gap-2.5 cursor-pointer pt-0.5">
              <input
                type="checkbox"
                checked={transferAck}
                onChange={(e) => setTransferAck(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-[rgb(var(--warn))] cursor-pointer"
              />
              <span className="text-[12px] text-text-primary font-medium leading-snug">
                I confirm the hair is being handed over, and {stylistName} is
                now accountable for it.
              </span>
            </label>
          </div>
        )}

        {unlinked && (
          <div className="rounded-lg p-3.5 border border-danger/40 bg-danger/[0.07] space-y-2.5">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-danger shrink-0" />
              <span className="text-[12px] font-bold uppercase tracking-wide text-danger">
                No sale behind this job
              </span>
            </div>
            <p className="text-[12px] text-text-secondary leading-relaxed">
              This job has <span className="font-semibold">no sales order</span>
              , so{" "}
              <span className="font-semibold">no stock will be deducted</span> —
              the hair leaves the shelf physically but the count stays where it
              is, and nothing will ever reconcile it against a sale.
            </p>
            <p className="text-[12px] text-text-secondary leading-relaxed">
              If this hair was sold, cancel and raise the order first. If it is
              a sample, rework or shoot, correct the count afterwards through{" "}
              <span className="font-semibold">Stock → Adjustments</span>.
            </p>
            <label className="flex items-start gap-2.5 cursor-pointer pt-0.5">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-[rgb(var(--danger))] cursor-pointer"
              />
              <span className="text-[12px] text-text-primary font-medium leading-snug">
                I understand no stock will move, and I am accountable for this
                hair leaving without a sale.
              </span>
            </label>
          </div>
        )}
        {error && (
          <div className="space-y-2">
            <p className="text-xs text-danger">{error}</p>
            {/* The block is a door. Receiving the hair is the only real fix, so
                offer exactly that rather than leaving "try again" as the only
                thing on screen — which is what this modal used to do. */}
            {resolve && (
              <Button
                size="sm"
                variant="secondary"
                icon={<PackageSearch className="w-3.5 h-3.5" />}
                onClick={() => navigate(resolve.url)}
              >
                {resolve.label}
              </Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// CEO-only override to pull a just-assigned job back to Unassigned.
function RevertConfirmModal({
  job,
  stylistName,
  onConfirm,
  onCancel,
  pending,
  error,
}: {
  job: ServiceJob;
  stylistName: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending: boolean;
  error?: string | null;
}) {
  return (
    <Modal
      open
      onClose={onCancel}
      title="Revert to unassigned"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            disabled={pending}
            icon={<RotateCcw className="w-3.5 h-3.5" />}
          >
            {pending ? "Reverting…" : "Revert to unassigned"}
          </Button>
        </>
      }
    >
      <div className="space-y-3 py-1">
        <p className="text-sm leading-relaxed">
          Take <span className="font-semibold">{job.job_number}</span> back from{" "}
          <span className="font-semibold">{stylistName}</span> and return it to
          the Unassigned queue?
        </p>
        <div className="glass rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
          <p className="text-[11px] text-text-muted leading-snug">
            CEO-only override. The reserved wig is returned to custody and the
            job drops back to Pending. Only possible before the stylist has
            started work.
          </p>
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

function AssignmentPanel({ job, jobId }: { job: ServiceJob; jobId: string }) {
  const [picking, setPicking] = useState(false);
  const [confirmTag, setConfirmTag] = useState<string | null>(null);
  const assigned = !!job.assigned_staff_user_id;
  // Terminal jobs are history, not work to hand out — never open the picker on
  // them, and always name whoever had the hair (see HistoricAssignee below).
  const terminal = job.status === "cancelled" || job.status === "completed";
  const showPicker = !assigned && !terminal ? true : picking;
  // Who had it, when the live assignment fields are blank. The custody ledger
  // keeps this after a cancel/unassign, which is exactly the case where the
  // drawer used to show nothing and Ops couldn't tell who was holding the wig.
  const historicName =
    job.assigned_staff_name ??
    job.assigned_stylist_name ??
    job.last_custody_holder_name ??
    null;

  return (
    <div className="border-t border-line pt-4 space-y-2">
      <p className="text-xs text-text-muted uppercase tracking-wide font-semibold">
        Assignment
      </p>
      {assigned && !picking && (
        <AssignedRow job={job} onChange={() => setPicking(true)} />
      )}
      {!assigned && historicName && (
        <HistoricAssignee name={historicName} status={job.status} />
      )}
      {!assigned && !historicName && terminal && (
        <p className="text-[12px] text-text-muted">
          No stylist was ever assigned to this job.
        </p>
      )}
      {showPicker && (
        <StylistPicker
          job={job}
          jobId={jobId}
          currentUserId={job.assigned_staff_user_id}
          defaultDue={job.expected_completion_at}
          onDone={() => setPicking(false)}
          onAssigned={(assignedJob) => {
            if (assignedJob.is_new_tag && assignedJob.tag_code)
              setConfirmTag(assignedJob.tag_code);
          }}
        />
      )}
      {confirmTag && (
        <TagConfirmModal
          code={confirmTag}
          onClose={() => setConfirmTag(null)}
        />
      )}
    </div>
  );
}

/** Read-only "who had this" row for jobs with no LIVE assignee — cancelled,
 *  completed, or reverted to pending. Names the person from the server-side
 *  join / custody ledger so the trail never goes cold. */
function HistoricAssignee({
  name,
  status,
}: {
  name: string;
  status: JobStatus;
}) {
  const label =
    status === "cancelled"
      ? "Was assigned to (job cancelled)"
      : status === "completed"
        ? "Completed by"
        : "Previously with";
  return (
    <div className="glass p-3 rounded-lg flex items-center gap-3">
      <div className="w-9 h-9 rounded-full bg-accent/[0.12] grid place-items-center shrink-0">
        <UserCheck className="w-4 h-4 text-accent-glow" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate">{name}</div>
        <div className="text-[11px] text-text-muted truncate">{label}</div>
      </div>
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
  const navigate = useNavigate();
  const isCeo = useAuthStore((s) => s.user?.isCeo ?? false);
  const { unassign } = useJobActions(job.job_id);
  const [reverting, setReverting] = useState(false);
  const { data: stylists = [] } = useAssignableStylists(true);
  const current = stylists.find(
    (s) => s.user_id === job.assigned_staff_user_id,
  );
  const teamOpenJobs = stylists.reduce((sum, s) => sum + s.open_jobs_count, 0);
  // The CEO can revert only while the job is still just 'assigned' (not started).
  const canRevert = isCeo && job.status === "assigned";
  return (
    <>
      <div className="glass p-3 rounded-lg flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-accent/[0.12] grid place-items-center overflow-hidden shrink-0">
          {current?.avatar_url ? (
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
            {/* Fall back to the server-joined name: `current` only resolves for
                people still on the ASSIGNABLE roster, so a stylist who left,
                was deactivated or is off-roster showed as "Assigned stylist". */}
            {current?.full_name ??
              job.assigned_staff_name ??
              job.assigned_stylist_name ??
              "Assigned stylist"}
          </div>
          <div className="text-[11px] text-text-muted truncate flex items-center gap-1.5">
            <span>{current?.job_title ?? "Stylist"}</span>
            {current && (
              <span>
                · {current.open_jobs_count} open job
                {current.open_jobs_count === 1 ? "" : "s"} right now
              </span>
            )}
            {current?.on_leave_today && <Pill tone="warn">On leave today</Pill>}
          </div>
        </div>
        {current && (
          <WorkloadPill
            openJobs={current.open_jobs_count}
            teamOpenJobs={teamOpenJobs}
          />
        )}
        {job.assigned_staff_user_id && (
          <Button
            variant="ghost"
            size="sm"
            icon={<Trophy className="w-3.5 h-3.5" />}
            onClick={() =>
              navigate(
                `/service-jobs?tab=scorecards&stylist=${job.assigned_staff_user_id}`,
              )
            }
          >
            Scorecard
          </Button>
        )}
        {canRevert && (
          <Button
            variant="ghost"
            size="sm"
            icon={<RotateCcw className="w-3.5 h-3.5" />}
            onClick={() => setReverting(true)}
          >
            Revert
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onChange}>
          Change
        </Button>
      </div>
      {reverting && (
        <RevertConfirmModal
          job={job}
          stylistName={current?.full_name ?? "this stylist"}
          pending={unassign.isPending}
          error={
            unassign.isError
              ? ((unassign.error as Error)?.message ??
                "Could not revert — try again.")
              : null
          }
          onCancel={() => {
            unassign.reset();
            setReverting(false);
          }}
          onConfirm={() =>
            unassign.mutate(undefined, {
              onSuccess: () => setReverting(false),
            })
          }
        />
      )}
    </>
  );
}

function StylistPicker({
  job,
  jobId,
  currentUserId,
  defaultDue,
  onDone,
  onAssigned,
}: {
  job: ServiceJob;
  jobId: string;
  currentUserId: string | null;
  // The job's existing promised date, if any. Pre-fills the deadline field;
  // when absent the field defaults to 48 hours from now.
  defaultDue?: string | null;
  onDone: () => void;
  onAssigned?: (job: ServiceJob) => void;
}) {
  const { assign } = useJobActions(jobId);
  const { data: stylists = [], isLoading } = useAssignableStylists(true);
  const teamOpenJobs = stylists.reduce((sum, s) => sum + s.open_jobs_count, 0);
  // Deadline captured at the assigning level. Defaults to the job's promised
  // date if it already has one, otherwise +48h — so every assigned job lands on
  // the stylist's My Day with a clock, and the SLA scorecards have a target.
  const [due, setDue] = useState<string>(
    () => toDatetimeLocalInput(defaultDue) || plus48hLocalInput(),
  );
  // Stylist awaiting confirmation — clicking a row opens the confirm modal
  // rather than assigning straight away, so a misclick can never commit.
  const [pending, setPending] = useState<(typeof stylists)[number] | null>(
    null,
  );

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
      {/* Deadline set at the assigning level — defaults to 48h, editable. It
          becomes the job's due date and lands on the stylist's My Day. */}
      <div className="px-1.5 pt-1 pb-2 border-b border-line/60 mb-1">
        <label className="block text-[10.5px] text-text-muted uppercase tracking-wide font-semibold mb-1">
          Due date
        </label>
        <TextInput
          type="datetime-local"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="h-9 text-[13px]"
        />
        <p className="text-[10.5px] text-text-muted mt-1 leading-snug">
          Defaults to 48 hours from now. This is the deadline the stylist sees
          on their My&nbsp;Day.
        </p>
      </div>
      <p className="text-[10.5px] text-text-muted px-1.5 pt-0.5 pb-1 leading-snug">
        Load = each stylist&rsquo;s share of the{" "}
        {teamOpenJobs > 0 ? `${teamOpenJobs} ` : ""}open job
        {teamOpenJobs === 1 ? "" : "s"} across the bench. Green is safe to
        assign; light red is over {BURNOUT_THRESHOLD_PCT}% — spread the work to
        avoid burnout.
      </p>
      {stylists.map((s) => {
        const isCurrent = s.user_id === currentUserId;
        const disabled = s.on_leave_today || assign.isPending;
        return (
          <button
            key={s.user_id}
            type="button"
            disabled={disabled}
            onClick={() => setPending(s)}
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
            <WorkloadPill
              openJobs={s.open_jobs_count}
              teamOpenJobs={teamOpenJobs}
            />
            {!isCurrent && !disabled && (
              <UserPlus className="w-4 h-4 text-text-muted shrink-0" />
            )}
          </button>
        );
      })}
      {pending && (
        <AssignConfirmModal
          job={job}
          stylistName={pending.full_name}
          dueLabel={due ? formatDateTime(localInputToIso(due) ?? due) : null}
          pending={assign.isPending}
          error={
            assign.isError
              ? ((assign.error as Error)?.message ??
                "Could not assign — try again.")
              : null
          }
          rawError={assign.isError ? assign.error : null}
          onCancel={() => {
            assign.reset();
            setPending(null);
          }}
          onConfirm={({ acknowledgeUnlinked, acknowledgeTransfer }) =>
            assign.mutate(
              {
                userId: pending.user_id,
                expected_completion_at: localInputToIso(due),
                acknowledge_unlinked: acknowledgeUnlinked,
                acknowledge_transfer: acknowledgeTransfer,
              },
              {
                onSuccess: (assignedJob) => {
                  onAssigned?.(assignedJob);
                  setPending(null);
                  onDone();
                },
              },
            )
          }
        />
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
function ReferenceLine({ r }: { r: JobReference }) {
  return (
    <div className="flex items-start gap-2 text-sm">
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
  );
}

function JobReferencesBrief({ jobId }: { jobId: string }) {
  const { data: refs = [] } = useJobReferences(jobId);
  const brief = refs.filter((r) => r.is_locked);
  const notes = refs.filter((r) => !r.is_locked);
  if (refs.length === 0) return null;
  return (
    <div className="space-y-3">
      {brief.length > 0 && (
        <div className="rounded-lg border border-accent/20 bg-accent/5 p-3 space-y-2">
          <div className="text-xs text-accent-glow font-semibold">
            Style brief — what the customer asked for
          </div>
          {brief.map((r) => (
            <ReferenceLine key={r.reference_id} r={r} />
          ))}
        </div>
      )}
      {notes.length > 0 && (
        <div className="rounded-lg border border-line p-3 space-y-2">
          <div className="text-xs text-text-muted font-semibold uppercase tracking-wide">
            Stylist / QC notes
          </div>
          {notes.map((r) => (
            <ReferenceLine key={r.reference_id} r={r} />
          ))}
        </div>
      )}
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
            <Pill
              key={m.material_id}
              tone={m.kind === "chemical" ? "info" : "accent"}
            >
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
              Materials cost is best-effort — priced from stock at the time it
              was deducted, where deducted from tracked stock.
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
  if (isLoading) return <Skeleton className="h-24" />;
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

// ── AI job summary — one click, never blocks on an AI vendor being
// configured (server falls back to a deterministic template). ───
function AiSummaryBox({ jobId }: { jobId: string }) {
  const { mutate, data, isPending, isError } = useSummarizeJob(jobId);
  return (
    <div className="rounded-lg border border-accent/20 bg-accent/5 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-accent-glow font-semibold flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" /> AI summary
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={() => mutate()}
        >
          {isPending ? "Thinking…" : data ? "Refresh" : "Summarize"}
        </Button>
      </div>
      {data && <p className="text-sm text-text-primary">{data.summary}</p>}
      {isError && (
        <p className="text-xs text-danger">
          Couldn't generate a summary — try again.
        </p>
      )}
    </div>
  );
}

// Compares a single job's quality rating to the assigned stylist's own
// average — "is this better or worse than their usual work?"
function RatingComparisonBadge({
  stylistId,
  jobRating,
}: {
  stylistId: string | null;
  jobRating: number | null;
}) {
  const { data } = useStylistScorecard(stylistId);
  if (!jobRating || !data?.avg_quality_rating) return null;
  const avg = parseFloat(data.avg_quality_rating);
  const diff = jobRating - avg;
  if (Math.abs(diff) < 0.5) {
    return (
      <p className="text-[11px] text-text-muted">
        In line with their average ({avg})
      </p>
    );
  }
  return (
    <p className={`text-[11px] ${diff > 0 ? "text-success" : "text-warn"}`}>
      {diff > 0 ? "Above" : "Below"} their average of {avg}
    </p>
  );
}

// ── Job detail drawer ──────────────────────────────────────

// Suggested filename when a stylist downloads the style photo from the
// lightbox — keeps the real extension from the URL so the file opens
// correctly once saved.
function photoDownloadName(job: ServiceJob): string {
  const base =
    [job.job_number, job.styled_product_name].filter(Boolean).join(" - ") ||
    "style-photo";
  const ext = job.styled_product_image_url?.match(
    /\.(jpe?g|png|webp|gif|avif)(?=$|\?)/i,
  )?.[1];
  return ext ? `${base}.${ext.toLowerCase()}` : base;
}

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
  const { data: job, isLoading, error } = useJob(jobId);
  const actions = useJobActions(jobId);
  const lifecycle = useStudioLifecycle(jobId);
  const canEdit = useAuthStore((s) => s.can)("service_jobs", "edit");
  const { requestSale } = useUnbilledMutations();
  const [tab, setTab] = useState<
    "details" | "chemicals" | "outcome" | "activity"
  >("details");
  const [costInput, setCostInput] = useState("");
  const [photoOpen, setPhotoOpen] = useState(false);

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

  // Reassignment banner — a stylist who is no longer this job's owner opens
  // an old notification link and lands here. Backend returns a rich 403 with
  // the current assignee's name (see service.getJob NO_LONGER_ASSIGNED); we
  // render it as an explanation + a link back to their own queue rather than
  // a bare error state.
  const reassigned = extractReassigned(error);
  if (reassigned) {
    return (
      <Drawer open onClose={onClose} title="Job reassigned">
        <div className="space-y-4 p-1">
          <div className="rounded-[14px] border border-warn/40 bg-warn/5 p-4 space-y-2">
            <p className="text-sm">
              You no longer have access to this job — it has been reassigned
              {reassigned.to_name ? (
                <>
                  {" "}
                  to <strong>{reassigned.to_name}</strong>
                </>
              ) : null}
              .
            </p>
            {reassigned.job_number && (
              <p className="text-xs text-text-muted font-mono">
                Job #{reassigned.job_number}
              </p>
            )}
          </div>
          <Button
            variant="primary"
            onClick={() => {
              onClose();
              navigate("/service-jobs?tab=my");
            }}
          >
            Back to my jobs
          </Button>
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
  // Same rule as the card: flag at every stage, and never for internal work.
  const isPocketing =
    !job.sales_order_id &&
    !job.intercompany_transaction_id &&
    job.revenue_kind !== "internal" &&
    job.status !== "cancelled" &&
    job.status !== "rejected";

  return (
    <Drawer
      open
      // Both the Drawer and the photo Lightbox listen for Esc on document —
      // while the lightbox is on top, Esc should close only the lightbox.
      onClose={() => {
        if (!photoOpen) onClose();
      }}
      title={job.job_number}
    >
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <Pill tone={meta.tone}>{meta.label}</Pill>
          {st && (
            <span className="text-sm">
              {SERVICE_KEY_ICON[st.service_key] ?? "🔧"} {st.display_name}
            </span>
          )}
          {/* Not a label any more — the thing you press. A passive warning is
              how FLH-JOB-0035 reached `completed` with an unbilled styling fee:
              it told you something was wrong and gave you nowhere to go. */}
          {isPocketing &&
            (job.sale_requested_at ? (
              <span
                className="text-xs font-semibold text-warn border border-warn/40 rounded px-2 py-0.5"
                title={
                  job.sale_requested_by_name
                    ? `Requested by ${job.sale_requested_by_name}`
                    : undefined
                }
              >
                ⏳ Sales notified
              </span>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                disabled={!canEdit || requestSale.isPending}
                icon={<BellRing className="w-3.5 h-3.5" />}
                onClick={() => requestSale.mutate(job.job_id)}
                title="Ask whoever can raise a sale to raise this one"
              >
                {requestSale.isPending
                  ? "Notifying…"
                  : "No sale — notify Sales"}
              </Button>
            ))}
          {job.sales_order_id && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Package className="w-3.5 h-3.5" />}
              onClick={() => navigate(`/sales/orders/${job.sales_order_id}`)}
            >
              {job.sales_order_number ?? "View order"}
            </Button>
          )}
        </div>

        {/* Identity strip — always visible regardless of tab. The photo is
            what the stylist actually works from, so it gets real estate:
            224px (4× the old thumbnail), click for the full-screen lightbox
            with download. Stacks above the text until the drawer widens at
            lg; the no-photo placeholder keeps the old compact row. */}
        {(job.styled_product_name ||
          job.base_product_name ||
          job.customer_name) && (
          <div
            className={
              job.styled_product_image_url
                ? "glass rounded-lg p-3 flex flex-col lg:flex-row lg:items-center gap-3"
                : "glass rounded-lg p-3 flex items-center gap-3"
            }
          >
            {job.styled_product_image_url ? (
              <button
                type="button"
                onClick={() => setPhotoOpen(true)}
                aria-label="View style photo full screen"
                title="View full screen"
                className="group relative w-56 h-56 max-w-full rounded-lg bg-accent/[0.08] overflow-hidden shrink-0 cursor-zoom-in"
              >
                <img
                  src={job.styled_product_image_url}
                  alt={job.styled_product_name ?? "Styled product"}
                  className="w-full h-full object-cover"
                />
                <span className="absolute inset-0 grid place-items-center bg-black/0 group-hover:bg-black/30 group-focus-visible:bg-black/30 transition-colors">
                  <Maximize2 className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity" />
                </span>
              </button>
            ) : (
              <div className="w-14 h-14 rounded-lg bg-accent/[0.08] grid place-items-center overflow-hidden shrink-0">
                <Package className="w-5 h-5 text-text-muted" />
              </div>
            )}
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
            {/* Specific instructions — from the linked sales order, read-only */}
            {((job as any).order_specific_instructions ||
              (job.specification as any)?.order_specific_instructions) && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                    Specific Instructions
                  </span>
                  {job.sales_order_number && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300">
                      Order {job.sales_order_number}
                    </span>
                  )}
                  {(job.specification as any)
                    ?.order_specific_instructions_updated_at && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-line text-text-muted">
                      edited
                    </span>
                  )}
                </div>
                <p className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">
                  {(job as any).order_specific_instructions ||
                    (job.specification as any)?.order_specific_instructions}
                </p>
                <p className="text-[10px] text-text-muted">
                  Visible to all stylists — managed in Sales → Order detail.
                </p>
              </div>
            )}
            <AiSummaryBox jobId={jobId} />

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
                  <RatingComparisonBadge
                    stylistId={job.assigned_staff_user_id}
                    jobRating={job.quality_rating}
                  />
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
                  Styling{" "}
                  <span className="text-accent-glow font-semibold">
                    included
                  </span>{" "}
                  in{" "}
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
              // 'qc_passed'/'rework' need a quality rating + notes, which a
              // bare button can't capture — that's the QC Queue tab's job,
              // and it already does it correctly (life.qc.mutate with a
              // result + form). Every OTHER Stylist Studio lifecycle status
              // needs its own dedicated endpoint (custody/time-session side
              // effects the generic /advance route knows nothing about);
              // only 'cancelled'/'completed' are safe to send there directly.
              // Once the wig is returned for QC, the job advances through
              // the QC Queue tab (pass → auto-completed, fail → rework).
              const needsQcForm = job.status === "returned_for_qc";
              const buttons = nextStates.filter((s) => s !== "assigned");
              const anyPending =
                actions.advance.isPending ||
                lifecycle.start.isPending ||
                lifecycle.pause.isPending ||
                lifecycle.resume.isPending ||
                lifecycle.returnForQc.isPending;
              const runAdvance = (s: JobStatus) => {
                if (s === "in_progress") {
                  if (job.status === "on_hold") lifecycle.resume.mutate();
                  else lifecycle.start.mutate();
                } else if (s === "on_hold") {
                  lifecycle.pause.mutate();
                } else if (s === "returned_for_qc") {
                  lifecycle.returnForQc.mutate();
                } else {
                  actions.advance.mutate({
                    status: s,
                    actual_cost_ngn:
                      s === "completed" && costInput
                        ? parseFloat(costInput)
                        : undefined,
                  });
                }
              };
              if (buttons.length === 0 && !needsQcForm) return null;
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
                      onChange={(e) => setCostInput(e.target.value)}
                      autoComplete="off"
                      data-lpignore="true"
                      data-1p-ignore=""
                      data-form-type="other"
                    />
                  )}
                  <div className="flex flex-wrap gap-2">
                    {buttons.map((s) => {
                      const m = JOB_STATUS_META[s];
                      return (
                        <Button
                          key={s}
                          variant="secondary"
                          disabled={anyPending}
                          onClick={() => runAdvance(s)}
                        >
                          → {m.label}
                        </Button>
                      );
                    })}
                  </div>
                  {needsQcForm && (
                    <p className="text-xs text-text-muted">
                      Pass or send to rework from the QC Queue tab. A pass
                      completes the job and hands the wig to Logistics.
                    </p>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {tab === "chemicals" && <ChemicalsTab jobId={jobId} />}
        {tab === "outcome" && <OutcomeTab job={job} jobId={jobId} />}
        {tab === "activity" && <ActivityTab jobId={jobId} />}

        {photoOpen && job.styled_product_image_url && (
          <Lightbox
            url={job.styled_product_image_url}
            name={photoDownloadName(job)}
            onClose={() => setPhotoOpen(false)}
          />
        )}
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
    // No default. A job opened by hand has no sale behind it, and the whole
    // point is that someone SAYS which kind it is — pre-selecting "customer
    // work" would just make the commonest wrong answer the silent one.
    revenue_kind: "" as RevenueKind | "",
    internal_reason: "",
    hair_description: "",
    recipe_id: "",
    scheduled_for: "",
    expected_completion_at: "",
    agreed_cost_ngn: "",
    brief_note: "",
    brief_link: "",
  });

  // The API enforces this too (jobCreate refine) — mirrored here so the button
  // explains itself instead of round-tripping to a 400.
  const kindMissing = !form.revenue_kind;
  const reasonMissing =
    form.revenue_kind === "internal" && !form.internal_reason.trim();

  const handleCreate = () => {
    if (!form.service_type_id || kindMissing || reasonMissing) return;
    const brief =
      form.brief_note.trim() || form.brief_link.trim()
        ? {
            body: form.brief_note.trim() || undefined,
            url: form.brief_link.trim() || undefined,
          }
        : undefined;
    create.mutate(
      {
        service_type_id: form.service_type_id,
        revenue_kind: (form.revenue_kind || undefined) as
          | RevenueKind
          | undefined,
        internal_reason:
          form.revenue_kind === "internal"
            ? form.internal_reason.trim() || undefined
            : undefined,
        hair_description: form.hair_description || undefined,
        recipe_id: form.recipe_id || undefined,
        scheduled_for: form.scheduled_for || undefined,
        expected_completion_at: form.expected_completion_at || undefined,
        agreed_cost_ngn: form.agreed_cost_ngn
          ? parseFloat(form.agreed_cost_ngn)
          : undefined,
        brief,
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

        {/* Every revenue needs a sale. This job has no order behind it, so it
            has to say whether one is owed — the two customer kinds go on the
            Unbilled queue and get chased; internal work never will. Without
            this the system cannot tell a photoshoot piece from a customer job
            nobody invoiced, which is what made the old "No Sale" count safe to
            ignore. */}
        <div>
          <label className="label">What is this job? *</label>
          <Select
            value={form.revenue_kind}
            onChange={(v) =>
              setForm((f) => ({ ...f, revenue_kind: v as RevenueKind }))
            }
            options={[
              { value: "", label: "Choose…" },
              {
                value: "customer_our_hair",
                label: "Customer work — our hair (a sale is owed)",
              },
              {
                value: "customer_own_hair",
                label: "Customer's own hair — styling fee (a sale is owed)",
              },
              {
                value: "internal",
                label: "Internal — content / sample / staff (no sale)",
              },
            ]}
          />
          {form.revenue_kind === "internal" && (
            <input
              className="input w-full mt-2"
              placeholder="What's it for? e.g. July campaign shoot"
              value={form.internal_reason}
              onChange={(e) =>
                setForm((f) => ({ ...f, internal_reason: e.target.value }))
              }
              autoComplete="off"
            />
          )}
          {form.revenue_kind && form.revenue_kind !== "internal" && (
            <p className="text-xs text-text-muted mt-1.5">
              This job will show on Unbilled Jobs until a sale is raised for it.
            </p>
          )}
        </div>

        <div>
          <label className="label">Hair description</label>
          <input
            className="input w-full"
            placeholder="e.g. 22in Body Wave 150% - Unit #A023"
            value={form.hair_description}
            onChange={(e) =>
              setForm((f) => ({ ...f, hair_description: e.target.value }))
            }
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore=""
            data-form-type="other"
          />
        </div>

        {/* Customer's style brief — captured once here and locked. The
            stylist opens the job already knowing what was asked for; they
            add their own working notes on top, but can't overwrite this. */}
        <div className="rounded-lg border border-accent/20 bg-accent/5 p-3 space-y-2">
          <label className="label text-accent-glow">
            Style brief — what the customer asked for
          </label>
          <textarea
            className="input w-full h-20 text-sm"
            placeholder="Describe the look they want…"
            value={form.brief_note}
            onChange={(e) =>
              setForm((f) => ({ ...f, brief_note: e.target.value }))
            }
          />
          <input
            className="input w-full text-sm"
            placeholder="Inspiration link (YouTube / Instagram) — optional"
            value={form.brief_link}
            onChange={(e) =>
              setForm((f) => ({ ...f, brief_link: e.target.value }))
            }
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore=""
            data-form-type="other"
          />
          <p className="text-[11px] text-text-muted">
            Locked once created — stylists and QC add notes on top, they
            can&rsquo;t change this.
          </p>
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            }
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore=""
            data-form-type="other"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={
              !form.service_type_id ||
              kindMissing ||
              reasonMissing ||
              create.isPending
            }
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
          j.sales_order_number?.toLowerCase().includes(tagQueryLower) ||
          j.styled_product_name?.toLowerCase().includes(tagQueryLower),
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
            placeholder="Tag, customer, order, product…"
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
                    <span className="text-xs text-text-muted">
                      {colJobs.length}
                    </span>
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
