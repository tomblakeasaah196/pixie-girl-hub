import { useState, lazy, Suspense } from "react";
import {
  Factory,
  Package,
  Ship,
  TrendingUp,
  Plus,
  Lock,
  Globe,
  Wallet,
  AlertTriangle,
} from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import {
  Button,
  Card,
  EmptyState,
  KpiTile,
  Pill,
  Skeleton,
  MoneyText,
} from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { Field } from "@/components/ui/Form";
import { NumberField } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import {
  useFactoryAccounts,
  useShipments,
  useProductionRuns,
  useCreateProductionRun,
  useAdvanceProductionRun,
  useProductionRun,
} from "./hooks";
import { RUN_STATUS_META } from "./constants";
import type { FactoryAccount, ProductionRun } from "./types";

const FactoryAccountLedger = lazy(() =>
  import("./FactoryAccountLedger").then((m) => ({ default: m.FactoryAccountLedger })),
);
const FactoryShipmentsPanel = lazy(() =>
  import("./FactoryShipmentsPanel").then((m) => ({ default: m.FactoryShipmentsPanel })),
);

type MainTab = "overview" | "factory" | "runs";
type FactoryTab = "ledger" | "shipments";

function fmt(d: string) {
  return new Date(d).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
}

export function ProductionPage() {
  useBreadcrumbs([{ label: "Production" }]);
  const can = useAuthStore((s) => s.can);

  const [tab, setTab] = useState<MainTab>("overview");
  const [factoryTab, setFactoryTab] = useState<FactoryTab>("ledger");
  const [lang, setLang] = useState<"en" | "zh">("en");
  const [selectedAccount, setSelectedAccount] = useState<FactoryAccount | null>(null);
  const [selectedRun, setSelectedRun] = useState<ProductionRun | null>(null);
  const [showCreateRun, setShowCreateRun] = useState(false);

  if (!can("purchasing", "view")) {
    return (
      <div className="py-20">
        <EmptyState
          icon={<Lock className="w-8 h-8" />}
          title="Access restricted"
          message="You don't have permission to view Production & Factory accounts."
        />
      </div>
    );
  }

  const tabs: { key: MainTab; label: string; icon: React.ReactNode }[] = [
    { key: "overview", label: "Overview", icon: <TrendingUp className="w-4 h-4" /> },
    { key: "factory", label: "Factory Account", icon: <Wallet className="w-4 h-4" /> },
    { key: "runs", label: "Production Runs", icon: <Factory className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-medium">Production</h1>
          <p className="text-text-muted text-sm mt-0.5">
            China factory account · shipments · production runs
          </p>
        </div>
        <div className="flex gap-2">
          {/* Language toggle */}
          <button
            onClick={() => setLang((l) => (l === "en" ? "zh" : "en"))}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-[12px] font-semibold border transition-all",
              lang === "zh"
                ? "bg-accent/15 border-accent/30 text-accent-glow"
                : "border-line text-text-muted hover:text-text-primary",
            )}
          >
            <Globe className="w-3.5 h-3.5" />
            {lang === "zh" ? "中文" : "EN"}
          </button>
          {tab === "runs" && can("purchasing", "create") && (
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="w-4 h-4" />}
              onClick={() => setShowCreateRun(true)}
            >
              New Run
            </Button>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 glass rounded-2xl overflow-x-auto">
        {tabs.map((t) => (
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
      {tab === "overview" && <OverviewTab />}
      {tab === "factory" && (
        <FactoryTab
          selectedAccount={selectedAccount}
          onSelectAccount={setSelectedAccount}
          factoryTab={factoryTab}
          onFactoryTab={setFactoryTab}
          lang={lang}
        />
      )}
      {tab === "runs" && (
        <RunsTab
          onSelect={setSelectedRun}
          onCreate={() => setShowCreateRun(true)}
          canCreate={can("purchasing", "create")}
        />
      )}

      {/* Run detail drawer */}
      {selectedRun && (
        <RunDetailDrawer run={selectedRun} onClose={() => setSelectedRun(null)} />
      )}

      {/* Create run drawer */}
      <CreateRunDrawer open={showCreateRun} onClose={() => setShowCreateRun(false)} />
    </div>
  );
}

// ── Overview Tab ──────────────────────────────────────────

function OverviewTab() {
  const accounts = useFactoryAccounts();
  const shipments = useShipments({ status: "in_transit" });
  const runs = useProductionRuns({ status: "in_production" });

  const totalBalance =
    accounts.data?.reduce((sum, a) => sum + (a.current_balance_base ?? 0), 0) ?? 0;
  const activeAccounts = accounts.data?.filter((a) => a.is_active).length ?? 0;
  const inTransit = shipments.data?.total ?? 0;
  const activeRuns = runs.data?.total ?? 0;

  if (accounts.isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-5">
            <Skeleton className="w-20 mb-3" />
            <Skeleton className="w-28 h-7" />
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile
          label="Active Factory Accounts"
          value={String(activeAccounts)}
          tone="accent"
        />
        <KpiTile
          label={`Total Balance (${accounts.data?.[0]?.base_currency ?? "CNY"})`}
          value={`¥${totalBalance.toLocaleString("en", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
          tone="warn"
        />
        <KpiTile label="Shipments in Transit" value={String(inTransit)} tone="info" />
        <KpiTile label="Runs in Production" value={String(activeRuns)} tone="accent" />
      </div>

      {/* Accounts summary */}
      {accounts.data && accounts.data.length > 0 && (
        <div>
          <h2 className="font-display text-base font-medium mb-3">Factory Accounts</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {accounts.data.map((a) => (
              <Card key={a.account_id} className="p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-semibold text-[14px]">{a.account_name}</div>
                    <div className="text-[12px] text-text-muted">{a.supplier_name}</div>
                  </div>
                  <Pill tone={a.is_active ? "success" : "neutral"} dot={false}>
                    {a.is_active ? "Active" : "Inactive"}
                  </Pill>
                </div>
                <div className="mt-3 font-mono text-[20px] font-bold">
                  ¥{(a.current_balance_base ?? 0).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Factory Tab ───────────────────────────────────────────

function FactoryTab({
  selectedAccount,
  onSelectAccount,
  factoryTab,
  onFactoryTab,
  lang,
}: {
  selectedAccount: FactoryAccount | null;
  onSelectAccount: (a: FactoryAccount) => void;
  factoryTab: FactoryTab;
  onFactoryTab: (t: FactoryTab) => void;
  lang: "en" | "zh";
}) {
  const { data: accounts, isLoading, isError } = useFactoryAccounts();

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (isError) return <EmptyState icon={<AlertTriangle className="w-6 h-6" />} title="Failed to load" />;
  if (!accounts || accounts.length === 0) {
    return (
      <EmptyState
        icon={<Wallet className="w-8 h-8" />}
        title={lang === "zh" ? "暂无工厂账户" : "No factory accounts"}
        message={
          lang === "zh"
            ? "请先创建工厂账户。"
            : "Create a factory account to start tracking the China balance."
        }
      />
    );
  }

  const active = selectedAccount ?? accounts[0];

  return (
    <div className="space-y-4">
      {/* Account selector */}
      {accounts.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {accounts.map((a) => (
            <button
              key={a.account_id}
              onClick={() => onSelectAccount(a)}
              className={cn(
                "px-4 py-2 rounded-[11px] text-[13px] font-semibold border transition-all",
                active.account_id === a.account_id
                  ? "bg-accent/15 border-accent/40 text-accent-glow"
                  : "border-line text-text-muted hover:text-text-primary",
              )}
            >
              {a.account_name}
            </button>
          ))}
        </div>
      )}

      {/* Account header */}
      <Card className="p-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="font-display text-lg font-medium">{active.account_name}</div>
          <div className="text-[13px] text-text-muted">{active.supplier_name} · {active.country}</div>
        </div>
        <Pill tone={active.is_active ? "success" : "neutral"}>{active.is_active ? "Active" : "Inactive"}</Pill>
      </Card>

      {/* Sub-tabs */}
      <div className="flex gap-1 p-1 glass rounded-[14px]">
        {([
          { key: "ledger" as const, label: lang === "zh" ? "账户记录" : "Ledger", icon: <Wallet className="w-3.5 h-3.5" /> },
          { key: "shipments" as const, label: lang === "zh" ? "发货记录" : "Shipments", icon: <Ship className="w-3.5 h-3.5" /> },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => onFactoryTab(t.key)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold whitespace-nowrap transition-all",
              factoryTab === t.key
                ? "bg-accent-deep text-[#F4E9D9] shadow-md"
                : "text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05]",
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        {factoryTab === "ledger" && (
          <FactoryAccountLedger account={active} lang={lang} />
        )}
        {factoryTab === "shipments" && (
          <FactoryShipmentsPanel
            accountId={active.account_id}
            supplierId={active.supplier_id}
            lang={lang}
          />
        )}
      </Suspense>
    </div>
  );
}

// ── Production Runs Tab ───────────────────────────────────

function RunsTab({
  onSelect,
  onCreate,
  canCreate,
}: {
  onSelect: (r: ProductionRun) => void;
  onCreate: () => void;
  canCreate: boolean;
}) {
  const { data, isLoading, isError, refetch } = useProductionRuns();
  const runs = data?.data ?? [];

  const cols: Column<ProductionRun>[] = [
    {
      key: "no",
      header: "Run #",
      width: "110px",
      render: (r) => <span className="font-mono text-xs">{r.run_number}</span>,
    },
    {
      key: "title",
      header: "Title",
      render: (r) => <span className="font-semibold text-[13px]">{r.title}</span>,
    },
    {
      key: "status",
      header: "Status",
      width: "160px",
      render: (r) => {
        const meta = RUN_STATUS_META[r.status];
        return <Pill tone={meta.tone}>{meta.label}</Pill>;
      },
    },
    {
      key: "units",
      header: "Units",
      width: "100px",
      render: (r) => (
        <span className="font-mono text-xs">
          {r.units_received}/{r.units_planned}
        </span>
      ),
    },
    {
      key: "cost",
      header: "Total Cost",
      align: "right",
      width: "140px",
      render: (r) =>
        r.total_cost_ngn != null ? (
          <MoneyText ngn={r.total_cost_ngn} className="text-[13px]" />
        ) : (
          <span className="text-text-faint text-xs">—</span>
        ),
    },
    {
      key: "per_unit",
      header: "Per Unit",
      align: "right",
      width: "120px",
      render: (r) =>
        r.per_unit_cost_ngn != null ? (
          <MoneyText ngn={r.per_unit_cost_ngn} className="text-[13px]" />
        ) : (
          <span className="text-text-faint text-xs">—</span>
        ),
    },
    {
      key: "date",
      header: "Created",
      width: "100px",
      render: (r) => <span className="text-text-muted text-xs">{fmt(r.created_at)}</span>,
    },
  ];

  if (isError) {
    return (
      <EmptyState
        icon={<AlertTriangle className="w-7 h-7" />}
        title="Failed to load"
        message="Could not load production runs."
        action={<Button size="sm" onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  return (
    <DataTable
      columns={cols}
      rows={runs}
      rowKey={(r) => r.run_id}
      onRowClick={onSelect}
      loading={isLoading}
      empty={{
        icon: <Factory className="w-7 h-7" />,
        title: "No production runs",
        message: "Track a production batch from factory to Lagos warehouse.",
        action: canCreate ? (
          <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={onCreate}>
            New Production Run
          </Button>
        ) : undefined,
      }}
    />
  );
}

// ── Run Detail Drawer ─────────────────────────────────────

function RunDetailDrawer({
  run: initialRun,
  onClose,
}: {
  run: ProductionRun;
  onClose: () => void;
}) {
  const { data: run } = useProductionRun(initialRun.run_id);
  const advance = useAdvanceProductionRun(initialRun.run_id);
  const current = run ?? initialRun;
  const meta = RUN_STATUS_META[current.status];

  const STATUS_FLOW: Record<string, string[]> = {
    planned: ["funded", "in_production", "cancelled"],
    funded: ["in_production", "cancelled"],
    in_production: ["quality_check", "ready_to_ship"],
    quality_check: ["ready_to_ship", "in_production"],
    ready_to_ship: ["in_transit"],
    in_transit: ["arrived_lagos"],
    arrived_lagos: ["cleared_customs"],
    cleared_customs: ["received"],
    received: ["completed"],
  };
  const nextStatuses = STATUS_FLOW[current.status] ?? [];

  return (
    <Drawer
      open
      onClose={onClose}
      wide
      title={<span className="font-mono">{current.run_number}</span>}
      subtitle={<Pill tone={meta.tone}>{meta.label}</Pill>}
    >
      <div className="space-y-6">
        <div>
          <h3 className="font-display text-lg font-medium mb-1">{current.title}</h3>
          <div className="text-[13px] text-text-muted">
            {current.units_received}/{current.units_planned} units received
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {current.total_cost_ngn != null && (
            <div>
              <div className="micro mb-1">Total Cost</div>
              <MoneyText ngn={current.total_cost_ngn} className="text-[22px]" />
            </div>
          )}
          {current.per_unit_cost_ngn != null && (
            <div>
              <div className="micro mb-1">Per Unit Cost</div>
              <MoneyText ngn={current.per_unit_cost_ngn} className="text-[22px]" />
            </div>
          )}
        </div>

        {current.cost_components && current.cost_components.length > 0 && (
          <div>
            <div className="micro mb-2">Cost Components</div>
            <div className="space-y-2">
              {current.cost_components.map((c) => (
                <div
                  key={c.component_id}
                  className="flex items-center justify-between glass rounded-xl p-3 text-[13px]"
                >
                  <div>
                    <div className="font-semibold">{c.cost_type}</div>
                    <div className="text-xs text-text-faint font-mono">{c.currency}</div>
                  </div>
                  <MoneyText ngn={c.amount_ngn} className="text-[13px]" />
                </div>
              ))}
            </div>
          </div>
        )}

        {nextStatuses.length > 0 && (
          <div>
            <div className="micro mb-2">Advance Status</div>
            <div className="flex gap-2 flex-wrap">
              {nextStatuses.map((s) => {
                const m = RUN_STATUS_META[s as keyof typeof RUN_STATUS_META];
                return (
                  <Button
                    key={s}
                    size="sm"
                    variant={s === "cancelled" ? "danger" : "secondary"}
                    disabled={advance.isPending}
                    onClick={() =>
                      advance.mutate(s, { onSuccess: onClose })
                    }
                  >
                    → {m?.label ?? s}
                  </Button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}

// ── Create Run Drawer ─────────────────────────────────────

function CreateRunDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateProductionRun();
  const [title, setTitle] = useState("");
  const [units, setUnits] = useState("0");

  const handleSubmit = () => {
    if (!title) return;
    create.mutate(
      { title, units_planned: parseInt(units) || 0 },
      {
        onSuccess: () => {
          setTitle("");
          setUnits("0");
          onClose();
        },
      },
    );
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New Production Run"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={create.isPending || !title} onClick={handleSubmit}>
            {create.isPending ? "Creating…" : "Create Run"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Run Title">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. 13×6 Lace Front — June Batch"
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50"
            autoFocus
          />
        </Field>
        <Field label="Units Planned">
          <NumberField value={units} onChange={setUnits} placeholder="0" />
        </Field>
      </div>
    </Drawer>
  );
}
