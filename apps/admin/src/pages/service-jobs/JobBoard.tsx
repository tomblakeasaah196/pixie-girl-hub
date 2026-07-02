import { useState } from "react";
import {
  Button,
  Pill,
  Skeleton,
  EmptyState,
  MoneyText,
} from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/Drawer";
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

// ── Star rating display ────────────────────────────────────

function StarRating({
  value,
  max = 5,
}: {
  value: number | null;
  max?: number;
}) {
  if (!value) return <span className="text-muted text-sm">Not rated</span>;
  return (
    <span className="text-sm font-mono">
      {"★".repeat(value)}
      {"☆".repeat(max - value)}
      <span className="text-muted ml-1">({RATING_LABELS[value]})</span>
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
          className={`text-xl transition-colors ${n <= value ? "text-yellow-400" : "text-muted"}`}
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
            <span className="text-[11px] text-muted">{f.label}</span>
          </button>
        );
      })}
    </div>
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
        <span className="font-mono text-xs text-muted">{job.job_number}</span>
        {isPocketing && (
          <span
            className="text-danger text-xs font-semibold"
            title="Completed without linked sale"
          >
            ⚠ No Sale
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <span>{icon}</span>
        <span className="text-sm font-medium truncate">
          {st?.display_name ?? job.service_type_id}
        </span>
      </div>
      {job.hair_description && (
        <p className="text-xs text-muted truncate">{job.hair_description}</p>
      )}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <span className="text-xs text-muted">
          {job.assigned_staff_user_id
            ? "Staff assigned"
            : job.assigned_stylist_id
              ? "Stylist assigned"
              : "Unassigned"}
        </span>
        {job.scheduled_for && (
          <span className="text-xs font-mono text-muted">
            {new Date(job.scheduled_for).toLocaleDateString("en-NG", {
              month: "short",
              day: "numeric",
            })}
          </span>
        )}
      </div>
      {job.quality_rating !== null && <StarRating value={job.quality_rating} />}
      {job.customer_rating !== null && (
        <div className="text-sm" title={`Customer: ${RATING_LABELS[job.customer_rating]}`}>
          <span className="mr-1">{HAPPINESS_EMOJI[job.customer_rating]}</span>
          <span className="text-muted text-xs">customer</span>
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
      <p className="text-sm text-muted">Chemicals consumed for this job</p>

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
              <tr className="border-b border-line text-muted text-xs">
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
                  <td className="py-1.5 pr-3 text-muted">
                    {c.chemical_brand ?? "—"}
                  </td>
                  <td className="py-1.5 pr-3 text-right font-mono">
                    {c.qty_used}
                  </td>
                  <td className="py-1.5 pr-3 text-right text-muted">
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
        <p className="text-xs text-muted mb-3 font-semibold uppercase tracking-wide">
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
          />
          <input
            className="input"
            placeholder="Brand"
            value={form.chemical_brand}
            onChange={(e) =>
              setForm((f) => ({ ...f, chemical_brand: e.target.value }))
            }
          />
          <input
            className="input"
            placeholder="Notes"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
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
          <p className="text-xs text-muted">
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
        <p className="text-xs text-muted">
          Target shade: {recipe.target_shade}
        </p>
      )}
      <div className="space-y-1">
        {recipe.ingredients.map((ing, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="text-muted w-4">{i + 1}.</span>
            <span className="font-medium">{ing.chemical_name}</span>
            {ing.brand && <span className="text-muted">({ing.brand})</span>}
            {(ing.qty_ml || ing.qty_g) && (
              <span className="font-mono ml-auto">
                {ing.qty_ml ? `${ing.qty_ml} ml` : `${ing.qty_g} g`}
              </span>
            )}
            {ing.role && <span className="text-muted italic">{ing.role}</span>}
          </div>
        ))}
      </div>
      {recipe.instructions && (
        <p className="text-xs text-muted border-t border-line pt-2">
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
      <p className="text-xs text-muted uppercase tracking-wide font-semibold">
        Inter-company · Flow 1
      </p>
      {linked ? (
        <div className="glass p-3 rounded-lg space-y-1.5 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted">Styling invoice</span>
            <span className="font-mono">
              {job.intercompany_seller_doc ?? job.intercompany_number}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted">
              {job.intercompany_seller_brand} → {job.intercompany_buyer_brand}
            </span>
            {job.intercompany_status && (
              <Pill tone="info">{job.intercompany_status}</Pill>
            )}
          </div>
          {job.intercompany_amount_ngn && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted">Amount</span>
              <MoneyText ngn={parseFloat(job.intercompany_amount_ngn)} />
            </div>
          )}
        </div>
      ) : (
        <div className="glass p-3 rounded-lg space-y-2 border border-warn/30">
          <p className="text-sm text-warn font-medium">
            ⚠ No matched inter-company invoice yet
          </p>
          <p className="text-xs text-muted">
            This wig belongs to another entity. Record the FLH styling invoice
            in Intercompany, then paste its transaction ID here to link it.
          </p>
          <div className="flex items-center gap-2">
            <input
              className="input flex-1 text-sm font-mono"
              placeholder="Intercompany transaction ID"
              value={icId}
              onChange={(e) => setIcId(e.target.value)}
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
  const { data: job, isLoading } = useJob(jobId);
  const actions = useJobActions(jobId);
  const [tab, setTab] = useState<"details" | "chemicals" | "outcome">(
    "details",
  );
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
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-line gap-4">
          {(["details", "chemicals", "outcome"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t
                  ? "border-accent text-text-primary"
                  : "border-transparent text-muted hover:text-text-primary"
              }`}
              onClick={() => setTab(t)}
            >
              {t === "details"
                ? "Details"
                : t === "chemicals"
                  ? "Chemicals"
                  : "Outcome"}
            </button>
          ))}
        </div>

        {/* Details tab */}
        {tab === "details" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              {job.hair_description && (
                <>
                  <span className="text-muted">Hair</span>
                  <span>{job.hair_description}</span>
                </>
              )}
              {job.scheduled_for && (
                <>
                  <span className="text-muted">Scheduled</span>
                  <span className="font-mono">
                    {new Date(job.scheduled_for).toLocaleString("en-NG")}
                  </span>
                </>
              )}
              {job.expected_completion_at && (
                <>
                  <span className="text-muted">Due</span>
                  <span className="font-mono">
                    {new Date(job.expected_completion_at).toLocaleString(
                      "en-NG",
                    )}
                  </span>
                </>
              )}
              {job.agreed_cost_ngn && (
                <>
                  <span className="text-muted">Agreed cost</span>
                  <MoneyText ngn={parseFloat(job.agreed_cost_ngn)} />
                </>
              )}
              {job.actual_cost_ngn && (
                <>
                  <span className="text-muted">Actual cost</span>
                  <MoneyText ngn={parseFloat(job.actual_cost_ngn)} />
                </>
              )}
              {job.is_intercompany && (
                <>
                  <span className="text-muted">Type</span>
                  <Pill tone="info">Intercompany</Pill>
                </>
              )}
            </div>

            {job.recipe_id && (
              <div>
                <p className="text-xs text-muted mb-1.5 uppercase tracking-wide font-semibold">
                  Recipe
                </p>
                <RecipeCard recipeId={job.recipe_id} />
              </div>
            )}

            {(job.is_intercompany || job.intercompany_number) && (
              <IntercompanyPanel job={job} />
            )}

            {nextStates.length > 0 && (
              <div className="border-t border-line pt-4 space-y-2">
                <p className="text-xs text-muted uppercase tracking-wide font-semibold">
                  Advance status
                </p>
                {nextStates.includes("completed") && (
                  <input
                    className="input w-full text-sm"
                    type="number"
                    min="0"
                    placeholder="Actual cost NGN (optional)"
                    value={costInput}
                    onChange={(e) => setCostInput(e.target.value)}
                  />
                )}
                <div className="flex flex-wrap gap-2">
                  {nextStates.map((s) => {
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
            )}
          </div>
        )}

        {tab === "chemicals" && <ChemicalsTab jobId={jobId} />}
        {tab === "outcome" && <OutcomeTab job={job} jobId={jobId} />}
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
            }
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
            }
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
  const [detailJobId, setDetailJobId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading, isError } = useJobs(
    statusFilter
      ? { status: statusFilter, page_size: 200 }
      : { page_size: 200 },
  );
  const jobs = data?.data ?? [];

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
            All ({data?.total ?? 0})
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
        {canCreate && (
          <Button onClick={() => setShowCreate(true)}>+ New Job</Button>
        )}
      </div>

      {/* Board */}
      {jobs.length === 0 ? (
        <EmptyState
          icon={<span className="text-3xl">📋</span>}
          title="No service jobs"
          message={
            statusFilter
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
                    <span className="text-xs text-muted">{colJobs.length}</span>
                  </div>
                  {colJobs.length === 0 ? (
                    <div className="text-xs text-muted text-center py-6 border border-dashed border-line rounded-lg">
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
