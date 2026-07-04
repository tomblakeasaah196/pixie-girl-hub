/**
 * Insights Center (§6.30) — the CEO's proactive-alert surface.
 *
 * A module chip strip (open/urgent counts per module) over a filterable list
 * (status + severity) of the actual findings, each with acknowledge / resolve /
 * dismiss and a drill link to the source record. This is where the Command
 * Center's urgent badge now lands — the dead-end is gone.
 *
 * Canon DoD: four states (skeleton/empty/error/permission-denied), permission-
 * aware actions, entity-scoped queries, MoneyText, tokens only.
 */

import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Lock,
  RefreshCw,
  Sparkles,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, Card, EmptyState, Skeleton } from "@/components/ui/primitives";
import { Select } from "@/components/ui/controls";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import {
  useInsightModules,
  useInsightsList,
  useInsightsSummary,
  useRunSweep,
  totalOpen,
  totalUrgent,
  type InsightSeverity,
  type InsightStatus,
} from "@/lib/insights-api";
import { InsightRow } from "@/components/insights/InsightRow";
import { bySeverity } from "@/components/insights/severity";

const STATUSES: { key: InsightStatus; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "acknowledged", label: "Acknowledged" },
  { key: "resolved", label: "Resolved" },
  { key: "dismissed", label: "Dismissed" },
];
const SEVERITIES: InsightSeverity[] = ["critical", "high", "medium", "low"];

export function InsightsPage() {
  useBreadcrumbs([{ label: "Insights" }]);
  const [sp, setSp] = useSearchParams();
  const isCeo = useAuthStore((s) => s.user?.isCeo ?? false);
  const can = useAuthStore((s) => s.can);
  const canView = isCeo || can("ai_insights", "view");
  const canEdit = isCeo || can("ai_insights", "edit");

  const module = sp.get("module") ?? undefined;
  const status = (sp.get("status") as InsightStatus) ?? "open";
  const severity = (sp.get("severity") as InsightSeverity | null) ?? undefined;

  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setSp(next, { replace: true });
  };

  const summary = useInsightsSummary();
  const modules = useInsightModules();
  const list = useInsightsList(
    { module, status, severity },
    { enabled: canView },
  );
  const sweep = useRunSweep();

  const items = useMemo(
    () => [...(list.data ?? [])].sort(bySeverity),
    [list.data],
  );

  // Module chips: only those with open findings, labelled from the matrix.
  const chips = useMemo(() => {
    const s = summary.data ?? {};
    const labels = new Map(
      (modules.data ?? []).map((m) => [m.module, m.display_name]),
    );
    return Object.entries(s)
      .filter(([, c]) => c.open > 0)
      .map(([mod, c]) => ({
        module: mod,
        label: labels.get(mod) ?? mod.replace(/_/g, " "),
        open: c.open,
        urgent: c.urgent,
      }))
      .sort((a, b) => b.urgent - a.urgent || b.open - a.open);
  }, [summary.data, modules.data]);

  if (!canView) {
    return (
      <Card className="p-10">
        <EmptyState
          icon={<Lock className="w-7 h-7" />}
          title="Reserved for management"
          message="AI Insights are available to the CEO and roles granted the ai_insights permission."
        />
      </Card>
    );
  }

  const open = totalOpen(summary.data);
  const urgent = totalUrgent(summary.data);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-medium flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-accent-glow" />
            Insights
          </h1>
          <p className="text-[12px] text-text-faint mt-0.5">
            {open === 0
              ? "All clear — no open items"
              : `${open} open${urgent ? ` · ${urgent} urgent` : ""} across your business`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => window.open("/ai-control/insights", "_self")}
            icon={<ShieldCheck className="w-4 h-4" />}
          >
            Configure
          </Button>
          {canEdit && (
            <Button
              variant="ghost"
              disabled={sweep.isPending}
              onClick={() => sweep.mutate()}
              icon={
                <RefreshCw
                  className={cn("w-4 h-4", sweep.isPending && "animate-spin")}
                />
              }
            >
              {sweep.isPending ? "Scanning…" : "Run scan"}
            </Button>
          )}
        </div>
      </div>

      {/* Module chips */}
      {!summary.isLoading && chips.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mb-1">
          <Chip
            active={!module}
            label="All"
            count={open}
            onClick={() => setParam({ module: null })}
          />
          {chips.map((c) => (
            <Chip
              key={c.module}
              active={module === c.module}
              label={c.label}
              count={c.open}
              urgent={c.urgent}
              onClick={() => setParam({ module: c.module })}
            />
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 glass hairline rounded-full p-1">
          {STATUSES.map((s) => (
            <button
              key={s.key}
              onClick={() =>
                setParam({ status: s.key === "open" ? null : s.key })
              }
              className={cn(
                "px-3 h-8 rounded-full text-[12px] transition-colors",
                status === s.key
                  ? "bg-accent-deep text-[#F4E9D9] font-medium"
                  : "text-text-muted hover:text-text-primary",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <Select<string>
          value={severity ?? ""}
          onChange={(v) => setParam({ severity: v || null })}
          className="w-[150px]"
          options={[
            { value: "", label: "All severities" },
            ...SEVERITIES.map((s) => ({
              value: s,
              label: s[0].toUpperCase() + s.slice(1),
            })),
          ]}
        />
      </div>

      {/* List */}
      {list.isLoading ? (
        <Card className="overflow-hidden">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="p-[14px_16px] border-b hairline last:border-0 space-y-2">
              <Skeleton className="w-1/3 h-3.5" />
              <Skeleton className="w-2/3 h-2.5" />
            </div>
          ))}
        </Card>
      ) : list.isError ? (
        <Card className="p-8">
          <EmptyState
            icon={<AlertTriangle className="w-6 h-6" />}
            title="Couldn't load insights"
            message="Something went wrong talking to the Hub."
            action={
              <Button variant="secondary" onClick={() => list.refetch()}>
                Retry
              </Button>
            }
          />
        </Card>
      ) : items.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            icon={<Sparkles className="w-7 h-7" />}
            title={status === "open" ? "Nothing needs attention" : "No matching insights"}
            message={
              status === "open"
                ? "Praxis hasn't flagged any open items for this view. Enable more modules in AI Control to widen coverage."
                : "Try a different status or severity filter."
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {items.map((i) => (
            <InsightRow key={i.insight_id} insight={i} canEdit={canEdit} />
          ))}
        </Card>
      )}
    </div>
  );
}

function Chip({
  active,
  label,
  count,
  urgent = 0,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  urgent?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3.5 h-10 rounded-full text-[12.5px] whitespace-nowrap transition-colors border shrink-0 inline-flex items-center gap-2",
        active
          ? "bg-accent-deep text-[#F4E9D9] border-transparent font-medium"
          : "glass hairline text-text-muted hover:text-text-primary",
      )}
    >
      <span className="capitalize">{label}</span>
      <span
        className={cn(
          "tabular-nums text-[11px] px-1.5 rounded-full",
          urgent > 0
            ? "bg-danger/20 text-danger"
            : active
              ? "bg-[#F4E9D9]/20"
              : "bg-text-primary/[0.08]",
        )}
      >
        {count}
      </span>
    </button>
  );
}
