import { useState, lazy, Suspense } from "react";
import {
  Tag,
  Shield,
  ClipboardList,
  Calculator,
  Lock,
  AlertTriangle,
  Plus,
} from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { Button, Card, EmptyState, KpiTile, Pill, Skeleton, MoneyText } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { Field } from "@/components/ui/Form";
import { NumberField, Select } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import { PricingWorkbench } from "./PricingWorkbench";
import { usePricingRules, usePriceFloors, useProposals, usePricingRuleMutations, usePriceFloorMutations } from "./hooks";
import { RULE_TYPE_LABELS, RULE_TYPE_OPTIONS, FLOOR_TYPE_OPTIONS } from "./constants";
import type { PricingRule, PriceFloor, SavedScenario } from "./types";

const ProposalsTable = lazy(() => import("./ProposalsTable").then((m) => ({ default: m.ProposalsTable })));

type Tab = "workbench" | "rules" | "floors" | "proposals";

export function PricingPage() {
  useBreadcrumbs([{ label: "Pricing Engine" }]);
  const can = useAuthStore((s) => s.can);
  const isCeo = useAuthStore((s) => s.user?.isCeo ?? false);

  const [tab, setTab] = useState<Tab>("workbench");
  const [, setScenarios] = useState<SavedScenario[]>([]);

  if (!can("pricing", "view")) {
    return (
      <div className="py-20">
        <EmptyState
          icon={<Lock className="w-8 h-8" />}
          title="Access restricted"
          message="You don't have permission to view the Pricing Engine."
        />
      </div>
    );
  }

  const tabs: { key: Tab; label: string; icon: React.ReactNode; show: boolean }[] = [
    { key: "workbench", label: "Workbench", icon: <Calculator className="w-4 h-4" />, show: true },
    { key: "rules", label: "Rules", icon: <Tag className="w-4 h-4" />, show: true },
    { key: "floors", label: "Price Floors", icon: <Shield className="w-4 h-4" />, show: true },
    { key: "proposals", label: "Proposals", icon: <ClipboardList className="w-4 h-4" />, show: true },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-medium">Pricing Engine</h1>
          <p className="text-text-muted text-sm mt-0.5">
            Goal-seek · channel gross-up · floor guards · CEO approval
          </p>
        </div>
      </div>

      {/* KPI strip */}
      <PricingKpiStrip />

      {/* Tab bar */}
      <div className="flex gap-1 p-1 glass rounded-2xl overflow-x-auto">
        {tabs.filter((t) => t.show).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold whitespace-nowrap transition-all",
              tab === t.key
                ? "bg-accent-deep text-[#F4E9D9] shadow-md"
                : "text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05]",
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "workbench" && (
        <PricingWorkbench
          onSaveScenario={(s) => setScenarios((prev) => [s, ...prev])}
        />
      )}
      {tab === "rules" && <RulesTab canEdit={can("pricing", "edit")} />}
      {tab === "floors" && <FloorsTab canEdit={can("pricing", "edit")} />}
      {tab === "proposals" && (
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <ProposalsTable isCeo={isCeo} />
        </Suspense>
      )}
    </div>
  );
}

// ── KPI Strip ─────────────────────────────────────────────

