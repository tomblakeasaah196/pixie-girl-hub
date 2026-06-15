import { useState, useMemo } from "react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import {
  Plus,
  GitBranch,
  Shield,
  Workflow,
  Clock,
  Pencil,
  Trash2,
  ChevronDown,
  Check,
  X,
  Lock,
  Crown,
  ToggleLeft,
  ToggleRight,
  AlertTriangle,
  Users2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  MessageSquare,
  Layers,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Button, Pill, Skeleton, EmptyState, type Tone } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/Drawer";
import { Timeline } from "@/components/ui/Timeline";
import { OrgGraph } from "@/components/hub/OrgGraph";
import { useAuthStore } from "@/stores/auth";
import { cn } from "@/lib/cn";
import {
  orgApi,
  type OrgUnit,
  type OrgPosition,
  type WorkflowDefinition,
  type WorkflowStage,
  type WorkflowInstance,
} from "@/lib/org-api";
import {
  accessApi,
  type Role,
  type Permission,
  type CatalogEntry,
  ACTION_META,
  RECORD_SCOPE_LABELS,
} from "@/lib/access-api";

// ── Helpers ────────────────────────────────────────────────────────────────

type Tab = "org" | "permissions" | "workflows" | "pending";

function TabBar({ active, onChange, pendingCount }: { active: Tab; onChange: (t: Tab) => void; pendingCount: number }) {
  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "org",         label: "Org Chart",    icon: <GitBranch className="w-4 h-4" /> },
    { key: "permissions", label: "Permissions",  icon: <Shield className="w-4 h-4" /> },
    { key: "workflows",   label: "Workflows",    icon: <Workflow className="w-4 h-4" /> },
    { key: "pending",     label: "Pending",      icon: <Clock className="w-4 h-4" /> },
  ];

  return (
    <div className="flex gap-1 border-b border-[rgb(var(--border-c))] mb-6">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-semibold transition-all border-b-2 -mb-px",
            active === t.key
              ? "border-[rgb(var(--accent))] text-[rgb(var(--accent-glow))]"
              : "border-transparent text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text))]",
          )}
        >
          {t.icon}
          {t.label}
          {t.key === "pending" && pendingCount > 0 && (
            <span className="ml-0.5 min-w-[18px] h-[18px] rounded-full bg-[rgb(var(--accent))] text-[rgb(var(--bg))] text-[10px] font-bold grid place-items-center px-1">
              {pendingCount}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function PermDenied() {
  return (
    <div className="py-20 text-center">
      <div className="w-16 h-16 rounded-[20px] bg-[rgb(var(--danger)/0.12)] border border-[rgb(var(--danger)/0.3)] grid place-items-center mx-auto mb-4">
        <Lock className="w-7 h-7 text-[rgb(var(--danger))]" />
      </div>
      <h3 className="font-display text-xl mb-1">Access restricted</h3>
      <p className="text-[rgb(var(--text-muted))] text-sm max-w-xs mx-auto">
        You need the <code className="text-[rgb(var(--accent-glow))]">org_workflow.view</code> permission to access this module.
      </p>
    </div>
  );
}

// ╔════════════════════════════════════════════════════════════╗
// ║  TAB 1 — ORG CHART                                         ║
// ╚════════════════════════════════════════════════════════════╝

function UnitForm({
  initial,
  units,
  onSave,
  saving,
}: {
  initial?: Partial<OrgUnit>;
  units: OrgUnit[];
  onSave: (data: Partial<OrgUnit>) => void;
  saving: boolean;
}) {
  const [displayName, setDisplayName] = useState(initial?.display_name ?? "");
  const [unitKey, setUnitKey] = useState(initial?.unit_key ?? "");
  const [parentId, setParentId] = useState<string>(initial?.parent_unit_id ?? "");
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);

  const autoKey = displayName.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");

  return (
    <div className="space-y-4">
      <div>
        <label className="micro block mb-1.5">Department name</label>
        <input
          className="w-full bg-[rgb(var(--panel-2)/0.6)] border border-[rgb(var(--border-c))] rounded-xl px-3.5 py-2.5 text-[13px] focus:outline-none focus:border-[rgb(var(--accent)/0.5)]"
          value={displayName}
          onChange={(e) => {
            setDisplayName(e.target.value);
            if (!initial?.unit_key) setUnitKey(e.target.value.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""));
          }}
          placeholder="e.g. Marketing"
        />
      </div>
      <div>
        <label className="micro block mb-1.5">Key (snake_case)</label>
        <input
          className="w-full bg-[rgb(var(--panel-2)/0.6)] border border-[rgb(var(--border-c))] rounded-xl px-3.5 py-2.5 text-[13px] font-mono focus:outline-none focus:border-[rgb(var(--accent)/0.5)]"
          value={unitKey || autoKey}
          onChange={(e) => setUnitKey(e.target.value)}
          placeholder="marketing"
        />
      </div>
      <div>
        <label className="micro block mb-1.5">Parent department (optional)</label>
        <select
          className="w-full bg-[rgb(var(--panel-2)/0.6)] border border-[rgb(var(--border-c))] rounded-xl px-3.5 py-2.5 text-[13px] focus:outline-none focus:border-[rgb(var(--accent)/0.5)]"
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
        >
          <option value="">— None (top-level) —</option>
          {units.filter((u) => u.unit_id !== initial?.unit_id).map((u) => (
            <option key={u.unit_id} value={u.unit_id}>{u.display_name}</option>
          ))}
        </select>
      </div>
      {initial?.unit_id && (
        <label className="flex items-center gap-3 cursor-pointer">
          <span className="text-[13px]">Active</span>
          <button
            type="button"
            onClick={() => setIsActive((v) => !v)}
            className="text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text))]"
          >
            {isActive ? <ToggleRight className="w-6 h-6 text-[rgb(var(--success))]" /> : <ToggleLeft className="w-6 h-6" />}
          </button>
        </label>
      )}
      <Button
        variant="primary"
        className="w-full"
        disabled={!displayName.trim() || saving}
        onClick={() =>
          onSave({
            display_name: displayName.trim(),
            unit_key: unitKey || autoKey,
            parent_unit_id: parentId || null,
            is_active: isActive,
          })
        }
      >
        {saving ? "Saving…" : initial?.unit_id ? "Save changes" : "Create department"}
      </Button>
    </div>
  );
}

