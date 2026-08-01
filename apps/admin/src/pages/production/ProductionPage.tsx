import { useState, lazy, Suspense, useEffect } from "react";
import { useUrlTab } from "@/hooks/useUrlTab";
import { useTranslation } from "react-i18next";
import {
  Factory,
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
import { ModuleInsights } from "@/components/insights/ModuleInsights";
import { autoDefaultFactoryLang } from "@/i18n";
import { useFactoryLanguages } from "@/i18n/useFactoryLanguages";
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
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { useFactoryAccounts, useShipments, useProductionRuns } from "./hooks";
import { CreateRunDrawer, RunDetailDrawer } from "./RunDrawers";
import { RUN_STATUS_META } from "./constants";
import type { FactoryAccount, ProductionRun } from "./types";

const FactoryAccountLedger = lazy(() =>
  import("./FactoryAccountLedger").then((m) => ({
    default: m.FactoryAccountLedger,
  })),
);
const FactoryShipmentsPanel = lazy(() =>
  import("./FactoryShipmentsPanel").then((m) => ({
    default: m.FactoryShipmentsPanel,
  })),
);

type MainTab = "overview" | "factory" | "runs";
type FactoryTab = "ledger" | "shipments";

function fmt(d: string) {
  return formatDate(d);
}

export function ProductionPage() {
  useBreadcrumbs([{ label: "Production" }]);
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const { t, i18n } = useTranslation("factory");
  const { languages } = useFactoryLanguages();

  const [tab, setTab] = useUrlTab<MainTab>("overview", [
    "overview",
    "factory",
    "runs",
  ]);
  const [factoryTab, setFactoryTab] = useState<FactoryTab>("ledger");
  const [selectedAccount, setSelectedAccount] = useState<FactoryAccount | null>(
    null,
  );
  const [selectedRun, setSelectedRun] = useState<ProductionRun | null>(null);
  const [showCreateRun, setShowCreateRun] = useState(false);

  // Auto-default to Chinese for factory_manager users on first visit
  useEffect(() => {
    autoDefaultFactoryLang(user?.isFactoryManager ?? false);
  }, [user?.isFactoryManager]);

  // The API enforces `production` on every route in this module (and
  // `purchasing` on the factory-account routes), so gate on `production` —
  // gating on `purchasing` locked a factory manager out of the page they own.
  if (!can("production", "view") && !can("purchasing", "view")) {
    return (
      <div className="py-20">
        <EmptyState
          icon={<Lock className="w-8 h-8" />}
          title={t("accessRestricted")}
          message={t("accessRestrictedMsg")}
        />
      </div>
    );
  }

  const canEditRuns = can("production", "edit");
  const canCreateRuns = can("production", "create");
  // Receiving books goods into a Lagos location, so it needs stock rights too
  // — the API requires both. Hiding it here keeps the China-side UI honest.
  const canReceive = canEditRuns && can("stock", "edit");

  const tabs: { key: MainTab; label: string; icon: React.ReactNode }[] = [
    {
      key: "overview",
      label: t("overviewTab"),
      icon: <TrendingUp className="w-4 h-4" />,
    },
    {
      key: "factory",
      label: t("factoryAccountTab"),
      icon: <Wallet className="w-4 h-4" />,
    },
    {
      key: "runs",
      label: t("productionRunsTab"),
      icon: <Factory className="w-4 h-4" />,
    },
  ];

  return (
    <div className="space-y-5">
      <ModuleInsights module="production" />
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-medium">
            {t("productionTitle")}
          </h1>
          <p className="text-text-muted text-sm mt-0.5">
            {t("productionSubtitle")}
          </p>
        </div>
        <div className="flex gap-2">
          {/* Language selector — driven by DB; new languages appear immediately after saving in Settings */}
          <div
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-[12px] font-semibold border transition-all",
              i18n.language !== "en"
                ? "bg-accent/15 border-accent/30 text-accent-glow"
                : "border-line text-text-muted hover:text-text-primary",
            )}
          >
            <Globe className="w-3.5 h-3.5 shrink-0" />
            <select
              value={i18n.language}
              onChange={(e) => i18n.changeLanguage(e.target.value)}
              className="bg-transparent outline-none cursor-pointer text-inherit font-semibold"
            >
              {Object.entries(languages).map(([code, name]) => (
                <option
                  key={code}
                  value={code}
                  className="bg-[#1a0808] text-foreground"
                >
                  {name}
                </option>
              ))}
            </select>
          </div>
          {tab === "runs" && canCreateRuns && (
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="w-4 h-4" />}
              onClick={() => setShowCreateRun(true)}
            >
              {t("newRun")}
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
        />
      )}
      {tab === "runs" && (
        <RunsTab
          onSelect={setSelectedRun}
          onCreate={() => setShowCreateRun(true)}
          canCreate={canCreateRuns}
        />
      )}

      {/* Run detail drawer */}
      {selectedRun && (
        <RunDetailDrawer
          run={selectedRun}
          onClose={() => setSelectedRun(null)}
          canEdit={canEditRuns}
          canReceive={canReceive}
        />
      )}

      {/* Create run drawer */}
      <CreateRunDrawer
        open={showCreateRun}
        onClose={() => setShowCreateRun(false)}
      />
    </div>
  );
}