function PricingKpiStrip() {
  const rules = usePricingRules({ is_active: true });
  const proposals = useProposals({ status: "pending" });
  const floors = usePriceFloors();

  if (rules.isLoading) {
    return (
      <div className="grid grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="p-5">
            <Skeleton className="w-20 mb-3" />
            <Skeleton className="w-16 h-7" />
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      <KpiTile label="Active Rules" value={String(rules.data?.total ?? 0)} tone="accent" />
      <KpiTile
        label="Pending Proposals"
        value={String(proposals.data?.total ?? 0)}
        tone={proposals.data?.total ? "warn" : "neutral"}
      />
      <KpiTile label="Price Floors" value={String(floors.data?.total ?? 0)} tone="info" />
    </div>
  );
}

// ── Rules Tab ─────────────────────────────────────────────

function RulesTab({ canEdit }: { canEdit: boolean }) {
  const { data, isLoading, isError, refetch } = usePricingRules();
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<PricingRule | null>(null);
  const { create, update } = usePricingRuleMutations();

  const cols: Column<PricingRule>[] = [
    {
      key: "name",
      header: "Rule Name",
      render: (r) => <span className="font-semibold text-[13px]">{r.name}</span>,
    },
    {
      key: "type",
      header: "Type",
      width: "150px",
      render: (r) => <span className="text-text-muted text-xs">{RULE_TYPE_LABELS[r.rule_type]}</span>,
    },
    {
      key: "applies",
      header: "Applies To",
      width: "130px",
      render: (r) => <span className="font-mono text-xs text-text-faint">{r.applies_to ?? "All"}</span>,
    },
    {
      key: "value",
      header: "Value",
      align: "right",
      width: "120px",
      render: (r) => (
        <span className="font-mono text-[13px]">
          {r.markup_pct ? `${r.markup_pct}%` :
           r.target_margin_pct ? `${r.target_margin_pct}%` :
           r.fixed_price_ngn ? `₦${r.fixed_price_ngn}` : "—"}
        </span>
      ),
    },
    {
      key: "priority",
      header: "Priority",
      align: "right",
      width: "80px",
      render: (r) => <span className="font-mono text-xs">{r.priority}</span>,
    },
    {
      key: "status",
      header: "Status",
      width: "100px",
      render: (r) => <Pill tone={r.is_active ? "success" : "neutral"}>{r.is_active ? "Active" : "Inactive"}</Pill>,
    },
  ];

  if (isError) {
    return (
      <EmptyState icon={<AlertTriangle className="w-7 h-7" />} title="Failed to load"
        action={<Button size="sm" onClick={() => refetch()}>Retry</Button>} />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {canEdit && (
          <Button size="sm" variant="primary" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowCreate(true)}>
            New Rule
          </Button>
        )}
      </div>

      <DataTable
        columns={cols}
        rows={data?.data ?? []}
        rowKey={(r) => r.pricing_rule_id}
        onRowClick={canEdit ? setSelected : undefined}
        loading={isLoading}
        empty={{
          icon: <Tag className="w-7 h-7" />,
          title: "No pricing rules",
          message: "Define markup, margin, or fixed-price rules to automate pricing.",
          action: canEdit ? (
            <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setShowCreate(true)}>
              New Rule
            </Button>
          ) : undefined,
        }}
      />

      <RuleDrawer
        open={showCreate || !!selected}
        rule={selected}
        onClose={() => { setShowCreate(false); setSelected(null); }}
        onCreate={(input) => create.mutate(input, { onSuccess: () => setShowCreate(false) })}
        onUpdate={(id, input) => update.mutate({ id, input }, { onSuccess: () => setSelected(null) })}
        saving={create.isPending || update.isPending}
      />
    </div>
  );
}

