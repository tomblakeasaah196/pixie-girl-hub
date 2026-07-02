/**
 * Dashboard & Reports (§6.20) — the management control centre.
 *
 * Structure is data-driven: /dashboards/domains says which tabs this user
 * may see (matrix OR org-chart rights; Finance/HR gated; cost tiles
 * pre-stripped server-side). One global period control drives every tile;
 * KPI deltas compare the previous equivalent window; data polls every 60s
 * with a visible freshness pill. The CEO gets the All-Businesses rollup —
 * the one surface allowed to aggregate entities. Every screen state ships:
 * skeleton, empty, error-with-retry, permission-denied.
 */

import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Building2,
  FileSpreadsheet,
  Lock,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { ApiError } from "@/lib/api";
import { Button, Card, EmptyState } from "@/components/ui/primitives";
import {
  downloadDomainExcel,
  useDashboardDomains,
  useDomainDashboard,
  useGlobalDashboard,
  useHiddenTiles,
  useSaveHiddenTiles,
} from "@/lib/dashboards-api";
import { useAuthStore } from "@/stores/auth";
import { DomainSkeleton, DomainView } from "./DomainView";
import { GlobalView } from "./GlobalView";
import { ReportsView } from "./ReportsView";
import { DetailDrawer } from "./DetailDrawer";
import { PeriodPicker, UpdatedAgo, presetRange, type PresetKey } from "./bits";

const GLOBAL_TAB = "__all__";
const REPORTS_TAB = "__reports__";

