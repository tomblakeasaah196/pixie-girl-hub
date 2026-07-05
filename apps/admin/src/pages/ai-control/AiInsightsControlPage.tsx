/**
 * AI Control → Insights (§6.31) — the per-module switchboard.
 *
 * The CEO picks which modules Praxis watches. Per module:
 *   • Insights   — tier-1 deterministic detectors (free, always-on rules)
 *   • Narration  — tier-2 AI briefing (paid; only runs where switched on)
 *   • Frequency  — how eagerly the briefing runs
 *
 * Live open-counts sit beside each row so the effect of a toggle is visible.
 * Backend: GET/PATCH /insights/modules (shared.ai_insight_modules).
 */

import { Link } from "react-router-dom";
import { Sparkles, ArrowUpRight, Info } from "lucide-react";
import { Card, Pill, Skeleton, Button } from "@/components/ui/primitives";
import { Toggle, Select, DeniedState } from "@/components/ui/controls";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import {
  useInsightModules,
  useInsightsSummary,
  useUpdateInsightModule,
  type InsightFrequency,
  type InsightModule,
} from "@/lib/insights-api";

const FREQ_OPTIONS: { value: InsightFrequency; label: string }[] = [
  { value: "realtime", label: "Real-time" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "off", label: "Off" },
];

export function AiInsightsControlPage() {
  useBreadcrumbs([
    { label: "AI Control", href: "/ai-control" },
    { label: "Insights" },
  ]);
  const isCeo = useAuthStore((s) => s.user?.isCeo ?? false);
  const can = useAuthStore((s) => s.can);
  const canView = isCeo || can("ai_insights", "view");
  const canEdit = isCeo || can("ai_insights", "edit");

  const modules = useInsightModules();
  const summary = useInsightsSummary();
  const update = useUpdateInsightModule();

  if (!canView) {
    return (
      <div className="max-w-[960px] mx-auto">
        <DeniedState message="AI Control is reserved for the CEO and roles granted ai_insights." />
      </div>
    );
  }

  const rows = modules.data ?? [];
  const onCount = rows.filter((m) => m.insights_enabled).length;

  const setField = (m: InsightModule, fields: Partial<InsightModule>) =>
    update.mutate({ module: m.module, fields });

  return (
    <div className="max-w-[960px] mx-auto space-y-4">
      <header className="flex items-center gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent/10 text-accent-glow border border-accent/20">
          <Sparkles className="w-5 h-5" />
        </span>
        <div className="flex-1">
          <h2 className="font-display text-[22px] font-medium">
            Insights control
          </h2>
          <p className="text-text-muted text-[13px]">
            Pick which modules Praxis watches. {onCount} of {rows.length} on.
          </p>
        </div>
        <Link to="/insights">
          <Button variant="secondary" icon={<ArrowUpRight className="w-4 h-4" />}>
            Open Insights
          </Button>
        </Link>
      </header>

      <div className="flex items-start gap-2 rounded-[12px] p-3 border border-info/25 bg-info/[0.06] text-[12px] text-text-muted">
        <Info className="w-4 h-4 text-info shrink-0 mt-0.5" />
        <p>
          <b className="text-text-primary">Insights</b> are deterministic rules —
          free and always safe to leave on.{" "}
          <b className="text-text-primary">Narration</b> adds an AI-written
          briefing (uses your DeepSeek budget), so it only runs where you turn it
          on. <b className="text-text-primary">Frequency</b> sets how often the
          automatic scan re-checks each module (weekly cuts spend; “Off” means
          manual only) — the <b className="text-text-primary">Run scan</b> button
          on Insights always checks everything now. Both stop at the monthly hard
          cap; the rules keep running.
        </p>
      </div>

      {modules.isError ? (
        <Card className="p-8 text-center text-text-muted">
          Couldn't load the module list.{" "}
          <button
            onClick={() => modules.refetch()}
            className="text-accent-glow underline"
          >
            Retry
          </button>
        </Card>
      ) : modules.isLoading ? (
        <Card className="divide-y divide-line/10">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="p-4 flex items-center gap-4">
              <Skeleton className="w-40 h-4" />
              <div className="flex-1" />
              <Skeleton className="w-10 h-5" />
              <Skeleton className="w-10 h-5" />
              <Skeleton className="w-24 h-8" />
            </div>
          ))}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* Column header (desktop) */}
          <div className="hidden md:grid grid-cols-[1fr_auto_auto_auto] gap-6 px-4 py-2.5 border-b hairline text-[10.5px] uppercase tracking-widest text-text-faint">
            <span>Module</span>
            <span className="w-16 text-center">Insights</span>
            <span className="w-16 text-center">Narration</span>
            <span className="w-[120px]">Frequency</span>
          </div>
          {rows.map((m) => {
            const counts = summary.data?.[m.module];
            return (
              <div
                key={m.module}
                className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] gap-3 md:gap-6 items-center p-4 border-b hairline last:border-0"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium text-[13.5px] text-text-primary truncate">
                    {m.display_name}
                  </span>
                  {counts && counts.open > 0 && (
                    <Pill tone={counts.urgent > 0 ? "danger" : "warn"} dot={false}>
                      {counts.open} open
                    </Pill>
                  )}
                </div>

                <div className="flex md:block items-center justify-between md:w-16 md:text-center">
                  <span className="md:hidden micro">Insights</span>
                  <Toggle
                    checked={m.insights_enabled}
                    disabled={!canEdit || update.isPending}
                    ariaLabel={`Tier-1 insights for ${m.display_name}`}
                    onChange={(v) => setField(m, { insights_enabled: v })}
                  />
                </div>

                <div className="flex md:block items-center justify-between md:w-16 md:text-center">
                  <span className="md:hidden micro">Narration</span>
                  <Toggle
                    checked={m.narration_enabled}
                    disabled={!canEdit || !m.insights_enabled || update.isPending}
                    ariaLabel={`AI narration for ${m.display_name}`}
                    onChange={(v) => setField(m, { narration_enabled: v })}
                  />
                </div>

                <div className="md:w-[120px]">
                  <Select<InsightFrequency>
                    value={m.frequency}
                    disabled={!canEdit || !m.insights_enabled}
                    ariaLabel={`Briefing frequency for ${m.display_name}`}
                    options={FREQ_OPTIONS}
                    onChange={(v) => setField(m, { frequency: v })}
                  />
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
