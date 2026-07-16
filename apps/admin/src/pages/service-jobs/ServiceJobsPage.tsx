import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Scissors,
  LayoutGrid,
  ClipboardCheck,
  PackageSearch,
  Wrench,
  FlaskConical,
  Sparkles,
  UserRound,
  Plus,
  Trophy,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Button,
  Pill,
  Skeleton,
  EmptyState,
  KpiTile,
  MoneyText,
} from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/Drawer";
import { ErrorState } from "@/components/ui/controls";
import { DataTable } from "@/components/ui/DataTable";
import { useAuthStore } from "@/stores/auth";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { ModuleInsights } from "@/components/insights/ModuleInsights";
import { JobBoard } from "./JobBoard";
import { RecipesPanel } from "./RecipesPanel";
import { AccountabilityPanel } from "./AccountabilityPanel";
import { MyStudioJobs } from "./MyStudioJobs";
import { QcQueue } from "./QcQueue";
import { ScorecardsPanel } from "./ScorecardsPanel";
import { WorkingNowStrip } from "./WorkingNowStrip";
import {
  useJobs,
  useServiceTypes,
  useServiceTypeMutations,
  useReconciliations,
  useRunReconciliation,
} from "./hooks";
import {
  VARIANCE_STATUS_META,
  SERVICE_KEY_ICON,
  HAPPINESS_EMOJI,
} from "./constants";
import type { ServiceType } from "./types";

// ── Service types management ───────────────────────────────

function ServiceTypeDrawer({
  initial,
  onSave,
  onClose,
  isSaving,
  error,
}: {
  initial?: ServiceType;
  onSave: (data: {
    service_key: string;
    display_name: string;
    description?: string;
    standard_cost_ngn?: number;
    standard_turnaround_days?: number;
    display_order?: number;
    is_active?: boolean;
  }) => void;
  onClose: () => void;
  isSaving: boolean;
  error?: string;
}) {
  const [form, setForm] = useState({
    service_key: initial?.service_key ?? "",
    display_name: initial?.display_name ?? "",
    description: initial?.description ?? "",
    standard_cost_ngn: initial?.standard_cost_ngn ?? "",
    standard_turnaround_days:
      initial?.standard_turnaround_days?.toString() ?? "",
    display_order: initial?.display_order?.toString() ?? "0",
    is_active: initial?.is_active ?? true,
  });

  return (
    <Drawer
      open
      onClose={onClose}
      title={initial ? `Edit: ${initial.display_name}` : "New Service Type"}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Service key *</label>
            <input
              className="input w-full font-mono"
              placeholder="e.g. installation"
              value={form.service_key}
              onChange={(e) =>
                setForm((f) => ({ ...f, service_key: e.target.value }))
              }
              disabled={!!initial} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
            />
          </div>
          <div>
            <label className="label">Display name *</label>
            <input
              className="input w-full"
              placeholder="e.g. Installation"
              value={form.display_name}
              onChange={(e) =>
                setForm((f) => ({ ...f, display_name: e.target.value }))
              } autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
            />
          </div>
        </div>

        <div>
          <label className="label">Description</label>
          <textarea
            className="input w-full h-20 text-sm"
            value={form.description}
            onChange={(e) =>
              setForm((f) => ({ ...f, description: e.target.value }))
            }
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Standard cost (NGN)</label>
            <input
              className="input w-full"
              type="number"
              min="0"
              value={form.standard_cost_ngn}
              onChange={(e) =>
                setForm((f) => ({ ...f, standard_cost_ngn: e.target.value }))
              } autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
            />
          </div>
          <div>
            <label className="label">Turnaround (days)</label>
            <input
              className="input w-full"
              type="number"
              min="0"
              value={form.standard_turnaround_days}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  standard_turnaround_days: e.target.value,
                }))
              } autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
            />
          </div>
        </div>

        <div>
          <label className="label">Display order</label>
          <input
            className="input w-24"
            type="number"
            value={form.display_order}
            onChange={(e) =>
              setForm((f) => ({ ...f, display_order: e.target.value }))
            } autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
          />
        </div>

        {initial && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4 accent-accent"
              checked={form.is_active}
              onChange={(e) =>
                setForm((f) => ({ ...f, is_active: e.target.checked }))
              }
            />
            <span className="text-sm">Active</span>
          </label>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!form.service_key || !form.display_name) return;
              onSave({
                service_key: form.service_key,
                display_name: form.display_name,
                description: form.description || undefined,
                standard_cost_ngn: form.standard_cost_ngn
                  ? parseFloat(form.standard_cost_ngn as string)
                  : undefined,
                standard_turnaround_days: form.standard_turnaround_days
                  ? parseInt(form.standard_turnaround_days)
                  : undefined,
                display_order: form.display_order
                  ? parseInt(form.display_order)
                  : undefined,
                // is_active is only a recognised field on update — the create
                // validator is .strict() and 400s on unknown keys, which is
                // exactly why every "New Service Type" save used to silently
                // fail (the error was never surfaced either — see `error` above).
                ...(initial ? { is_active: form.is_active } : {}),
              });
            }}
            disabled={!form.service_key || !form.display_name || isSaving}
          >
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