function RuleDrawer({
  open, rule, onClose, onCreate, onUpdate, saving,
}: {
  open: boolean;
  rule: PricingRule | null;
  onClose: () => void;
  onCreate: (input: Parameters<ReturnType<typeof usePricingRuleMutations>["create"]["mutate"]>[0]) => void;
  onUpdate: (id: string, input: Parameters<ReturnType<typeof usePricingRuleMutations>["update"]["mutate"]>[0]["input"]) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(rule?.name ?? "");
  const [ruleType, setRuleType] = useState(rule?.rule_type ?? "target_margin_pct");
  const [value, setValue] = useState(rule?.target_margin_pct ?? rule?.markup_pct ?? rule?.fixed_price_ngn ?? "");
  const [priority, setPriority] = useState(String(rule?.priority ?? 10));
  const [isActive, setIsActive] = useState(rule?.is_active ?? true);

  const handleSubmit = () => {
    if (!name) return;
    const base = { name, rule_type: ruleType as PricingRule["rule_type"], priority: parseInt(priority) || 10 };
    const withValue = ruleType === "target_margin_pct" ? { ...base, target_margin_pct: parseFloat(String(value)) }
      : ruleType === "markup_pct" ? { ...base, markup_pct: parseFloat(String(value)) }
      : { ...base, fixed_price_ngn: parseFloat(String(value)) };

    if (rule) {
      onUpdate(rule.pricing_rule_id, { ...withValue, is_active: isActive });
    } else {
      onCreate(withValue);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={rule ? "Edit Rule" : "New Pricing Rule"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={saving || !name} onClick={handleSubmit}>
            {saving ? "Saving…" : rule ? "Save" : "Create Rule"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Rule Name">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50" />
        </Field>
        <Field label="Rule Type">
          <Select value={ruleType} onChange={setRuleType as (v: string) => void} options={RULE_TYPE_OPTIONS} />
        </Field>
        <Field label={ruleType === "fixed_price" ? "Price (₦)" : "Value (%)"}>
          <NumberField value={String(value)} onChange={setValue} suffix={ruleType === "fixed_price" ? "₦" : "%"} />
        </Field>
        <Field label="Priority (lower = higher priority)">
          <NumberField value={priority} onChange={setPriority} />
        </Field>
        {rule && (
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} id="rule-active" className="accent-accent-deep w-4 h-4" />
            <label htmlFor="rule-active" className="text-[13px]">Active</label>
          </div>
        )}
      </div>
    </Drawer>
  );
}

// ── Floors Tab ────────────────────────────────────────────

function FloorsTab({ canEdit }: { canEdit: boolean }) {
  const { data, isLoading, isError, refetch } = usePriceFloors();
  const [showCreate, setShowCreate] = useState(false);
  const { create } = usePriceFloorMutations();

  const cols: Column<PriceFloor>[] = [
    {
      key: "name",
      header: "Floor Name",
      render: (r) => <span className="font-semibold text-[13px]">{r.name}</span>,
    },
    {
      key: "type",
      header: "Type",
      width: "160px",
      render: (r) => <span className="text-text-muted text-xs capitalize">{r.floor_type.replace(/_/g, " ")}</span>,
    },
    {
      key: "value",
      header: "Floor Value",
      align: "right",
      width: "150px",
      render: (r) =>
        r.absolute_price_ngn ? (
          <MoneyText ngn={parseFloat(r.absolute_price_ngn)} className="text-[13px]" />
        ) : r.cost_plus_pct ? (
          <span className="font-mono text-[13px]">Cost + {r.cost_plus_pct}%</span>
        ) : r.cost_plus_fixed_ngn ? (
          <span className="font-mono text-[13px]">Cost + ₦{r.cost_plus_fixed_ngn}</span>
        ) : <span className="text-text-faint">—</span>,
    },
    {
      key: "status",
      header: "Status",
      width: "100px",
      render: (r) => <Pill tone={r.is_active ? "success" : "neutral"}>{r.is_active ? "Active" : "Inactive"}</Pill>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {canEdit && (
          <Button size="sm" variant="primary" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowCreate(true)}>
            New Floor
          </Button>
        )}
      </div>
      <DataTable
        columns={cols}
        rows={data?.data ?? []}
        rowKey={(r) => r.price_floor_id}
        loading={isLoading}
        empty={{
          icon: <Shield className="w-7 h-7" />,
          title: "No price floors",
          message: "Set minimum prices to protect margins.",
          action: canEdit ? <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setShowCreate(true)}>New Floor</Button> : undefined,
        }}
      />
      {isError && <EmptyState icon={<AlertTriangle className="w-7 h-7" />} title="Failed to load" action={<Button size="sm" onClick={() => refetch()}>Retry</Button>} />}

      <Drawer
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="New Price Floor"
        footer={<>
          <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button variant="primary" form="floor-form" type="submit">Create Floor</Button>
        </>}
      >
        <FloorForm
          onSubmit={(input) => create.mutate(input, { onSuccess: () => setShowCreate(false) })}
          saving={create.isPending}
        />
      </Drawer>
    </div>
  );
}

function FloorForm({ onSubmit, saving }: { onSubmit: (input: Parameters<ReturnType<typeof usePriceFloorMutations>["create"]["mutate"]>[0]) => void; saving: boolean }) {
  const [name, setName] = useState("");
  const [floorType, setFloorType] = useState("absolute");
  const [value, setValue] = useState("");

  const handleSubmit = () => {
    if (!name) return;
    const base = { name, floor_type: floorType as PriceFloor["floor_type"] };
    const withVal = floorType === "absolute" ? { ...base, absolute_price_ngn: parseFloat(value) }
      : floorType === "cost_plus_pct" ? { ...base, cost_plus_pct: parseFloat(value) }
      : { ...base, cost_plus_fixed_ngn: parseFloat(value) };
    onSubmit(withVal);
  };

  return (
    <div className="space-y-4" id="floor-form">
      <Field label="Floor Name">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)}
          className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50" />
      </Field>
      <Field label="Type">
        <Select value={floorType} onChange={setFloorType} options={FLOOR_TYPE_OPTIONS} />
      </Field>
      <Field label={floorType === "cost_plus_pct" ? "Percentage (%)" : "Amount (₦)"}>
        <NumberField value={value} onChange={setValue} suffix={floorType === "cost_plus_pct" ? "%" : "₦"} />
      </Field>
      <Button variant="primary" disabled={saving || !name} onClick={handleSubmit} className="w-full">
        {saving ? "Creating…" : "Create Floor"}
      </Button>
    </div>
  );
}