// ── Overview Tab ──────────────────────────────────────────

function OverviewTab() {
  const { t } = useTranslation("factory");
  const accounts = useFactoryAccounts();
  const shipments = useShipments({ status: "in_transit" });
  const runs = useProductionRuns({ status: "in_production" });

  const totalBalance =
    accounts.data?.reduce((sum, a) => sum + (a.current_balance_base ?? 0), 0) ??
    0;
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
          label={t("kpiActiveAccounts")}
          value={String(activeAccounts)}
          tone="accent"
        />
        <KpiTile
          label={t("kpiTotalBalance", {
            currency: accounts.data?.[0]?.base_currency ?? "CNY",
          })}
          value={`¥${totalBalance.toLocaleString("en", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
          tone="warn"
        />
        <KpiTile
          label={t("kpiShipmentsInTransit")}
          value={String(inTransit)}
          tone="info"
        />
        <KpiTile
          label={t("kpiRunsInProduction")}
          value={String(activeRuns)}
          tone="accent"
        />
      </div>

      {/* Accounts summary */}
      {accounts.data && accounts.data.length > 0 && (
        <div>
          <h2 className="font-display text-base font-medium mb-3">
            {t("factoryAccountsHeading")}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {accounts.data.map((a) => (
              <Card key={a.account_id} className="p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-semibold text-[14px]">
                      {a.account_name}
                    </div>
                    <div className="text-[12px] text-text-muted">
                      {a.supplier_name}
                    </div>
                  </div>
                  <Pill tone={a.is_active ? "success" : "neutral"} dot={false}>
                    {a.is_active ? t("active") : t("inactive")}
                  </Pill>
                </div>
                <div className="mt-3 font-mono text-[20px] font-bold">
                  ¥
                  {(a.current_balance_base ?? 0).toLocaleString("en", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
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
}: {
  selectedAccount: FactoryAccount | null;
  onSelectAccount: (a: FactoryAccount) => void;
  factoryTab: FactoryTab;
  onFactoryTab: (t: FactoryTab) => void;
}) {
  const { t } = useTranslation("factory");
  const { data: accounts, isLoading, isError } = useFactoryAccounts();

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (isError)
    return (
      <EmptyState
        icon={<AlertTriangle className="w-6 h-6" />}
        title={t("failedToLoad")}
      />
    );
  if (!accounts || accounts.length === 0) {
    return (
      <EmptyState
        icon={<Wallet className="w-8 h-8" />}
        title={t("noFactoryAccounts")}
        message={t("noFactoryAccountsMsg")}
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
          <div className="font-display text-lg font-medium">
            {active.account_name}
          </div>
          <div className="text-[13px] text-text-muted">
            {active.supplier_name} · {active.country}
          </div>
        </div>
        <Pill tone={active.is_active ? "success" : "neutral"}>
          {active.is_active ? t("active") : t("inactive")}
        </Pill>
      </Card>

      {/* Sub-tabs */}
      <div className="flex gap-1 p-1 glass rounded-[14px]">
        {(
          [
            {
              key: "ledger" as const,
              label: t("ledger"),
              icon: <Wallet className="w-3.5 h-3.5" />,
            },
            {
              key: "shipments" as const,
              label: t("shipmentsTab"),
              icon: <Ship className="w-3.5 h-3.5" />,
            },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            onClick={() => onFactoryTab(tab.key)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold whitespace-nowrap transition-all",
              factoryTab === tab.key
                ? "bg-accent-deep text-[#F4E9D9] shadow-md"
                : "text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05]",
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        {factoryTab === "ledger" && <FactoryAccountLedger account={active} />}
        {factoryTab === "shipments" && (
          <FactoryShipmentsPanel
            accountId={active.account_id}
            supplierId={active.supplier_id}
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
  const { t } = useTranslation("factory");
  const { data, isLoading, isError, refetch } = useProductionRuns();
  const runs = data?.data ?? [];
  // The server omits NGN columns for roles that may not see cost — when none
  // of the rows carry them, drop the money columns rather than show a wall of
  // dashes to a factory manager.
  const showsCost = runs.some((r) => r.total_landed_cost_ngn != null);

  const cols: Column<ProductionRun>[] = [
    {
      key: "no",
      header: t("runNumber"),
      width: "110px",
      render: (r) => <span className="font-mono text-xs">{r.run_number}</span>,
    },
    {
      key: "title",
      header: t("title"),
      render: (r) => (
        <div className="min-w-0">
          <div className="font-semibold text-[13px] truncate">{r.title}</div>
          {(r.supplier_name || r.po_number) && (
            <div className="text-[11px] text-text-faint truncate">
              {[r.supplier_name, r.po_number].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: t("status"),
      width: "160px",
      render: (r) => {
        const meta = RUN_STATUS_META[r.status];
        return <Pill tone={meta.tone}>{t(meta.i18nKey)}</Pill>;
      },
    },
    {
      key: "units",
      header: t("units"),
      width: "100px",
      render: (r) => (
        <span className="font-mono text-xs">
          {r.units_received}/{r.units_planned}
        </span>
      ),
    },
    ...(showsCost
      ? ([
          {
            key: "cost",
            header: t("totalCost"),
            align: "right",
            width: "140px",
            render: (r: ProductionRun) =>
              r.total_landed_cost_ngn != null ? (
                <MoneyText
                  ngn={r.total_landed_cost_ngn}
                  className="text-[13px]"
                />
              ) : (
                <span className="text-text-faint text-xs">—</span>
              ),
          },
          {
            key: "per_unit",
            header: t("perUnitCost"),
            align: "right",
            width: "120px",
            render: (r: ProductionRun) =>
              r.per_unit_cost_ngn != null ? (
                <MoneyText ngn={r.per_unit_cost_ngn} className="text-[13px]" />
              ) : (
                <span className="text-text-faint text-xs">—</span>
              ),
          },
        ] as Column<ProductionRun>[])
      : []),
    {
      key: "date",
      header: t("created"),
      width: "100px",
      render: (r) => (
        <span className="text-text-muted text-xs">{fmt(r.created_at)}</span>
      ),
    },
  ];

  if (isError) {
    return (
      <EmptyState
        icon={<AlertTriangle className="w-7 h-7" />}
        title={t("failedToLoad")}
        message={t("couldNotLoadRuns")}
        action={
          <Button size="sm" onClick={() => refetch()}>
            {t("retry")}
          </Button>
        }
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
        title: t("noRuns"),
        message: t("noRunsMsg"),
        action: canCreate ? (
          <Button
            variant="primary"
            icon={<Plus className="w-4 h-4" />}
            onClick={onCreate}
          >
            {t("newProductionRun")}
          </Button>
        ) : undefined,
      }}
    />
  );
}