// ── Service types tab ──────────────────────────────────────

function ServiceTypesTab({ canCreate }: { canCreate: boolean }) {
  const { data: types = [], isLoading, isError } = useServiceTypes();
  const { create, update } = useServiceTypeMutations();
  const [editing, setEditing] = useState<ServiceType | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  if (isLoading) return <Skeleton className="h-48" />;
  if (isError) return <ErrorState />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">
          Define the services Faitlyn offers (Installation, Revamping, Colour
          Creation…)
        </p>
        {canCreate && (
          <Button onClick={() => setShowCreate(true)} icon={<Plus className="w-4 h-4" />}>
            New Type
          </Button>
        )}
      </div>

      {types.length === 0 ? (
        <EmptyState
          icon={<Wrench className="w-7 h-7" />}
          title="No service types"
          message="Create your first service type"
        />
      ) : (
        <DataTable<ServiceType>
          rows={types}
          columns={[
            {
              key: "service_key",
              header: "Key",
              render: (t) => (
                <span className="font-mono text-xs text-text-muted">
                  {SERVICE_KEY_ICON[t.service_key] ?? "🔧"} {t.service_key}
                </span>
              ),
            },
            {
              key: "display_name",
              header: "Name",
              render: (t) => t.display_name,
            },
            {
              key: "standard_cost_ngn",
              header: "Std Cost",
              render: (t) =>
                t.standard_cost_ngn ? (
                  <MoneyText ngn={parseFloat(t.standard_cost_ngn)} />
                ) : (
                  "—"
                ),
            },
            {
              key: "standard_turnaround_days",
              header: "Days",
              render: (t) => t.standard_turnaround_days ?? "—",
            },
            {
              key: "is_active",
              header: "Status",
              render: (t) => (
                <Pill tone={t.is_active ? "success" : "neutral"} dot={false}>
                  {t.is_active ? "Active" : "Inactive"}
                </Pill>
              ),
            },
            {
              key: "actions",
              header: "",
              render: (t) => (
                <Button variant="ghost" size="sm" onClick={() => setEditing(t)}>
                  Edit
                </Button>
              ),
            },
          ]}
          rowKey={(t) => t.service_type_id}
        />
      )}

      {showCreate && (
        <ServiceTypeDrawer
          onSave={(data) =>
            create.mutate(data, { onSuccess: () => setShowCreate(false) })
          }
          onClose={() => setShowCreate(false)}
          isSaving={create.isPending}
          error={create.isError ? (create.error as Error)?.message : undefined}
        />
      )}

      {editing && (
        <ServiceTypeDrawer
          initial={editing}
          onSave={(data) =>
            update.mutate([editing.service_type_id, data], {
              onSuccess: () => setEditing(null),
            })
          }
          onClose={() => setEditing(null)}
          isSaving={update.isPending}
          error={update.isError ? (update.error as Error)?.message : undefined}
        />
      )}
    </div>
  );
}

// ── Chemical reconciliation tab ────────────────────────────

