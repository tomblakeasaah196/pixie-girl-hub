import { useNavigate } from "react-router-dom";
import { MoneyText, Skeleton } from "@/components/ui/primitives";
import { ProbabilityBar } from "../shared/StagePill";
import type { KanbanColumn } from "../types";

interface ForecastViewProps {
  columns: KanbanColumn[];
  isLoading: boolean;
}

export function ForecastView({ columns, isLoading }: ForecastViewProps) {
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[80px] rounded-[13px]" />
        ))}
      </div>
    );
  }

  const totalPipeline = columns.reduce((s, c) => s + c.total_value_ngn, 0);
  const weightedTotal = columns.reduce((s, c) => {
    const prob = c.stage.win_probability_pct ?? 50;
    return s + (c.total_value_ngn * prob) / 100;
  }, 0);

  return (
    <div>
      {/* Summary header */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="p-3 rounded-[13px] bg-text-primary/[0.04] border hairline">
          <div className="micro mb-1">Total pipeline</div>
          <div className="font-display text-xl tabular-nums text-text-primary">
            <MoneyText ngn={totalPipeline} />
          </div>
          <div className="text-[10.5px] text-text-faint mt-0.5">
            {columns.reduce((s, c) => s + c.deals.length, 0)} deals
          </div>
        </div>
        <div className="p-3 rounded-[13px] bg-accent/[0.06] border border-accent/20">
          <div className="micro mb-1">Weighted forecast</div>
          <div className="font-display text-xl tabular-nums text-accent">
            <MoneyText ngn={weightedTotal} />
          </div>
          <div className="text-[10.5px] text-text-faint mt-0.5">by win probability</div>
        </div>
      </div>

      {/* Stage breakdown */}
      <div className="flex flex-col gap-3">
        {columns
          .filter((c) => c.deals.length > 0)
          .sort((a, b) => a.stage.display_order - b.stage.display_order)
          .map((col) => {
            const prob = col.stage.win_probability_pct ?? 50;
            const weighted = (col.total_value_ngn * prob) / 100;
            const pct = totalPipeline > 0 ? (col.total_value_ngn / totalPipeline) * 100 : 0;

            return (
              <div
                key={col.stage.stage_id}
                className="p-4 rounded-[14px] bg-text-primary/[0.03] border hairline"
              >
                {/* Stage header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: col.stage.colour ?? "#690909" }}
                    />
                    <span className="text-[13px] font-semibold text-text-primary">
                      {col.stage.display_name}
                    </span>
                    <span className="text-[11px] text-text-faint">
                      {col.deals.length} deal{col.deals.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="text-[13px] font-display tabular-nums text-text-primary">
                      <MoneyText ngn={col.total_value_ngn} />
                    </div>
                    <div className="text-[10.5px] text-text-faint">
                      {Math.round(pct)}% of pipeline
                    </div>
                  </div>
                </div>

                {/* Bar */}
                <div className="mb-3">
                  <div className="w-full h-2 rounded-full bg-text-primary/[0.06] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: col.stage.colour ?? "#690909",
                      }}
                    />
                  </div>
                </div>

                {/* Weighted line */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-text-faint">Win probability</span>
                    <span
                      className="text-[11px] font-semibold"
                      style={{ color: col.stage.colour ?? "#690909" }}
                    >
                      {prob}%
                    </span>
                    <ProbabilityBar probability={prob} colour={col.stage.colour} />
                  </div>
                  <div className="text-[11.5px] font-display tabular-nums text-text-muted">
                    ≈ <MoneyText ngn={weighted} />
                  </div>
                </div>

                {/* Top deals */}
                <div className="mt-3 flex flex-col gap-1.5">
                  {col.deals
                    .sort(
                      (a, b) =>
                        parseFloat(b.expected_value_ngn ?? "0") -
                        parseFloat(a.expected_value_ngn ?? "0"),
                    )
                    .slice(0, 3)
                    .map((d) => (
                      <button
                        key={d.deal_id}
                        type="button"
                        onClick={() => navigate(`/crm/deals/${d.deal_id}`)}
                        className="flex items-center justify-between text-left hover:bg-text-primary/[0.04] px-2 py-1 rounded-[8px] transition-colors"
                      >
                        <span className="text-[11.5px] text-text-muted truncate flex-1">
                          {d.title}
                          {d.contact_name && (
                            <span className="text-text-faint"> · {d.contact_name}</span>
                          )}
                        </span>
                        {d.expected_value_ngn && (
                          <span className="text-[11px] font-mono text-text-faint ml-2 flex-shrink-0">
                            <MoneyText ngn={parseFloat(d.expected_value_ngn)} />
                          </span>
                        )}
                      </button>
                    ))}
                  {col.deals.length > 3 && (
                    <span className="text-[10.5px] text-text-faint px-2">
                      +{col.deals.length - 3} more
                    </span>
                  )}
                </div>
              </div>
            );
          })}
      </div>

      {columns.every((c) => c.deals.length === 0) && (
        <div className="py-12 text-center text-text-faint text-[13px]">
          No open deals to forecast
        </div>
      )}
    </div>
  );
}
