import { useState, lazy, Suspense } from "react";
import { Tag, Shield, ClipboardList, Calculator, Lock, AlertTriangle, Plus } from "lucide-react";
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
import { RULE_TYPE_LABELS, RULE_TYPE_OPTIONS, FLOOR_TYPE_LABELS, FLOOR_TYPE_OPTIONS } from "./constants";
import type { PricingRule, PriceFloor, RuleType, FloorType, CreateRuleInput, UpdateRuleInput, CreateFloorInput } from "./types";

const ProposalsTable = lazy(() => import("./ProposalsTable").then((m) => ({ default: m.ProposalsTable })));

type Tab = "workbench" | "rules" | "floors" | "proposals";

export function PricingPage() {
  useBreadcrumbs([{ label: "Pricing Engine" }]);
  const can = useAuthStore((s) => s.can);
  const isCeo = useAuthStore((s) => s.user?.isCeo ?? false);
  const [tab, setTab] = useState<Tab>("workbench");

  if (!can("pricing", "view")) {
    return (
      <div className="py-20">
        <EmptyState icon={<Lock className="w-8 h-8" />} title="Access restricted" message="You don't have permission to view the Pricing Engine." />
      </div>
    );
  }

  const tabs = [
    { key: "workbench" as Tab, label: "Workbench", icon: <Calculator className="w-4 h-4" /> },
    { key: "rules" as Tab, label: "Rules", icon: <Tag className="w-4 h-4" /> },
    { key: "floors" as Tab, label: "Price Floors", icon: <Shield className="w-4 h-4" /> },
    { key: "proposals" as Tab, label: "Proposals", icon: <ClipboardList className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-medium">Pricing Engine</h1>
          <p className="text-text-muted text-sm mt-0.5">Goal-seek · channel gross-up · floor guards · CEO approval</p>
        </div>
      </div>

      <PricingKpiStrip />

      <div className="flex gap-1 p-1 glass rounded-2xl overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn("flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold whitespace-nowrap transition-all", tab === t.key ? "bg-accent-deep text-[#F4E9D9] shadow-md" : "text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05]")}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "workbench" && <PricingWorkbench />}
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

function PricingKpiStrip() {
  const rules = usePricingRules({ is_active: true });
  const proposals = useProposals({ status: "pending_approval" });
  const floors = usePriceFloors();

  if (rules.isLoading) {
    return <div className="grid grid-cols-3 gap-4">{[1, 2, 3].map((i) => <Card key={i} className="p-5"><Skeleton className="w-20 mb-3" /><Skeleton className="w-16 h-7" /></Card>)}</div>;
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      <KpiTile label="Active Rules" value={String(rules.data?.total ?? 0)} tone="accent" />
      <KpiTile label="Pending Proposals" value={String(proposals.data?.total ?? 0)} tone={proposals.data?.total ? "warn" : "neutral"} />
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
    { key: "name", header: "Rule Name", render: (r) => <span className="font-semibold text-[13px]">{r.rule_name}</span> },
    { key: "type", header: "Type", width: "150px", render: (r) => <span className="text-text-muted text-xs">{RULE_TYPE_LABELS[r.rule_type]}</span> },
    { key: "channel", header: "Channel", width: "130px", render: (r) => <span className="font-mono text-xs text-text-faint capitalize">{r.channel ?? "All"}</span> },
    { key: "value", header: "Value", align: "right", width: "120px", render: (r) => (
        <span className="font-mono text-[13px]">
          {r.rule_type === "fixed_price" && r.rule_value ? `₦${r.rule_value}` : r.rule_value ? `${r.rule_value}%` : "—"}
        </span>
      )
    },
    { key: "priority", header: "Priority", align: "right", width: "80px", render: (r) => <span className="font-mono text-xs">{r.priority}</span> },
    { key: "status", header: "Status", width: "100px", render: (r) => <Pill tone={r.is_active ? "success" : "neutral"}>{r.is_active ? "Active" : "Inactive"}</Pill> },
  ];

  if (isError) return <EmptyState icon={<AlertTriangle className="w-7 h-7" />} title="Failed to load" action={<Button size="sm" onClick={() => refetch()}>Retry</Button>} />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {canEdit && <Button size="sm" variant="primary" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowCreate(true)}>New Rule</Button>}
      </div>
      <DataTable columns={cols} rows={data?.data ?? []} rowKey={(r) => r.rule_id} onRowClick={canEdit ? setSelected : undefined} loading={isLoading} empty={{ icon: <Tag className="w-7 h-7" />, title: "No pricing rules", message: "Define rules to automate pricing." }} />
      <RuleDrawer open={showCreate || !!selected} rule={selected} onClose={() => { setShowCreate(false); setSelected(null); }} onCreate={(input: CreateRuleInput) => create.mutate(input, { onSuccess: () => setShowCreate(false) })} onUpdate={(id: string, input: UpdateRuleInput) => update.mutate({ id, input }, { onSuccess: () => setSelected(null) })} saving={create.isPending || update.isPending} />
    </div>
  );
}

function RuleDrawer({ open, rule, onClose, onCreate, onUpdate, saving }: any) {
  const [name, setName] = useState(rule?.rule_name ?? "");
  const [ruleType, setRuleType] = useState<RuleType>(rule?.rule_type ?? "target_margin_pct");
  const [value, setValue] = useState(String(rule?.rule_value ?? ""));
  const [priority, setPriority] = useState(String(rule?.priority ?? 10));
  const [isActive, setIsActive] = useState(rule?.is_active ?? true);

  const handleSubmit = () => {
    if (!name || !value) return;
    const payload = {
      rule_name: name,
      rule_type: ruleType,
      rule_value: parseFloat(value),
      priority: parseInt(priority) || 10,
    };
    if (rule) onUpdate(rule.rule_id, { ...payload, is_active: isActive });
    else onCreate(payload);
  };

  return (
    <Drawer open={open} onClose={onClose} title={rule ? "Edit Rule" : "New Pricing Rule"} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={saving || !name} onClick={handleSubmit}>{saving ? "Saving…" : "Save"}</Button></>}>
      <div className="space-y-4">
        <Field label="Rule Name"><input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50" /></Field>
        <Field label="Rule Type"><Select value={ruleType} onChange={setRuleType} options={RULE_TYPE_OPTIONS} /></Field>
        <Field label={ruleType === "fixed_price" ? "Price (₦)" : "Value (%)"}><NumberField value={value} onChange={setValue} suffix={ruleType === "fixed_price" ? "₦" : "%"} /></Field>
        <Field label="Priority (lower = higher priority)"><NumberField value={priority} onChange={setPriority} /></Field>
        {rule && <div className="flex items-center gap-2"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} id="rule-active" className="accent-accent-deep w-4 h-4" /><label htmlFor="rule-active" className="text-[13px]">Active</label></div>}
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
    { key: "reason", header: "Description", render: (r) => <span className="font-semibold text-[13px]">{r.reason || "—"}</span> },
    { key: "type", header: "Type", width: "160px", render: (r) => <span className="text-text-muted text-xs">{FLOOR_TYPE_LABELS[r.floor_type]}</span> },
    { key: "value", header: "Floor Value", align: "right", width: "150px", render: (r) => (
        <span className="font-mono text-[13px]">
          {r.floor_type === "min_price_ngn" ? <MoneyText ngn={r.floor_value} /> : `${r.floor_value}%`}
        </span>
      )
    },
    { key: "status", header: "Status", width: "100px", render: (r) => <Pill tone={r.is_active ? "success" : "neutral"}>{r.is_active ? "Active" : "Inactive"}</Pill> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">{canEdit && <Button size="sm" variant="primary" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowCreate(true)}>New Floor</Button>}</div>
      <DataTable columns={cols} rows={data?.data ?? []} rowKey={(r) => r.floor_id} loading={isLoading} empty={{ icon: <Shield className="w-7 h-7" />, title: "No price floors", message: "Set minimum limits." }} />
      {isError && <EmptyState icon={<AlertTriangle className="w-7 h-7" />} title="Failed to load" action={<Button size="sm" onClick={() => refetch()}>Retry</Button>} />}
      <Drawer open={showCreate} onClose={() => setShowCreate(false)} title="New Price Floor" footer={<><Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button><Button variant="primary" form="floor-form" type="submit">Create Floor</Button></>}>
        <FloorForm onSubmit={(input: CreateFloorInput) => create.mutate(input, { onSuccess: () => setShowCreate(false) })} />
      </Drawer>
    </div>
  );
}

function FloorForm({ onSubmit }: { onSubmit: (input: CreateFloorInput) => void }) {
  const [reason, setReason] = useState("");
  const [floorType, setFloorType] = useState<FloorType>("min_price_ngn");
  const [value, setValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value) return;
    onSubmit({ floor_type: floorType, floor_value: parseFloat(value), reason: reason || undefined });
  };

  return (
    <form className="space-y-4" id="floor-form" onSubmit={handleSubmit}>
      <Field label="Description / Reason"><input type="text" value={reason} onChange={(e) => setReason(e.target.value)} className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50" placeholder="e.g. Base import cost threshold" /></Field>
      <Field label="Type"><Select value={floorType} onChange={setFloorType} options={FLOOR_TYPE_OPTIONS} /></Field>
      <Field label={floorType === "min_price_ngn" ? "Amount (₦)" : "Percentage (%)"}><NumberField value={value} onChange={setValue} suffix={floorType === "min_price_ngn" ? "₦" : "%"} /></Field>
    </form>
  );
}