function ReconciliationTab() {
  const [varFilter, setVarFilter] = useState("");
  const {
    data: rows = [],
    isLoading,
    isError,
  } = useReconciliations(
    varFilter ? { variance_status: varFilter } : undefined,
  );
  const run = useRunReconciliation();
  const [periodId, setPeriodId] = useState("");

  if (isLoading) return <Skeleton className="h-48" />;
  if (isError) return <ErrorState />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-display text-lg">Chemical Reconciliation</h3>
          <p className="text-sm text-text-muted">
            Month-end: purchased vs consumed. Negative variance = anti-pocketing
            flag.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="input text-sm w-56"
            placeholder="Fiscal period ID"
            value={periodId}
            onChange={(e) => setPeriodId(e.target.value)} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
          />
          <Button
            variant="secondary"
            onClick={() => run.mutate(periodId)}
            disabled={!periodId || run.isPending}
          >
            {run.isPending ? "Running…" : "Run Reconciliation"}
          </Button>
        </div>
      </div>

      {/* Variance filter */}
      <div className="flex gap-2 flex-wrap">
        {["", "normal", "flagged", "investigated", "resolved"].map((v) => (
          <button
            key={v}
            type="button"
            className={`pill-btn ${varFilter === v ? "active" : ""}`}
            onClick={() => setVarFilter(v)}
          >
            {v === ""
              ? "All"
              : (VARIANCE_STATUS_META[v as keyof typeof VARIANCE_STATUS_META]
                  ?.label ?? v)}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<FlaskConical className="w-7 h-7" />}
          title="No reconciliation data"
          message="Run a reconciliation to see chemical usage vs purchased"
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-text-muted text-xs">
                <th className="text-left py-2 pr-3">Chemical</th>
                <th className="text-right py-2 pr-3">Purchased</th>
                <th className="text-right py-2 pr-3">Consumed</th>
                <th className="text-right py-2 pr-3">Disposed</th>
                <th className="text-right py-2 pr-3">Variance</th>
                <th className="text-left py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const vm = VARIANCE_STATUS_META[r.variance_status];
                const varNegative = r.qty_variance < 0;
                return (
                  <tr
                    key={r.reconciliation_id}
                    className={`border-b border-line ${
                      r.variance_status === "flagged" ? "bg-danger/5" : ""
                    }`}
                  >
                    <td className="py-2 pr-3 font-medium">
                      {r.chemical_name}
                      <span className="text-text-muted ml-1 text-xs">
                        ({r.unit})
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">
                      {r.qty_purchased}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">
                      {r.qty_consumed}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">
                      {r.qty_disposed}
                    </td>
                    <td
                      className={`py-2 pr-3 text-right font-mono font-semibold ${
                        varNegative ? "text-danger" : "text-success"
                      }`}
                    >
                      {varNegative ? "" : "+"}
                      {r.qty_variance}
                    </td>
                    <td className="py-2">
                      <Pill tone={vm.tone}>{vm.label}</Pill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── KPI strip ──────────────────────────────────────────────

function KpiStrip() {
  const { data } = useJobs({ page_size: 200 });
  const jobs = data?.data ?? [];

  const pending = jobs.filter((j) => j.status === "pending").length;
  const inProgress = jobs.filter((j) => j.status === "in_progress").length;
  const completedToday = jobs.filter(
    (j) =>
      j.status === "completed" &&
      j.completed_at &&
      j.completed_at.startsWith(new Date().toISOString().split("T")[0]),
  ).length;
  const pocketing = jobs.filter(
    (j) =>
      j.status === "completed" &&
      !j.sales_order_id &&
      !j.intercompany_transaction_id,
  ).length;

  const rated = jobs.filter((j) => j.customer_rating != null);
  const avgHappiness = rated.length
    ? rated.reduce((s, j) => s + (j.customer_rating ?? 0), 0) / rated.length
    : null;
  const happinessFace =
    avgHappiness != null ? HAPPINESS_EMOJI[Math.round(avgHappiness)] : "—";

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <KpiTile label="Pending" value={String(pending)} />
      <KpiTile label="In Progress" value={String(inProgress)} />
      <KpiTile label="Completed Today" value={String(completedToday)} />
      <KpiTile
        label="No Sale (risk)"
        value={String(pocketing)}
        tone={pocketing > 0 ? "warn" : "neutral"}
      />
      <KpiTile
        label="Customer Happiness"
        value={
          avgHappiness != null
            ? `${happinessFace} ${avgHappiness.toFixed(1)}`
            : "—"
        }
        tone={
          avgHappiness != null && avgHappiness < 3
            ? "warn"
            : avgHappiness != null && avgHappiness >= 4
              ? "success"
              : "neutral"
        }
      />
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────

type Tab =
  | "my"
  | "board"
  | "qc"
  | "accountability"
  | "scorecards"
  | "types"
  | "recipes"
  | "reconciliation";

const TAB_IDS: Tab[] = [
  "my",
  "board",
  "qc",
  "accountability",
  "scorecards",
  "types",
  "recipes",
  "reconciliation",
];

export function ServiceJobsPage() {
  useBreadcrumbs([{ label: "Stylist Studio" }]);
  const can = useAuthStore((s) => s.can);
  const scopeFor = useAuthStore((s) => s.scopeFor);
  // Own-scope users (individual stylists) get the personal cockpit only —
  // Job Board / QC Queue / Wig Accountability / Team Scorecards / Types /
  // Recipes / Reconciliation are all Ops surfaces and stay hidden.
  const isOwnScope = scopeFor("service_jobs", "view") === "own";
  // Tab lives in the URL so deep links from Orders / notifications land on the
  // right pane (?tab=board&job=<id> opens the board with the job drawer up).
  const [sp, setSp] = useSearchParams();
  const urlTab = sp.get("tab") as Tab | null;
  const defaultTab: Tab = isOwnScope ? "my" : "board";
  const tab: Tab = urlTab && TAB_IDS.includes(urlTab) ? urlTab : defaultTab;
  const setTab = (t: Tab) =>
    setSp((p) => {
      const next = new URLSearchParams(p);
      next.set("tab", t);
      next.delete("job"); // switching panes drops the job focus
      next.delete("stylist"); // ...and any scorecard drill-down
      return next;
    });

  if (!can("service_jobs", "view")) {
    return (
      <div className="p-6">
        <div className="glass rounded-[16px] shadow-glass p-8 text-center space-y-3 max-w-md mx-auto">
          <span className="grid place-items-center w-12 h-12 mx-auto rounded-[14px] bg-text-primary/[0.05] border border-line text-text-faint">
            <Scissors className="w-6 h-6" />
          </span>
          <p className="text-lg font-semibold">Access Restricted</p>
          <p className="text-text-muted text-sm">
            You don't have permission to view Stylist Studio.
          </p>
        </div>
      </div>
    );
  }

  const canCreate = can("service_jobs", "create");
  const canEdit = can("service_jobs", "edit");

  const allTabs: { id: Tab; label: string; icon: typeof LayoutGrid }[] = [
    { id: "my", label: "My Jobs", icon: UserRound },
    { id: "board", label: "Job Board", icon: LayoutGrid },
    { id: "qc", label: "QC Queue", icon: ClipboardCheck },
    { id: "accountability", label: "Wig Accountability", icon: PackageSearch },
    { id: "scorecards", label: "Team Scorecards", icon: Trophy },
    { id: "types", label: "Service Types", icon: Wrench },
    { id: "recipes", label: "Recipes", icon: Sparkles },
    { id: "reconciliation", label: "Chemical Reconciliation", icon: FlaskConical },
  ];
  // Own-scope stylists see only their queue + the recipe library (they need
  // it to actually do the work). Every ops-only surface — the board, QC
  // queue, wig accountability ledger, team scorecards, service types,
  // reconciliation — is hidden. The API enforces the same rules regardless.
  const tabs = isOwnScope
    ? allTabs.filter((t) => t.id === "my" || t.id === "recipes")
    : allTabs;
  // If someone lands on a hidden tab via a stale URL, silently redirect to
  // the visible default rather than showing a blank pane.
  const currentTabVisible = tabs.some((t) => t.id === tab);
  const effectiveTab: Tab = currentTabVisible ? tab : defaultTab;

  return (
    <div className="p-4 md:p-6 space-y-5">
      <ModuleInsights module="service_jobs" />
      {/* Own-scope stylists get a persistent "You're working on Job X —
          47m elapsed [Pause]" strip when a time session is running, so the
          Pause control is always one tap away no matter which tab they're
          on. Renders nothing when no clock is running (or for Ops). */}
      <WorkingNowStrip enabled={isOwnScope} />
      {/* KPI strip is an ops-wide summary — a stylist doesn't need "no-sale
          risk" or team happiness on their personal cockpit. */}
      {!isOwnScope && <KpiStrip />}

      {/* Tabs — glassy pills */}
      <div className="flex gap-1 p-1 rounded-[13px] glass shadow-glass overflow-x-auto">
        {tabs.map((t) => {
          const on = effectiveTab === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "inline-flex items-center gap-2 px-3.5 h-10 rounded-[10px] text-[13px] font-semibold whitespace-nowrap transition-all",
                on
                  ? "bg-accent-deep text-[#F4E9D9] shadow-[0_6px_18px_rgb(var(--accent-deep)/0.4)]"
                  : "text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05]",
              )}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {effectiveTab === "my" && <MyStudioJobs />}
      {effectiveTab === "board" && <JobBoard canCreate={canCreate} />}
      {effectiveTab === "qc" && <QcQueue />}
      {effectiveTab === "accountability" && <AccountabilityPanel />}
      {effectiveTab === "scorecards" && <ScorecardsPanel />}
      {effectiveTab === "types" && <ServiceTypesTab canCreate={canCreate} />}
      {effectiveTab === "recipes" && <RecipesPanel canCreate={canEdit} />}
      {effectiveTab === "reconciliation" && <ReconciliationTab />}
    </div>
  );
}
