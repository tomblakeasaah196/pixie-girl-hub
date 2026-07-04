/**
 * <ModuleInsights /> — the reusable AI-insights slot (§6.30).
 *
 * Drop this once on any module page:  <ModuleInsights module="purchasing" />
 *
 * It is self-effacing by design — it renders NOTHING unless (a) the CEO has
 * switched the module on in AI Control, (b) the viewer may see insights, and
 * (c) there is at least one open finding. So a module page never carries empty
 * chrome; the card appears only when Praxis actually has something to say.
 * "View all" deep-links into the Insights Center pre-filtered to this module.
 */

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Sparkles, ArrowRight } from "lucide-react";
import { Pill } from "@/components/ui/primitives";
import { useAuthStore } from "@/stores/auth";
import {
  useInsightModules,
  useInsightsList,
  type InsightModule,
} from "@/lib/insights-api";
import { InsightRow } from "./InsightRow";
import { bySeverity } from "./severity";

export function ModuleInsights({
  module,
  limit = 4,
  className,
}: {
  module: string;
  limit?: number;
  className?: string;
}) {
  const isCeo = useAuthStore((s) => s.user?.isCeo ?? false);
  const can = useAuthStore((s) => s.can);
  const canView = isCeo || can("ai_insights", "view");
  const canEdit = isCeo || can("ai_insights", "edit");

  const modules = useInsightModules();
  const cfg: InsightModule | undefined = modules.data?.find(
    (m) => m.module === module,
  );
  const enabled = Boolean(cfg?.insights_enabled);

  const list = useInsightsList(
    { module, status: "open" },
    { enabled: canView && enabled },
  );

  const items = useMemo(
    () => [...(list.data ?? [])].sort(bySeverity),
    [list.data],
  );

  // Self-effacing: nothing to show → render nothing.
  if (!canView || !enabled || list.isLoading || list.isError) return null;
  if (items.length === 0) return null;

  const shown = items.slice(0, limit);
  const urgent = items.filter(
    (i) => i.severity === "high" || i.severity === "critical",
  ).length;

  return (
    <div
      className={
        "rounded-[14px] border border-accent/20 bg-accent/[0.04] overflow-hidden " +
        (className ?? "")
      }
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b hairline">
        <Sparkles className="w-3.5 h-3.5 text-accent-glow shrink-0" />
        <span className="text-[12px] font-semibold text-accent-glow flex-1">
          Praxis insights
        </span>
        {urgent > 0 && (
          <Pill tone="danger" dot={false}>
            {urgent} urgent
          </Pill>
        )}
        <span className="text-[11px] text-text-faint tabular-nums">
          {items.length} open
        </span>
      </div>

      <div>
        {shown.map((i) => (
          <InsightRow key={i.insight_id} insight={i} canEdit={canEdit} compact />
        ))}
      </div>

      {items.length > shown.length && (
        <Link
          to={`/insights?module=${module}`}
          className="flex items-center justify-center gap-1.5 py-2.5 text-[12px] font-semibold text-accent-glow hover:bg-accent/[0.06] transition-colors border-t hairline"
        >
          View all {items.length} <ArrowRight className="w-3 h-3" />
        </Link>
      )}
    </div>
  );
}