export function DashboardPage() {
  const [sp, setSp] = useSearchParams();
  const can = useAuthStore((s) => s.can);

  const domains = useDashboardDomains();
  const hiddenQuery = useHiddenTiles();
  const saveHidden = useSaveHiddenTiles();

  const tab = sp.get("tab") ?? "overview";
  const preset = (sp.get("range") as PresetKey) ?? "30d";
  const customFrom = sp.get("from") ?? "";
  const customTo = sp.get("to") ?? "";

  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setSp(next, { replace: true });
  };

  const period = useMemo(
    () => presetRange(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  );

  const isGlobal = tab === GLOBAL_TAB;
  const isReports = tab === REPORTS_TAB;
  const domainKey = isGlobal || isReports ? null : tab;

  const domain = useDomainDashboard(domainKey, period);
  const global = useGlobalDashboard(
    period,
    isGlobal && (domains.data?.capabilities.all_entities ?? false),
  );

  // Customize (tile show/hide) — staged locally, saved to /preferences.
  const [customizing, setCustomizing] = useState(false);
  const [staged, setStaged] = useState<Set<string> | null>(null);
  const hiddenTiles = useMemo(
    () => staged ?? new Set(hiddenQuery.data ?? []),
    [staged, hiddenQuery.data],
  );
  const toggleTile = (key: string) => {
    setStaged((prev) => {
      const next = new Set(prev ?? hiddenQuery.data ?? []);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // ── Permission denied / error / loading states ───────────
  if (domains.isError) {
    const err = domains.error;
    if (err instanceof ApiError && err.status === 403) {
      return (
        <Card className="p-10">
          <EmptyState
            icon={<Lock className="w-7 h-7" />}
            title="Reserved for management"
            message="Dashboards are available to the CEO, top management, operations, finance and admin. Ask the owner for access if you believe you should see this."
          />
        </Card>
      );
    }
    return (
      <Card className="p-10">
        <EmptyState
          icon={<AlertTriangle className="w-7 h-7" />}
          title="Couldn't load the dashboard"
          message="Something went wrong talking to the Hub."
          action={
            <Button variant="secondary" onClick={() => domains.refetch()}>
              Retry
            </Button>
          }
        />
      </Card>
    );
  }
  if (domains.isLoading) return <DomainSkeleton />;

  const caps = domains.data!.capabilities;
  const tabs: { key: string; label: string }[] = [
    ...domains.data!.domains.map((d) => ({ key: d.key, label: d.label })),
    ...(caps.all_entities ? [{ key: GLOBAL_TAB, label: "All Businesses" }] : []),
    { key: REPORTS_TAB, label: "Reports" },
  ];

  const activeQuery = isGlobal ? global : domain;
  const showExport = !isReports && !isGlobal && caps.can_export;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-medium">Dashboard</h1>
          <p className="text-[12px] text-text-faint mt-0.5">
            {isGlobal
              ? "Both companies, one view"
              : isReports
                ? "Weekly auto-reports & history"
                : "Your control centre — live, filtered, exportable"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!isReports && (
            <UpdatedAgo
              updatedAt={activeQuery.dataUpdatedAt || undefined}
              refreshing={activeQuery.isFetching}
              onRefresh={() => activeQuery.refetch()}
            />
          )}
          {showExport && (
            <Button
              variant="secondary"
              disabled={exporting}
              onClick={async () => {
                setExporting(true);
                try {
                  await downloadDomainExcel(tab, period);
                } finally {
                  setExporting(false);
                }
              }}
              icon={<FileSpreadsheet className="w-4 h-4" />}
            >
              {exporting ? "Exporting…" : "Export Excel"}
            </Button>
          )}
          {!isReports && !isGlobal && !customizing && (
            <Button
              variant="ghost"
              onClick={() => setCustomizing(true)}
              icon={<Settings2 className="w-4 h-4" />}
            >
              Customize
            </Button>
          )}
          {customizing && (
            <>
              <Button
                variant="primary"
                disabled={saveHidden.isPending}
                onClick={async () => {
                  await saveHidden.mutateAsync([...hiddenTiles]);
                  setStaged(null);
                  setCustomizing(false);
                }}
              >
                {saveHidden.isPending ? "Saving…" : "Save layout"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setStaged(null);
                  setCustomizing(false);
                }}
              >
                Cancel
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1 -mb-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setParam({ tab: t.key === "overview" ? null : t.key })}
            className={cn(
              "px-3.5 h-10 rounded-full text-[12.5px] whitespace-nowrap transition-colors border shrink-0",
              tab === t.key
                ? "bg-accent-deep text-[#F4E9D9] border-transparent font-medium"
                : "glass hairline text-text-muted hover:text-text-primary",
            )}
          >
            {t.key === GLOBAL_TAB && <Building2 className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />}
            {t.label}
          </button>
        ))}
      </div>

      {!isReports && (
        <PeriodPicker
          preset={preset}
          onPreset={(p) => setParam({ range: p === "30d" ? null : p })}
          customFrom={customFrom}
          customTo={customTo}
          onCustom={(from, to) => setParam({ range: "custom", from, to })}
        />
      )}

      {isReports ? (
        <ReportsView
          canApprove={can("dashboards", "approve")}
          canExport={caps.can_export}
        />
      ) : isGlobal ? (
        global.isLoading ? (
          <DomainSkeleton />
        ) : global.isError ? (
          <Card className="p-8">
            <EmptyState
              icon={<AlertTriangle className="w-6 h-6" />}
              title="Couldn't load the rollup"
              action={
                <Button variant="secondary" onClick={() => global.refetch()}>
                  Retry
                </Button>
              }
            />
          </Card>
        ) : (
          global.data && <GlobalView payload={global.data} />
        )
      ) : domain.isLoading ? (
        <DomainSkeleton />
      ) : domain.isError ? (
        <Card className="p-8">
          <EmptyState
            icon={<AlertTriangle className="w-6 h-6" />}
            title={`Couldn't load ${tab}`}
            action={
              <Button variant="secondary" onClick={() => domain.refetch()}>
                Retry
              </Button>
            }
          />
        </Card>
      ) : (
        domain.data && (
          <DomainView
            payload={domain.data}
            hiddenTiles={hiddenTiles}
            customizing={customizing}
            onToggleTile={toggleTile}
            onDrill={setDetailKey}
          />
        )
      )}

      <DetailDrawer
        domain={tab}
        table={detailKey}
        period={period}
        canExport={caps.can_export}
        onClose={() => setDetailKey(null)}
      />
    </div>
  );
}