function PositionForm({
  initial,
  units,
  positions,
  onSave,
  saving,
}: {
  initial?: Partial<OrgPosition>;
  units: OrgUnit[];
  positions: OrgPosition[];
  onSave: (data: Partial<OrgPosition>) => void;
  saving: boolean;
}) {
  const [displayName, setDisplayName] = useState(initial?.display_name ?? "");
  const [posKey, setPosKey] = useState(initial?.position_key ?? "");
  const [unitId, setUnitId] = useState(initial?.unit_id ?? "");
  const [reportsTo, setReportsTo] = useState(initial?.reports_to_position_id ?? "");
  const [isMgmt, setIsMgmt] = useState(initial?.is_management ?? false);
  const [isDeputy, setIsDeputy] = useState(initial?.is_deputy ?? false);
  const [deputyCapacities, setDeputyCapacities] = useState(
    (initial?.deputy_capacities ?? []).join(", "),
  );
  const [threshold, setThreshold] = useState<string>(
    initial?.approval_threshold_ngn != null ? String(initial.approval_threshold_ngn) : "",
  );

  const autoKey = displayName.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");

  return (
    <div className="space-y-4">
      <div>
        <label className="micro block mb-1.5">Position title</label>
        <input
          className="w-full bg-[rgb(var(--panel-2)/0.6)] border border-[rgb(var(--border-c))] rounded-xl px-3.5 py-2.5 text-[13px] focus:outline-none focus:border-[rgb(var(--accent)/0.5)]"
          value={displayName}
          onChange={(e) => {
            setDisplayName(e.target.value);
            if (!initial?.position_key) setPosKey(e.target.value.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""));
          }}
          placeholder="e.g. Head of Finance"
        />
      </div>
      <div>
        <label className="micro block mb-1.5">Key (snake_case)</label>
        <input
          className="w-full bg-[rgb(var(--panel-2)/0.6)] border border-[rgb(var(--border-c))] rounded-xl px-3.5 py-2.5 text-[13px] font-mono focus:outline-none focus:border-[rgb(var(--accent)/0.5)]"
          value={posKey || autoKey}
          onChange={(e) => setPosKey(e.target.value)}
          placeholder="head_of_finance"
        />
      </div>
      <div>
        <label className="micro block mb-1.5">Department</label>
        <select
          className="w-full bg-[rgb(var(--panel-2)/0.6)] border border-[rgb(var(--border-c))] rounded-xl px-3.5 py-2.5 text-[13px] focus:outline-none focus:border-[rgb(var(--accent)/0.5)]"
          value={unitId}
          onChange={(e) => setUnitId(e.target.value)}
        >
          <option value="">— Select department —</option>
          {units.map((u) => (
            <option key={u.unit_id} value={u.unit_id}>{u.display_name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="micro block mb-1.5">Reports to (solid line)</label>
        <select
          className="w-full bg-[rgb(var(--panel-2)/0.6)] border border-[rgb(var(--border-c))] rounded-xl px-3.5 py-2.5 text-[13px] focus:outline-none focus:border-[rgb(var(--accent)/0.5)]"
          value={reportsTo}
          onChange={(e) => setReportsTo(e.target.value)}
        >
          <option value="">— None (root position) —</option>
          {positions.filter((p) => p.position_id !== initial?.position_id).map((p) => (
            <option key={p.position_id} value={p.position_id}>{p.display_name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="micro block mb-1.5">Approval threshold (NGN, optional)</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgb(var(--text-faint))] text-sm">₦</span>
          <input
            type="number"
            min={0}
            className="w-full bg-[rgb(var(--panel-2)/0.6)] border border-[rgb(var(--border-c))] rounded-xl pl-7 pr-3.5 py-2.5 text-[13px] font-mono focus:outline-none focus:border-[rgb(var(--accent)/0.5)]"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder="e.g. 200000"
          />
        </div>
      </div>
      <div className="flex gap-6">
        <label className="flex items-center gap-2 cursor-pointer">
          <button type="button" onClick={() => setIsMgmt((v) => !v)}>
            {isMgmt ? <ToggleRight className="w-5 h-5 text-[rgb(var(--accent-glow))]" /> : <ToggleLeft className="w-5 h-5 text-[rgb(var(--text-muted))]" />}
          </button>
          <span className="text-[13px]">Management</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <button type="button" onClick={() => setIsDeputy((v) => !v)}>
            {isDeputy ? <ToggleRight className="w-5 h-5 text-[rgb(var(--info))]" /> : <ToggleLeft className="w-5 h-5 text-[rgb(var(--text-muted))]" />}
          </button>
          <span className="text-[13px]">Deputy</span>
        </label>
      </div>
      {isDeputy && (
        <div>
          <label className="micro block mb-1.5">Deputy capacities (comma-separated)</label>
          <textarea
            rows={2}
            className="w-full bg-[rgb(var(--panel-2)/0.6)] border border-[rgb(var(--border-c))] rounded-xl px-3.5 py-2.5 text-[13px] font-mono resize-none focus:outline-none focus:border-[rgb(var(--accent)/0.5)]"
            value={deputyCapacities}
            onChange={(e) => setDeputyCapacities(e.target.value)}
            placeholder="sales.approve, expenses.approve"
          />
        </div>
      )}
      <Button
        variant="primary"
        className="w-full"
        disabled={!displayName.trim() || !unitId || saving}
        onClick={() =>
          onSave({
            display_name: displayName.trim(),
            position_key: posKey || autoKey,
            unit_id: unitId || undefined,
            reports_to_position_id: reportsTo || null,
            is_management: isMgmt,
            is_deputy: isDeputy,
            deputy_capacities: isDeputy
              ? deputyCapacities.split(",").map((s) => s.trim()).filter(Boolean)
              : [],
            approval_threshold_ngn: threshold ? parseFloat(threshold) : null,
          })
        }
      >
        {saving ? "Saving…" : initial?.position_id ? "Save changes" : "Create position"}
      </Button>
    </div>
  );
}

function OrgTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);
  const [unitDrawer, setUnitDrawer] = useState<"create" | OrgUnit | null>(null);
  const [posDrawer, setPosDrawer] = useState<"create" | OrgPosition | null>(null);

  const { data: unitsResp, isLoading: unitsLoading, error: unitsError } = useQuery({
    queryKey: ["org-units"],
    queryFn: () => orgApi.listUnits({ include_inactive: false }),
  });
  const units = Array.isArray(unitsResp) ? unitsResp : [];

  const { data: allPositions = [], isLoading: posLoading } = useQuery({
    queryKey: ["org-positions"],
    queryFn: () => orgApi.listPositions(),
  });

  const selectedUnit = units.find((u) => u.unit_id === selectedUnitId) ?? units[0] ?? null;
  const unitPositions = allPositions.filter((p) => p.unit_id === selectedUnit?.unit_id);
  const selectedPosition = allPositions.find((p) => p.position_id === selectedPositionId) ?? null;

  const createUnitMutation = useMutation({
    mutationFn: (data: Partial<OrgUnit>) => orgApi.createUnit(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["org-units"] }); setUnitDrawer(null); },
  });
  const updateUnitMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<OrgUnit> }) => orgApi.updateUnit(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["org-units"] }); setUnitDrawer(null); },
  });
  const createPosMutation = useMutation({
    mutationFn: (data: Partial<OrgPosition>) => orgApi.createPosition(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["org-positions"] }); setPosDrawer(null); },
  });
  const updatePosMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<OrgPosition> }) => orgApi.updatePosition(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["org-positions"] }); setPosDrawer(null); },
  });
  const deletePosMutation = useMutation({
    mutationFn: (id: string) => orgApi.deletePosition(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["org-positions"] }); setSelectedPositionId(null); },
  });

  if (unitsLoading) return <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>;
  if (unitsError) return (
    <div className="py-12 text-center">
      <AlertTriangle className="w-8 h-8 text-[rgb(var(--danger))] mx-auto mb-3" />
      <p className="text-[rgb(var(--text-muted))]">Failed to load organisation. Check the connection.</p>
    </div>
  );

  return (
    <div>
      {canEdit && (
        <div className="flex justify-end mb-4">
          <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setUnitDrawer("create")}>
            New Department
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5">
        {/* Departments list */}
        <div className="space-y-2">
          <div className="micro mb-2">Departments</div>
          {units.length === 0 ? (
            <EmptyState icon={<Layers className="w-6 h-6" />} title="No departments" message="Create your first department to start building the org chart." />
          ) : (
            units.map((unit) => (
              <div
                key={unit.unit_id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedUnitId(unit.unit_id)}
                onKeyDown={(e) => e.key === "Enter" && setSelectedUnitId(unit.unit_id)}
                className={cn(
                  "group flex items-center gap-3 p-3.5 rounded-[13px] border cursor-pointer transition-all",
                  "backdrop-blur-[22px] bg-[rgb(var(--panel-2)/0.6)]",
                  selectedUnit?.unit_id === unit.unit_id
                    ? "border-[rgb(var(--accent)/0.5)] ring-1 ring-[rgb(var(--accent)/0.2)]"
                    : "border-[rgb(var(--border-c))] hover:border-[rgb(var(--accent)/0.3)]",
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold truncate">{unit.display_name}</div>
                  <div className="font-mono text-[10px] text-[rgb(var(--text-faint))] truncate">{unit.unit_key}</div>
                </div>
                <div className="text-[11px] text-[rgb(var(--text-faint))]">
                  {allPositions.filter((p) => p.unit_id === unit.unit_id).length} pos.
                </div>
                {canEdit && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setUnitDrawer(unit); }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-[rgb(var(--text)/0.07)] transition-all"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {/* Org graph + position detail */}
        <div>
          {selectedUnit && (
            <>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-display text-lg font-medium">{selectedUnit.display_name}</div>
                  <div className="micro">{unitPositions.length} position{unitPositions.length !== 1 ? "s" : ""}</div>
                </div>
                {canEdit && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Plus className="w-3.5 h-3.5" />}
                    onClick={() => setPosDrawer("create")}
                  >
                    Add Position
                  </Button>
                )}
              </div>
              <div className="glass rounded-[var(--radius)] shadow-glass p-4 mb-4 min-h-[220px]">
                {posLoading
                  ? <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[90px] rounded-xl" />)}</div>
                  : <OrgGraph positions={unitPositions} allPositions={allPositions} onSelectPosition={(p) => setSelectedPositionId(p.position_id)} selectedId={selectedPositionId} />
                }
              </div>

              {/* Selected position detail */}
              {selectedPosition && (
                <div className="glass rounded-[var(--radius)] shadow-glass p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="font-display text-lg font-medium">{selectedPosition.display_name}</div>
                      <div className="font-mono text-[11px] text-[rgb(var(--text-faint))]">{selectedPosition.position_key}</div>
                    </div>
                    {canEdit && (
                      <div className="flex gap-1.5">
                        <Button size="sm" icon={<Pencil className="w-3 h-3" />} onClick={() => setPosDrawer(selectedPosition)}>Edit</Button>
                        <Button
                          size="sm"
                          variant="danger"
                          icon={<Trash2 className="w-3 h-3" />}
                          onClick={() => {
                            if (confirm(`Delete position "${selectedPosition.display_name}"?`)) {
                              deletePosMutation.mutate(selectedPosition.position_id);
                            }
                          }}
                        />
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {[
                      { label: "Management", value: selectedPosition.is_management ? "Yes" : "No" },
                      { label: "Deputy", value: selectedPosition.is_deputy ? "Yes" : "No" },
                      { label: "Approval limit", value: selectedPosition.approval_threshold_ngn != null ? `₦${selectedPosition.approval_threshold_ngn.toLocaleString()}` : "Unlimited" },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-[rgb(var(--text)/0.03)] rounded-xl p-3 border border-[rgb(var(--border-c))]">
                        <div className="micro mb-1">{label}</div>
                        <div className="text-[13px] font-semibold">{value}</div>
                      </div>
                    ))}
                  </div>
                  {selectedPosition.is_deputy && selectedPosition.deputy_capacities.length > 0 && (
                    <div className="mt-3">
                      <div className="micro mb-1.5">Deputy capacities</div>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedPosition.deputy_capacities.map((c) => (
                          <span key={c} className="font-mono text-[10px] bg-[rgb(var(--info)/0.12)] text-[rgb(var(--info))] px-2 py-0.5 rounded-full">{c}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          {!selectedUnit && units.length > 0 && (
            <div className="h-48 grid place-items-center text-[rgb(var(--text-muted))] text-sm">
              Select a department to view its positions
            </div>
          )}
        </div>
      </div>

      {/* Unit Drawer */}
      <Drawer
        open={unitDrawer !== null}
        onClose={() => setUnitDrawer(null)}
        title={unitDrawer === "create" ? "New department" : "Edit department"}
      >
        {unitDrawer !== null && (
          <UnitForm
            initial={unitDrawer === "create" ? undefined : unitDrawer}
            units={units}
            saving={createUnitMutation.isPending || updateUnitMutation.isPending}
            onSave={(data) => {
              if (unitDrawer === "create") createUnitMutation.mutate(data);
              else updateUnitMutation.mutate({ id: unitDrawer.unit_id, data });
            }}
          />
        )}
      </Drawer>

      {/* Position Drawer */}
      <Drawer
        open={posDrawer !== null}
        onClose={() => setPosDrawer(null)}
        title={posDrawer === "create" ? "New position" : "Edit position"}
      >
        {posDrawer !== null && (
          <PositionForm
            initial={posDrawer === "create"
              ? { unit_id: selectedUnit?.unit_id }
              : posDrawer}
            units={units}
            positions={allPositions}
            saving={createPosMutation.isPending || updatePosMutation.isPending}
            onSave={(data) => {
              if (posDrawer === "create") createPosMutation.mutate(data);
              else updatePosMutation.mutate({ id: posDrawer.position_id, data });
            }}
          />
        )}
      </Drawer>
    </div>
  );
}

// ╔════════════════════════════════════════════════════════════╗
// ║  TAB 2 — PERMISSIONS                                        ║
// ╚════════════════════════════════════════════════════════════╝

const MODULE_LABELS: Record<string, string> = {
  accounting: "Accounting", ad_analytics: "Ad Analytics", ai_governance: "AI Gov.",
  ai_insights: "AI Insights", attendance: "Attendance", audit: "Audit",
  business_setup: "Biz Setup", calendar: "Calendar", contacts: "Contacts",
  crm: "CRM", dashboards: "Dashboards", documents: "Documents",
  email_campaigns: "Email Camp.", expenses: "Expenses", hr_payroll: "HR & Pay",
  intercompany: "Interco.", invoicing: "Invoicing", logistics: "Logistics",
  org_workflow: "Org & WF", pos: "POS", praxis_ai: "Praxis AI",
  pricing: "Pricing", production: "Production", purchasing: "Purchasing",
  retail_partners: "Retail", retention: "Retention", sales: "Sales",
  sales_campaigns: "Sales Camp.", service_jobs: "Service", settings: "Settings",
  smartcomm: "Comm.", social: "Social", stock: "Stock",
  storefront: "Storefront", storefront_studio: "SF Studio",
  stylist_programme: "Stylists", tasks: "Tasks",
};

const ACTION_ORDER = ["view", "create", "edit", "delete", "approve", "export"];

function RoleEditorDrawer({
  roleId,
  catalog,
  onClose,
  canEdit,
}: {
  roleId: string;
  catalog: CatalogEntry[];
  onClose: () => void;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [expandedModule, setExpandedModule] = useState<string | null>(null);
  const [pendingGrants, setPendingGrants] = useState<Map<string, Permission>>(new Map());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: role, isLoading } = useQuery({
    queryKey: ["role-detail", roleId],
    queryFn: async () => {
      const r = await accessApi.getRole(roleId);
      const perms = await accessApi.getRolePermissions(roleId);
      return { ...r, permissions: Array.isArray(perms) ? perms : [] };
    },
  });

  // Initialise local grant map from loaded permissions
  const permMap = useMemo(() => {
    if (!role?.permissions) return new Map<string, Permission>();
    return new Map(role.permissions.map((p) => [`${p.module}.${p.action}`, p]));
  }, [role]);

  const effectiveMap = dirty ? pendingGrants : permMap;

  function initPending() {
    if (!dirty) {
      setPendingGrants(new Map(permMap));
      setDirty(true);
    }
  }

  function toggleAction(module: string, action: string) {
    if (!canEdit || role?.is_system) return;
    initPending();
    const key = `${module}.${action}`;
    const next = new Map(dirty ? pendingGrants : permMap);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.set(key, { permission_id: "", module, action, record_scope: "all", hidden_fields: [] });
    }
    setPendingGrants(next);
    setDirty(true);
  }

  function updateScope(module: string, action: string, record_scope: string) {
    initPending();
    const key = `${module}.${action}`;
    const next = new Map(dirty ? pendingGrants : permMap);
    const existing = next.get(key);
    if (existing) next.set(key, { ...existing, record_scope: record_scope as Permission["record_scope"] });
    setPendingGrants(next);
    setDirty(true);
  }

  function updateHiddenFields(module: string, action: string, raw: string) {
    initPending();
    const key = `${module}.${action}`;
    const next = new Map(dirty ? pendingGrants : permMap);
    const existing = next.get(key);
    if (existing) {
      next.set(key, { ...existing, hidden_fields: raw.split(",").map((s) => s.trim()).filter(Boolean) });
    }
    setPendingGrants(next);
    setDirty(true);
  }

  async function handleSave() {
    if (!roleId || !dirty) return;
    setSaving(true);
    const grants = Array.from(effectiveMap.values()).map((p) => ({
      module: p.module,
      action: p.action,
      record_scope: p.record_scope,
      hidden_fields: p.hidden_fields,
    }));
    try {
      await accessApi.setRolePermissions(roleId, grants);
      qc.invalidateQueries({ queryKey: ["role-detail", roleId] });
      qc.invalidateQueries({ queryKey: ["roles"] });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  const isSystemRole = role?.is_system ?? false;

  return (
    <Drawer
      open
      onClose={onClose}
      wide
      title={isLoading ? "Loading…" : (role?.role_name ?? "Role")}
      subtitle={isLoading ? "" : `${role?.member_count ?? 0} member${role?.member_count !== 1 ? "s" : ""} · ${role?.permission_count ?? 0} grants`}
      leading={isSystemRole ? <Lock className="w-4 h-4 text-[rgb(var(--warn))]" /> : <Shield className="w-4 h-4 text-[rgb(var(--accent))]" />}
      footer={
        canEdit && !isSystemRole ? (
          <>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!dirty || saving} onClick={handleSave}>
              {saving ? "Saving…" : "Save permissions"}
            </Button>
          </>
        ) : undefined
      }
    >
      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
      ) : (
        <>
          {role?.description && (
            <p className="text-[rgb(var(--text-muted))] text-sm mb-4">{role.description}</p>
          )}
          {isSystemRole && (
            <div className="flex items-center gap-2 mb-4 p-3 rounded-xl bg-[rgb(var(--warn)/0.08)] border border-[rgb(var(--warn)/0.25)]">
              <Lock className="w-4 h-4 text-[rgb(var(--warn))] shrink-0" />
              <span className="text-[12.5px] text-[rgb(var(--warn))]">System role — permissions are read-only</span>
            </div>
          )}
          <div className="space-y-1.5">
            {catalog.map((cat) => {
              const modulePerms = ACTION_ORDER.filter((a) => effectiveMap.has(`${cat.module}.${a}`));
              const isExp = expandedModule === cat.module;
              return (
                <div key={cat.module} className="rounded-xl border border-[rgb(var(--border-c))] overflow-hidden">
                  <button
                    onClick={() => setExpandedModule(isExp ? null : cat.module)}
                    className="flex w-full items-center gap-3 px-4 py-3 hover:bg-[rgb(var(--text)/0.03)] transition-colors"
                  >
                    <span className="text-[13px] font-semibold flex-1 text-left">
                      {MODULE_LABELS[cat.module] ?? cat.module}
                    </span>
                    <div className="flex gap-1">
                      {modulePerms.map((a) => (
                        <span
                          key={a}
                          className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
                          style={{ background: `${ACTION_META[a]?.color}22`, color: ACTION_META[a]?.color }}
                        >
                          {a}
                        </span>
                      ))}
                    </div>
                    <ChevronDown className={cn("w-4 h-4 text-[rgb(var(--text-muted))] transition-transform", isExp && "rotate-180")} />
                  </button>
                  {isExp && (
                    <div className="border-t border-[rgb(var(--border-c))] bg-[rgb(var(--text)/0.02)] px-4 py-3 space-y-3">
                      {/* Action toggles */}
                      <div className="grid grid-cols-3 gap-2">
                        {ACTION_ORDER.filter((a) => cat.actions.includes(a)).map((action) => {
                          const key = `${cat.module}.${action}`;
                          const granted = effectiveMap.has(key);
                          const meta = ACTION_META[action];
                          return (
                            <button
                              key={action}
                              onClick={() => toggleAction(cat.module, action)}
                              disabled={isSystemRole || !canEdit}
                              className={cn(
                                "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-[12px] font-medium transition-all",
                                isSystemRole || !canEdit ? "cursor-default" : "cursor-pointer",
                                granted
                                  ? "border-transparent"
                                  : "border-[rgb(var(--border-c))] text-[rgb(var(--text-muted))] hover:border-[rgb(var(--text)/0.2)]",
                              )}
                              style={granted ? { background: `${meta.color}1a`, borderColor: `${meta.color}44`, color: meta.color } : {}}
                            >
                              {granted
                                ? <Check className="w-3 h-3 shrink-0" />
                                : <X className="w-3 h-3 shrink-0 opacity-30" />}
                              {meta.label}
                            </button>
                          );
                        })}
                      </div>
                      {/* Scope + hidden fields for view grant */}
                      {effectiveMap.has(`${cat.module}.view`) && canEdit && !isSystemRole && (
                        <div className="pt-2 border-t border-[rgb(var(--border-c))] space-y-2">
                          <div className="micro">Data access refinement (view)</div>
                          <div className="flex flex-wrap items-center gap-3">
                            <label className="text-[12px] text-[rgb(var(--text-muted))]">Scope</label>
                            <select
                              value={effectiveMap.get(`${cat.module}.view`)?.record_scope ?? "all"}
                              onChange={(e) => updateScope(cat.module, "view", e.target.value)}
                              className="bg-[rgb(var(--panel-2)/0.6)] border border-[rgb(var(--border-c))] rounded-lg px-2.5 py-1 text-[12px] focus:outline-none focus:border-[rgb(var(--accent)/0.5)]"
                            >
                              {Object.entries(RECORD_SCOPE_LABELS).map(([v, lbl]) => (
                                <option key={v} value={v}>{lbl}</option>
                              ))}
                            </select>
                          </div>
                          <div className="flex flex-wrap items-start gap-3">
                            <label className="text-[12px] text-[rgb(var(--text-muted))] pt-1">Hidden fields</label>
                            <input
                              className="flex-1 min-w-0 bg-[rgb(var(--panel-2)/0.6)] border border-[rgb(var(--border-c))] rounded-lg px-2.5 py-1 text-[11px] font-mono focus:outline-none focus:border-[rgb(var(--accent)/0.5)]"
                              placeholder="cost_price, factory_origin (comma-separated)"
                              value={(effectiveMap.get(`${cat.module}.view`)?.hidden_fields ?? []).join(", ")}
                              onChange={(e) => updateHiddenFields(cat.module, "view", e.target.value)}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Drawer>
  );
}

function NewRoleDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: (r: Role) => void }) {
  const [roleName, setRoleName] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<"brand" | "system">("brand");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      const role = await accessApi.createRole({ role_name: roleName.trim().toLowerCase().replace(/\s+/g, "_"), description: description.trim() || undefined, scope });
      onCreated(role);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create role");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open onClose={onClose} title="New role">
      <div className="space-y-4">
        <div>
          <label className="micro block mb-1.5">Role name (snake_case)</label>
          <input
            className="w-full bg-[rgb(var(--panel-2)/0.6)] border border-[rgb(var(--border-c))] rounded-xl px-3.5 py-2.5 text-[13px] font-mono focus:outline-none focus:border-[rgb(var(--accent)/0.5)]"
            value={roleName}
            onChange={(e) => setRoleName(e.target.value)}
            placeholder="sales_manager"
          />
        </div>
        <div>
          <label className="micro block mb-1.5">Description (optional)</label>
          <textarea
            rows={2}
            className="w-full bg-[rgb(var(--panel-2)/0.6)] border border-[rgb(var(--border-c))] rounded-xl px-3.5 py-2.5 text-[13px] resize-none focus:outline-none focus:border-[rgb(var(--accent)/0.5)]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Manages the sales team…"
          />
        </div>
        <div>
          <label className="micro block mb-1.5">Scope</label>
          <select
            className="w-full bg-[rgb(var(--panel-2)/0.6)] border border-[rgb(var(--border-c))] rounded-xl px-3.5 py-2.5 text-[13px] focus:outline-none focus:border-[rgb(var(--accent)/0.5)]"
            value={scope}
            onChange={(e) => setScope(e.target.value as "brand" | "system")}
          >
            <option value="brand">Brand (this business only)</option>
            <option value="system">System (all businesses — owner only)</option>
          </select>
        </div>
        {error && <p className="text-[rgb(var(--danger))] text-sm">{error}</p>}
        <Button
          variant="primary"
          className="w-full"
          disabled={!roleName.trim() || saving}
          onClick={handleCreate}
        >
          {saving ? "Creating…" : "Create role"}
        </Button>
      </div>
    </Drawer>
  );
}

function PermissionsTab({ canEdit }: { canEdit: boolean }) {
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [showNewRole, setShowNewRole] = useState(false);
  const qc = useQueryClient();

  const { data: roles = [], isLoading: rolesLoading } = useQuery({
    queryKey: ["roles"],
    queryFn: () => accessApi.listRoles(),
  });
  const { data: catalog, isLoading: catLoading } = useQuery({
    queryKey: ["access-catalog"],
    queryFn: () => accessApi.getCatalog(),
  });
  const { data: roleDetails } = useQuery({
    queryKey: ["roles-permissions-all"],
    queryFn: async () => {
      const results = await Promise.all(
        roles.map(async (r) => {
          const perms = await accessApi.getRolePermissions(r.role_id);
          return { role_id: r.role_id, perms: Array.isArray(perms) ? perms : [] };
        }),
      );
      return new Map(results.map((r) => [r.role_id, r.perms]));
    },
    enabled: roles.length > 0,
  });

  const catalogModules = catalog?.modules ?? [];

  // Legend
  const legend = Object.entries(ACTION_META).slice(0, 6);

  if (rolesLoading || catLoading) {
    return <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex flex-wrap gap-2">
          {legend.map(([action, meta]) => (
            <span key={action} className="flex items-center gap-1 text-[10px] font-semibold">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: meta.color }} />
              {meta.label}
            </span>
          ))}
        </div>
        {canEdit && (
          <Button variant="primary" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowNewRole(true)}>
            New Role
          </Button>
        )}
      </div>

      {/* Roles × modules matrix */}
      <div className="glass rounded-[var(--radius)] shadow-glass overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-[rgb(var(--panel))] micro p-[12px_18px] border-b border-r border-[rgb(var(--border-c))] text-left min-w-[160px]">
                  Role
                </th>
                {catalogModules.map((m) => (
                  <th key={m.module} className="micro p-[10px_8px] border-b border-[rgb(var(--border-c))] text-center min-w-[64px] text-[9px]">
                    {(MODULE_LABELS[m.module] ?? m.module).slice(0, 8)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => {
                const perms = roleDetails?.get(role.role_id) ?? [];
                const permSet = new Set(perms.map((p) => `${p.module}.${p.action}`));
                return (
                  <tr
                    key={role.role_id}
                    onClick={() => setSelectedRoleId(role.role_id)}
                    className={cn(
                      "cursor-pointer border-b border-[rgb(var(--border-c))] last:border-0 transition-colors hover:bg-[rgb(var(--text)/0.03)]",
                      selectedRoleId === role.role_id && "bg-[rgb(var(--accent)/0.05)]",
                    )}
                  >
                    <td className="sticky left-0 z-10 bg-[rgb(var(--panel))] p-[0_18px] h-[48px] border-r border-[rgb(var(--border-c))]">
                      <div className="flex items-center gap-2">
                        {role.is_system ? <Lock className="w-3 h-3 text-[rgb(var(--warn))] shrink-0" /> : <Shield className="w-3 h-3 text-[rgb(var(--accent))] shrink-0" />}
                        <span className="text-[12.5px] font-semibold truncate max-w-[130px]">{role.role_name}</span>
                        {role.is_system && <Crown className="w-3 h-3 text-[rgb(var(--warn))] shrink-0" />}
                      </div>
                    </td>
                    {catalogModules.map((m) => {
                      const hasApprove = permSet.has(`${m.module}.approve`);
                      const hasEdit = permSet.has(`${m.module}.edit`) || permSet.has(`${m.module}.create`);
                      const hasView = permSet.has(`${m.module}.view`);
                      const color = hasApprove
                        ? ACTION_META.approve.color
                        : hasEdit
                        ? ACTION_META.edit.color
                        : hasView
                        ? ACTION_META.view.color
                        : null;
                      return (
                        <td key={m.module} className="p-[0_4px] h-[48px] text-center">
                          {color ? (
                            <span
                              className="inline-block w-2.5 h-2.5 rounded-full"
                              style={{ background: color }}
                            />
                          ) : (
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[rgb(var(--text)/0.1)]" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t border-[rgb(var(--border-c))] micro">
          {catalogModules.length} modules · click a role row to open the editor
        </div>
      </div>

      {/* Role editor drawer */}
      {selectedRoleId && (
        <RoleEditorDrawer
          roleId={selectedRoleId}
          catalog={catalogModules}
          canEdit={canEdit}
          onClose={() => setSelectedRoleId(null)}
        />
      )}

      {/* New role drawer */}
      {showNewRole && (
        <NewRoleDrawer
          onClose={() => setShowNewRole(false)}
          onCreated={(r) => {
            qc.invalidateQueries({ queryKey: ["roles"] });
            setShowNewRole(false);
            setSelectedRoleId(r.role_id);
          }}
        />
      )}
    </div>
  );
}

// ╔════════════════════════════════════════════════════════════╗
// ║  TAB 3 — WORKFLOWS                                          ║
// ╚════════════════════════════════════════════════════════════╝

const TRIGGER_ACTIONS = ["submit", "create", "approve", "edit", "delete"];
const MODULE_KEYS = [
  "sales","crm","pos","stock","catalogue","logistics","purchasing","production",
  "retail_partners","invoicing","accounting","expenses","pricing","cash_request",
  "hr_payroll","contacts","retention","campaigns","social","marketing",
  "praxis_ai","settings","documents","ai_governance","org_workflow",
];

function StageEditor({
  stage,
  onChange,
  onRemove,
  index,
}: {
  stage: WorkflowStage;
  onChange: (s: WorkflowStage) => void;
  onRemove: () => void;
  index: number;
}) {
  const [condType, setCondType] = useState<"none" | "lte" | "gt" | "range">(
    stage.threshold_ngn_lte != null && stage.threshold_ngn_gt != null
      ? "range"
      : stage.threshold_ngn_lte != null
      ? "lte"
      : stage.threshold_ngn_gt != null
      ? "gt"
      : "none",
  );

  function updateApprover(i: number, field: "type" | "value", val: string) {
    const approvers = [...stage.approvers];
    approvers[i] = { ...approvers[i], [field]: val } as WorkflowStage["approvers"][number];
    onChange({ ...stage, approvers });
  }

  function addApprover() {
    onChange({ ...stage, approvers: [...stage.approvers, { type: "role", value: "" }] });
  }

  function removeApprover(i: number) {
    onChange({ ...stage, approvers: stage.approvers.filter((_, idx) => idx !== i) });
  }

  function setCondition(type: typeof condType, lte?: number, gt?: number) {
    setCondType(type);
    const patch: Partial<WorkflowStage> = {
      threshold_field: type !== "none" ? "total_ngn" : undefined,
      threshold_ngn_lte: type === "lte" || type === "range" ? lte : undefined,
      threshold_ngn_gt: type === "gt" || type === "range" ? gt : undefined,
    };
    onChange({ ...stage, ...patch });
  }

  return (
    <div className="glass rounded-[var(--radius)] shadow-glass p-4 space-y-3 relative">
      <div className="flex items-center justify-between mb-1">
        <div className="micro">Stage {index + 1}</div>
        <button onClick={onRemove} className="text-[rgb(var(--danger))] hover:bg-[rgb(var(--danger)/0.1)] p-1 rounded-lg transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Name */}
      <div>
        <label className="micro block mb-1">Stage name (optional)</label>
        <input
          className="w-full bg-[rgb(var(--panel-2)/0.6)] border border-[rgb(var(--border-c))] rounded-xl px-3 py-2 text-[13px] focus:outline-none focus:border-[rgb(var(--accent)/0.5)]"
          value={stage.name ?? ""}
          onChange={(e) => onChange({ ...stage, name: e.target.value || undefined })}
          placeholder="e.g. Manager approval"
        />
      </div>

      {/* Approvers */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="micro">Approvers</label>
          <button onClick={addApprover} className="text-[10px] text-[rgb(var(--accent))] hover:underline">+ Add</button>
        </div>
        <div className="space-y-2">
          {stage.approvers.map((app, i) => (
            <div key={i} className="flex gap-2">
              <select
                value={app.type}
                onChange={(e) => updateApprover(i, "type", e.target.value)}
                className="bg-[rgb(var(--panel-2)/0.6)] border border-[rgb(var(--border-c))] rounded-lg px-2 py-1.5 text-[12px] focus:outline-none focus:border-[rgb(var(--accent)/0.5)]"
              >
                <option value="role">Role</option>
                <option value="position">Position</option>
                <option value="user">User</option>
              </select>
              <input
                className="flex-1 bg-[rgb(var(--panel-2)/0.6)] border border-[rgb(var(--border-c))] rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-[rgb(var(--accent)/0.5)]"
                value={app.value}
                onChange={(e) => updateApprover(i, "value", e.target.value)}
                placeholder={app.type === "role" ? "e.g. manager" : app.type === "position" ? "e.g. head_of_finance" : "user_id"}
              />
              <button onClick={() => removeApprover(i)} className="text-[rgb(var(--danger))] p-1 rounded-lg hover:bg-[rgb(var(--danger)/0.1)] transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Condition */}
      <div>
        <label className="micro block mb-1.5">Threshold condition</label>
        <div className="flex flex-wrap gap-2">
          {(["none", "lte", "gt", "range"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setCondition(t, stage.threshold_ngn_lte, stage.threshold_ngn_gt)}
              className={cn(
                "text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-colors",
                condType === t
                  ? "bg-[rgb(var(--accent)/0.15)] border-[rgb(var(--accent)/0.5)] text-[rgb(var(--accent-glow))]"
                  : "border-[rgb(var(--border-c))] text-[rgb(var(--text-muted))] hover:border-[rgb(var(--text)/0.3)]",
              )}
            >
              {t === "none" ? "Always applies" : t === "lte" ? "Amount ≤" : t === "gt" ? "Amount >" : "Amount between"}
            </button>
          ))}
        </div>
        {condType !== "none" && (
          <div className="flex gap-3 mt-2 flex-wrap">
            {(condType === "lte" || condType === "range") && (
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] text-[rgb(var(--text-muted))]">≤ ₦</span>
                <input
                  type="number"
                  min={0}
                  className="w-28 bg-[rgb(var(--panel-2)/0.6)] border border-[rgb(var(--border-c))] rounded-lg px-2 py-1 text-[12px] font-mono focus:outline-none"
                  value={stage.threshold_ngn_lte ?? ""}
                  onChange={(e) => onChange({ ...stage, threshold_field: "total_ngn", threshold_ngn_lte: parseFloat(e.target.value) || undefined })}
                />
              </div>
            )}
            {(condType === "gt" || condType === "range") && (
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] text-[rgb(var(--text-muted))]">{condType === "range" ? "and >" : ">"} ₦</span>
                <input
                  type="number"
                  min={0}
                  className="w-28 bg-[rgb(var(--panel-2)/0.6)] border border-[rgb(var(--border-c))] rounded-lg px-2 py-1 text-[12px] font-mono focus:outline-none"
                  value={stage.threshold_ngn_gt ?? ""}
                  onChange={(e) => onChange({ ...stage, threshold_field: "total_ngn", threshold_ngn_gt: parseFloat(e.target.value) || undefined })}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Timeout */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="micro block mb-1">Timeout (hours)</label>
          <input
            type="number"
            min={1}
            max={720}
            className="w-full bg-[rgb(var(--panel-2)/0.6)] border border-[rgb(var(--border-c))] rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none"
            value={stage.timeout_hours ?? ""}
            onChange={(e) => onChange({ ...stage, timeout_hours: parseInt(e.target.value) || undefined })}
            placeholder="48"
          />
        </div>
        <div>
          <label className="micro block mb-1">On timeout</label>
          <select
            className="w-full bg-[rgb(var(--panel-2)/0.6)] border border-[rgb(var(--border-c))] rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none"
            value={stage.on_timeout ?? "escalate"}
            onChange={(e) => onChange({ ...stage, on_timeout: e.target.value as WorkflowStage["on_timeout"] })}
            disabled={!stage.timeout_hours}
          >
            <option value="escalate">Escalate</option>
            <option value="auto_approve">Auto-approve</option>
            <option value="auto_reject">Auto-reject</option>
          </select>
        </div>
      </div>

      {/* Deputy fallback */}
      <label className="flex items-center gap-2 cursor-pointer">
        <button type="button" onClick={() => onChange({ ...stage, fallback_to_deputy: !stage.fallback_to_deputy })}>
          {stage.fallback_to_deputy
            ? <ToggleRight className="w-5 h-5 text-[rgb(var(--info))]" />
            : <ToggleLeft className="w-5 h-5 text-[rgb(var(--text-muted))]" />}
        </button>
        <span className="text-[12.5px]">Fallback to deputy if approver unavailable</span>
      </label>
    </div>
  );
}

function WorkflowBuilderDrawer({
  initial,
  onClose,
  onSaved,
}: {
  initial?: WorkflowDefinition;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [triggerModule, setTriggerModule] = useState(initial?.trigger_module ?? "");
  const [triggerAction, setTriggerAction] = useState(initial?.trigger_action ?? "submit");
  const [stages, setStages] = useState<WorkflowStage[]>(initial?.definition.stages ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addStage() {
    setStages((prev) => [
      ...prev,
      { order: prev.length + 1, approvers: [{ type: "role", value: "" }] },
    ]);
  }

  function updateStage(i: number, s: WorkflowStage) {
    setStages((prev) => prev.map((st, idx) => (idx === i ? { ...s, order: idx + 1 } : st)));
  }

  function removeStage(i: number) {
    setStages((prev) => prev.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, order: idx + 1 })));
  }

  function moveStage(i: number, dir: -1 | 1) {
    const next = [...stages];
    const target = i + dir;
    if (target < 0 || target >= next.length) return;
    [next[i], next[target]] = [next[target], next[i]];
    setStages(next.map((s, idx) => ({ ...s, order: idx + 1 })));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    // Note: the backend only supports PATCH for is_active on existing workflows.
    // Creating a new version with updated stages requires a new POST.
    // If editing an existing workflow, we create a new one and deactivate the old.
    try {
      await orgApi.createDefinition({
        name: name.trim(),
        description: description.trim() || undefined,
        trigger_module: triggerModule,
        trigger_action: triggerAction,
        definition: { stages },
      });
      if (initial) {
        // Deactivate old definition after creating the replacement.
        await orgApi.setDefinitionActive(initial.workflow_id, false);
      }
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      wide
      title={initial ? `Edit: ${initial.name}` : "New workflow"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!name.trim() || !triggerModule || stages.length === 0 || saving}
            onClick={handleSave}
          >
            {saving ? "Saving…" : initial ? "Save as new version" : "Create workflow"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {initial && (
          <div className="p-3 rounded-xl bg-[rgb(var(--warn)/0.08)] border border-[rgb(var(--warn)/0.25)] text-[12px] text-[rgb(var(--warn))]">
            Editing creates a new workflow definition and deactivates this one.
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="micro block mb-1.5">Name</label>
            <input
              className="w-full bg-[rgb(var(--panel-2)/0.6)] border border-[rgb(var(--border-c))] rounded-xl px-3.5 py-2.5 text-[13px] focus:outline-none focus:border-[rgb(var(--accent)/0.5)]"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Expense approval"
            />
          </div>
          <div>
            <label className="micro block mb-1.5">Trigger module</label>
            <select
              className="w-full bg-[rgb(var(--panel-2)/0.6)] border border-[rgb(var(--border-c))] rounded-xl px-3.5 py-2.5 text-[13px] focus:outline-none focus:border-[rgb(var(--accent)/0.5)]"
              value={triggerModule}
              onChange={(e) => setTriggerModule(e.target.value)}
            >
              <option value="">— Select module —</option>
              {MODULE_KEYS.map((k) => <option key={k} value={k}>{MODULE_LABELS[k] ?? k}</option>)}
            </select>
          </div>
          <div>
            <label className="micro block mb-1.5">Trigger action</label>
            <select
              className="w-full bg-[rgb(var(--panel-2)/0.6)] border border-[rgb(var(--border-c))] rounded-xl px-3.5 py-2.5 text-[13px] focus:outline-none focus:border-[rgb(var(--accent)/0.5)]"
              value={triggerAction}
              onChange={(e) => setTriggerAction(e.target.value)}
            >
              {TRIGGER_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="micro block mb-1.5">Description (optional)</label>
            <input
              className="w-full bg-[rgb(var(--panel-2)/0.6)] border border-[rgb(var(--border-c))] rounded-xl px-3.5 py-2.5 text-[13px] focus:outline-none focus:border-[rgb(var(--accent)/0.5)]"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="When does this trigger?"
            />
          </div>
        </div>

        {/* Stages */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="micro">Approval stages</div>
            <Button size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={addStage}>Add stage</Button>
          </div>
          {stages.length === 0 ? (
            <div className="py-8 text-center border border-dashed border-[rgb(var(--border-c))] rounded-xl text-[rgb(var(--text-faint))] text-sm">
              Add at least one approval stage
            </div>
          ) : (
            <div className="space-y-3">
              {stages.map((stage, i) => (
                <div key={i} className="relative">
                  <div className="flex gap-1 mb-1 justify-end">
                    <button disabled={i === 0} onClick={() => moveStage(i, -1)} className="text-[10px] px-1.5 py-0.5 rounded disabled:opacity-30 hover:bg-[rgb(var(--text)/0.07)]">▲</button>
                    <button disabled={i === stages.length - 1} onClick={() => moveStage(i, 1)} className="text-[10px] px-1.5 py-0.5 rounded disabled:opacity-30 hover:bg-[rgb(var(--text)/0.07)]">▼</button>
                  </div>
                  <StageEditor
                    stage={stage}
                    index={i}
                    onChange={(s) => updateStage(i, s)}
                    onRemove={() => removeStage(i)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <p className="text-[rgb(var(--danger))] text-sm">{error}</p>}
      </div>
    </Drawer>
  );
}

function WorkflowsTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);
  const [builderOpen, setBuilderOpen] = useState<WorkflowDefinition | "new" | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["workflow-definitions", showInactive],
    queryFn: () => orgApi.listDefinitions(showInactive),
  });

  const definitions = Array.isArray(data) ? data : [];

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => orgApi.setDefinitionActive(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workflow-definitions"] }),
  });

  const triggerLabel = (m: string, a: string) => `${MODULE_LABELS[m] ?? m} · ${a}`;

  const wfColumns: Column<WorkflowDefinition>[] = [
    { key: "name", header: "Name", render: (w) => <span className="text-[13px] font-semibold">{w.name}</span> },
    { key: "trigger", header: "Trigger", render: (w) => <span className="font-mono text-[11px] text-[rgb(var(--text-muted))]">{triggerLabel(w.trigger_module, w.trigger_action)}</span> },
    { key: "stages", header: "Stages", render: (w) => <span className="text-[13px]">{w.definition.stages.length}</span> },
    { key: "status", header: "Status", render: (w) => <Pill tone={w.is_active ? "success" : "neutral"}>{w.is_active ? "Active" : "Inactive"}</Pill> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (w) => (
        <div className="flex items-center justify-end gap-2">
          {canEdit && (
            <>
              <Button size="sm" icon={<Pencil className="w-3 h-3" />} onClick={(e) => { e.stopPropagation(); setBuilderOpen(w); }}>Edit</Button>
              <button
                onClick={(e) => { e.stopPropagation(); toggleMutation.mutate({ id: w.workflow_id, active: !w.is_active }); }}
                className="text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text))] transition-colors"
                title={w.is_active ? "Deactivate" : "Activate"}
              >
                {w.is_active ? <ToggleRight className="w-5 h-5 text-[rgb(var(--success))]" /> : <ToggleLeft className="w-5 h-5" />}
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  if (error) return (
    <div className="py-12 text-center">
      <AlertTriangle className="w-8 h-8 text-[rgb(var(--danger))] mx-auto mb-3" />
      <p className="text-[rgb(var(--text-muted))]">Failed to load workflows.</p>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <label className="flex items-center gap-2 cursor-pointer text-[13px]">
          <button type="button" onClick={() => setShowInactive((v) => !v)}>
            {showInactive ? <ToggleRight className="w-5 h-5 text-[rgb(var(--accent-glow))]" /> : <ToggleLeft className="w-5 h-5 text-[rgb(var(--text-muted))]" />}
          </button>
          Show inactive
        </label>
        {canEdit && (
          <Button variant="primary" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setBuilderOpen("new")}>
            New Workflow
          </Button>
        )}
      </div>

      <DataTable
        columns={wfColumns}
        rows={definitions}
        rowKey={(w) => w.workflow_id}
        loading={isLoading}
        empty={{
          icon: <Workflow className="w-8 h-8" />,
          title: "No workflow definitions",
          message: "Create the first approval workflow for this business.",
          action: canEdit ? <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setBuilderOpen("new")}>New Workflow</Button> : undefined,
        }}
      />

      {builderOpen !== null && (
        <WorkflowBuilderDrawer
          initial={builderOpen === "new" ? undefined : builderOpen}
          onClose={() => setBuilderOpen(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["workflow-definitions"] });
            setBuilderOpen(null);
          }}
        />
      )}
    </div>
  );
}

// ╔════════════════════════════════════════════════════════════╗
// ║  TAB 4 — PENDING APPROVALS                                  ║
// ╚════════════════════════════════════════════════════════════╝

function ApprovalDrawer({
  instance,
  canAct,
  onClose,
  onActed,
}: {
  instance: WorkflowInstance;
  canAct: boolean;
  onClose: () => void;
  onActed: () => void;
}) {
  const [actAction, setActAction] = useState<"approve" | "reject" | "request_changes" | null>(null);
  const [notes, setNotes] = useState("");
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: full, isLoading } = useQuery({
    queryKey: ["workflow-instance", instance.instance_id],
    queryFn: () => orgApi.getInstance(instance.instance_id),
  });

  const inst = full ?? instance;

  async function handleAct() {
    if (!actAction) return;
    setActing(true);
    setError(null);
    try {
      await orgApi.act(instance.instance_id, actAction, notes.trim() || undefined);
      onActed();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActing(false);
    }
  }

  const statusTone: Record<string, Tone> = {
    pending: "warn",
    approved: "success",
    rejected: "danger",
    cancelled: "neutral",
  };

  const decisions = inst.decisions ?? [];
  const timelineSteps = [
    {
      state: "done" as const,
      title: `Submitted by ${inst.initiated_by.name}`,
      detail: new Date(inst.initiated_at).toLocaleString(),
    },
    ...decisions.map((d) => ({
      state: "done" as const,
      title: `Stage ${d.stage}: ${d.action.replace("_", " ")} by ${d.actor_name ?? ""}`,
      detail: `${new Date(d.decided_at).toLocaleString()}${d.notes ? ` · "${d.notes}"` : ""}`,
    })),
    ...(inst.status === "pending"
      ? [{
          state: "current" as const,
          title: `Stage ${inst.current_stage}: awaiting approval`,
          detail: inst.requires_ceo ? "Requires CEO" : inst.stage_timeout_at ? `Deadline: ${new Date(inst.stage_timeout_at).toLocaleString()}` : "",
        }]
      : [{
          state: inst.status === "approved" ? "done" : "error" as const,
          title: inst.status === "approved" ? "Approved" : inst.status === "rejected" ? "Rejected" : "Cancelled",
          detail: inst.completed_at ? new Date(inst.completed_at).toLocaleString() : "",
        }]),
  ];

  return (
    <Drawer
      open
      onClose={onClose}
      wide
      title={inst.workflow_name}
      subtitle={`${inst.trigger.module} · ${inst.trigger.action}`}
    >
      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-5">
          {/* Status + reference */}
          <div className="flex flex-wrap items-center gap-3">
            <Pill tone={statusTone[inst.status] ?? "neutral"}>{inst.status}</Pill>
            {inst.requires_ceo && <Pill tone="accent">CEO required</Pill>}
            <span className="font-mono text-[11px] text-[rgb(var(--text-faint))]">{inst.reference.table}#{inst.reference.id.slice(0, 8)}</span>
          </div>

          {/* Context */}
          {Object.keys(inst.context).length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(inst.context).map(([k, v]) => (
                <div key={k} className="bg-[rgb(var(--text)/0.03)] rounded-xl p-3 border border-[rgb(var(--border-c))]">
                  <div className="micro mb-0.5">{k}</div>
                  <div className="text-[13px] font-semibold font-mono">{String(v)}</div>
                </div>
              ))}
            </div>
          )}

          {/* Timeline */}
          <div>
            <div className="micro mb-3">Approval timeline</div>
            <Timeline steps={timelineSteps} />
          </div>

          {/* Act buttons */}
          {canAct && inst.can_act && inst.status === "pending" && (
            <div className="space-y-3 pt-2 border-t border-[rgb(var(--border-c))]">
              <div className="micro">Take action</div>
              {actAction ? (
                <div className="space-y-3">
                  <textarea
                    rows={3}
                    className="w-full bg-[rgb(var(--panel-2)/0.6)] border border-[rgb(var(--border-c))] rounded-xl px-3.5 py-2.5 text-[13px] resize-none focus:outline-none focus:border-[rgb(var(--accent)/0.5)]"
                    placeholder="Notes (optional)…"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                  {error && <p className="text-[rgb(var(--danger))] text-sm">{error}</p>}
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => setActAction(null)}>Cancel</Button>
                    <Button
                      variant={actAction === "approve" ? "primary" : "danger"}
                      disabled={acting}
                      onClick={handleAct}
                    >
                      {acting ? "Processing…" : actAction === "approve" ? "Confirm Approve" : actAction === "reject" ? "Confirm Reject" : "Send for Changes"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" icon={<CheckCircle2 className="w-4 h-4" />} onClick={() => setActAction("approve")}>Approve</Button>
                  <Button variant="danger" icon={<XCircle className="w-4 h-4" />} onClick={() => setActAction("reject")}>Reject</Button>
                  <Button icon={<MessageSquare className="w-4 h-4" />} onClick={() => setActAction("request_changes")}>Request changes</Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

function PendingTab({ canAct }: { canAct: boolean }) {
  const qc = useQueryClient();
  const [selectedInstance, setSelectedInstance] = useState<WorkflowInstance | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["pending-approvals"],
    queryFn: () => orgApi.listPending(),
    refetchInterval: 60_000,
  });

  const instances = Array.isArray(data) ? data : [];

  const statusTone: Record<string, Tone> = { pending: "warn", approved: "success", rejected: "danger", cancelled: "neutral" };

  const columns: Column<WorkflowInstance>[] = [
    {
      key: "ref",
      header: "Reference",
      render: (w) => (
        <div>
          <div className="font-mono text-[11px] text-[rgb(var(--accent-glow))]">{w.trigger.module} · {w.trigger.action}</div>
          <div className="font-mono text-[10px] text-[rgb(var(--text-faint))]">{w.reference.id.slice(0, 12)}…</div>
        </div>
      ),
    },
    { key: "workflow", header: "Workflow", render: (w) => <span className="text-[13px]">{w.workflow_name}</span> },
    { key: "stage", header: "Stage", render: (w) => <span className="text-[13px]">{w.current_stage}</span> },
    {
      key: "submitted",
      header: "By / When",
      render: (w) => (
        <div>
          <div className="text-[12px]">{w.initiated_by.name}</div>
          <div className="text-[10px] text-[rgb(var(--text-faint))]">{new Date(w.initiated_at).toLocaleDateString()}</div>
        </div>
      ),
    },
    {
      key: "ceo",
      header: "CEO req.",
      render: (w) => w.requires_ceo ? <Pill tone="accent">CEO</Pill> : <span className="text-[rgb(var(--text-faint))] text-xs">—</span>,
    },
    { key: "status", header: "Status", render: (w) => <Pill tone={statusTone[w.status] ?? "neutral"}>{w.status}</Pill> },
  ];

  if (error) return (
    <div className="py-12 text-center">
      <AlertTriangle className="w-8 h-8 text-[rgb(var(--danger))] mx-auto mb-3" />
      <p className="text-[rgb(var(--text-muted))]">Failed to load approvals.</p>
      <Button size="sm" className="mt-3" onClick={() => refetch()}>Retry</Button>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="micro">{instances.length} pending approval{instances.length !== 1 ? "s" : ""}</div>
        <Button size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={() => refetch()}>Refresh</Button>
      </div>

      <DataTable
        columns={columns}
        rows={instances}
        rowKey={(w) => w.instance_id}
        onRowClick={setSelectedInstance}
        loading={isLoading}
        empty={{
          icon: <Clock className="w-8 h-8" />,
          title: "Nothing pending",
          message: "All approval requests have been actioned.",
        }}
      />

      {selectedInstance && (
        <ApprovalDrawer
          instance={selectedInstance}
          canAct={canAct}
          onClose={() => setSelectedInstance(null)}
          onActed={() => {
            qc.invalidateQueries({ queryKey: ["pending-approvals"] });
            setSelectedInstance(null);
          }}
        />
      )}
    </div>
  );
}

// ╔════════════════════════════════════════════════════════════╗
// ║  ROOT PAGE                                                  ║
// ╚════════════════════════════════════════════════════════════╝

export function OrgWorkflowPage() {
  const { can, user } = useAuthStore();
  const [tab, setTab] = useState<Tab>("org");

  const tabLabels: Record<Tab, string> = { org: "Org Chart", permissions: "Permissions", workflows: "Workflows", pending: "Pending" };
  useBreadcrumbs([{ label: "Org & Workflow", href: "/org-workflow" }, { label: tabLabels[tab] }]);

  const { data: pendingMeta } = useQuery({
    queryKey: ["pending-approvals-count"],
    queryFn: async () => {
      const res = await orgApi.listPending();
      return Array.isArray(res) ? res.length : 0;
    },
    refetchInterval: 60_000,
    enabled: can("org_workflow", "view"),
  });

  if (!user) return null;
  if (!can("org_workflow", "view")) return <PermDenied />;

  const canEdit = can("org_workflow", "edit") || can("org_workflow", "create");
  const canAct  = can("org_workflow", "approve");

  return (
    <div>
      <TabBar active={tab} onChange={setTab} pendingCount={pendingMeta ?? 0} />

      {tab === "org"         && <OrgTab canEdit={canEdit} />}
      {tab === "permissions" && <PermissionsTab canEdit={canEdit} />}
      {tab === "workflows"   && <WorkflowsTab canEdit={canEdit} />}
      {tab === "pending"     && <PendingTab canAct={canAct} />}
    </div>
  );
}
