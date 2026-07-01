import { useState } from "react";
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
import { JobBoard } from "./JobBoard";
import { RecipesPanel } from "./RecipesPanel";
import { AccountabilityPanel } from "./AccountabilityPanel";
import {
  useJobs,
  useServiceTypes,
  useServiceTypeMutations,
  useReconciliations,
  useRunReconciliation,
} from "./hooks";
import { VARIANCE_STATUS_META, SERVICE_KEY_ICON } from "./constants";
import type { ServiceType } from "./types";

// ── Service types management ───────────────────────────────

function ServiceTypeDrawer({
  initial,
  onSave,
  onClose,
  isSaving,
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
              disabled={!!initial}
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
              }
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
              }
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
              }
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
            }
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
                is_active: form.is_active,
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
        <p className="text-sm text-muted">
          Define the services Faitlyn offers (Installation, Revamping, Colour
          Creation…)
        </p>
        {canCreate && (
          <Button onClick={() => setShowCreate(true)}>+ New Type</Button>
        )}
      </div>

      {types.length === 0 ? (
        <EmptyState
          icon={<span className="text-3xl">⚙️</span>}
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
                <span className="font-mono text-xs text-muted">
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
          <p className="text-sm text-muted">
            Month-end: purchased vs consumed. Negative variance = anti-pocketing
            flag.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="input text-sm w-56"
            placeholder="Fiscal period ID"
            value={periodId}
            onChange={(e) => setPeriodId(e.target.value)}
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
          icon={<span className="text-3xl">🔬</span>}
          title="No reconciliation data"
          message="Run a reconciliation to see chemical usage vs purchased"
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-muted text-xs">
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
                    className={`border-b border-white/5 ${
                      r.variance_status === "flagged" ? "bg-danger/5" : ""
                    }`}
                  >
                    <td className="py-2 pr-3 font-medium">
                      {r.chemical_name}
                      <span className="text-muted ml-1 text-xs">
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

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <KpiTile label="Pending" value={String(pending)} />
      <KpiTile label="In Progress" value={String(inProgress)} />
      <KpiTile label="Completed Today" value={String(completedToday)} />
      <KpiTile
        label="No Sale (risk)"
        value={String(pocketing)}
        tone={pocketing > 0 ? "warn" : "neutral"}
      />
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────

type Tab = "board" | "accountability" | "types" | "recipes" | "reconciliation";

export function ServiceJobsPage() {
  useBreadcrumbs([{ label: "Stylist Studio" }]);
  const can = useAuthStore((s) => s.can);
  const [tab, setTab] = useState<Tab>("board");

  if (!can("service_jobs", "view")) {
    return (
      <div className="p-6">
        <div className="glass rounded-xl p-6 text-center space-y-2">
          <p className="text-lg font-semibold">Access Restricted</p>
          <p className="text-muted text-sm">
            You don't have permission to view Service Jobs.
          </p>
        </div>
      </div>
    );
  }

  const canCreate = can("service_jobs", "create");
  const canEdit = can("service_jobs", "edit");

  const tabs: { id: Tab; label: string }[] = [
    { id: "board", label: "Job Board" },
    { id: "accountability", label: "Wig Accountability" },
    { id: "types", label: "Service Types" },
    { id: "recipes", label: "Recipes" },
    { id: "reconciliation", label: "Chemical Reconciliation" },
  ];

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl">Stylist Studio</h1>
          <p className="text-muted text-sm">
            In-house styling operations — assign, track, QC and never lose a wig
          </p>
        </div>
      </div>

      {/* KPI strip */}
      <KpiStrip />

      {/* Tabs */}
      <div className="flex border-b border-white/10 gap-5 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`pb-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
              tab === t.id
                ? "border-accent text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "board" && <JobBoard canCreate={canCreate} />}
      {tab === "accountability" && <AccountabilityPanel />}
      {tab === "types" && <ServiceTypesTab canCreate={canEdit} />}
      {tab === "recipes" && <RecipesPanel canCreate={canEdit} />}
      {tab === "reconciliation" && <ReconciliationTab />}
    </div>
  );
}
