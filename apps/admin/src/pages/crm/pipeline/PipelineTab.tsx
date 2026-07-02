import { useState } from "react";
import {
  LayoutGrid,
  List,
  BarChart2,
  CalendarDays,
  Plus,
  ChevronDown,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { usePipelines, usePipelineDeals, usePipelineStages } from "../hooks";
import { KanbanView } from "./KanbanView";
import { TableView } from "./TableView";
import { ForecastView } from "./ForecastView";
import { CalendarView } from "./CalendarView";
import { NewDealModal } from "../shared/NewDealModal";
import { setPipelineBoard } from "../api";
import type { DealFilter } from "../types";

type ViewMode = "kanban" | "table" | "forecast" | "calendar";

const VIEWS: { key: ViewMode; icon: typeof LayoutGrid; label: string }[] = [
  { key: "kanban", icon: LayoutGrid, label: "Kanban" },
  { key: "table", icon: List, label: "Table" },
  { key: "forecast", icon: BarChart2, label: "Forecast" },
  { key: "calendar", icon: CalendarDays, label: "Calendar" },
];

const STATUS_FILTERS = [
  { value: "open", label: "Open" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
  { value: "on_hold", label: "On hold" },
];

export function PipelineTab() {
  const [view, setView] = useState<ViewMode>("kanban");
  const [filter, setFilter] = useState<DealFilter>({ status: "open" });
  const [showNewDeal, setShowNewDeal] = useState(false);

  const { data: pipelines = [], isLoading: loadPipelines } = usePipelines();
  const defaultPipeline = pipelines.find((p) => p.is_default) ?? pipelines[0];
  const activePipelineId =
    filter.pipeline_id ?? defaultPipeline?.pipeline_id ?? "";

  const { data: stages = [], isLoading: loadStages } = usePipelineStages(
    activePipelineId || null,
  );
  const {
    data: dealsResult,
    isLoading: loadDeals,
    refetch,
  } = usePipelineDeals({
    ...filter,
    pipeline_id: activePipelineId,
  });

  const deals = dealsResult?.data ?? [];
  const columns = setPipelineBoard(
    stages
      .filter((s) => s.is_active)
      .sort((a, b) => a.display_order - b.display_order),
    deals,
  );

  const isLoading = loadPipelines || loadStages || loadDeals;

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {/* Pipeline selector */}
        {pipelines.length > 1 && (
          <div className="relative">
            <select
              value={activePipelineId}
              onChange={(e) =>
                setFilter((f) => ({ ...f, pipeline_id: e.target.value }))
              }
              className="h-[32px] pl-3 pr-7 rounded-[9px] bg-text-primary/[0.04] border border-line text-[12px] text-text-primary appearance-none focus:outline-none focus:border-accent/40 transition-colors"
            >
              {pipelines.map((p) => (
                <option key={p.pipeline_id} value={p.pipeline_id}>
                  {p.display_name}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-faint pointer-events-none" />
          </div>
        )}

        {/* Status filter */}
        <div className="flex gap-0.5 p-0.5 rounded-[9px] bg-text-primary/[0.04] border hairline">
          {STATUS_FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter((f) => ({ ...f, status: value }))}
              className={[
                "px-2.5 h-[28px] rounded-[7px] text-[11.5px] font-semibold transition-all",
                filter.status === value
                  ? "bg-accent-deep text-[#F4E9D9]"
                  : "text-text-muted hover:text-text-primary",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* View switcher */}
        <div className="flex gap-0.5 p-0.5 rounded-[9px] bg-text-primary/[0.04] border hairline">
          {VIEWS.map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              type="button"
              title={label}
              onClick={() => setView(key)}
              className={[
                "w-[30px] h-[28px] grid place-items-center rounded-[7px] transition-all",
                view === key
                  ? "bg-accent-deep text-[#F4E9D9]"
                  : "text-text-muted hover:text-text-primary",
              ].join(" ")}
            >
              <Icon className="w-3.5 h-3.5" />
            </button>
          ))}
        </div>

        <button
          type="button"
          title="Refresh"
          onClick={() => refetch()}
          className="w-[32px] h-[32px] grid place-items-center rounded-[9px] text-text-faint hover:text-text-primary hover:bg-text-primary/[0.08] transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>

        <Button
          variant="primary"
          size="sm"
          icon={<Plus className="w-3.5 h-3.5" />}
          onClick={() => setShowNewDeal(true)}
        >
          New deal
        </Button>
      </div>

      {/* Deal count */}
      {!isLoading && (
        <div className="text-[11px] text-text-faint mb-3">
          {deals.length} deal{deals.length !== 1 ? "s" : ""} ·{" "}
          {columns.filter((c) => c.deals.length > 0).length} active stage
          {columns.filter((c) => c.deals.length > 0).length !== 1 ? "s" : ""}
        </div>
      )}

      {/* Active view */}
      {view === "kanban" && (
        <KanbanView
          columns={columns}
          isLoading={isLoading}
          onAddDeal={() => setShowNewDeal(true)}
        />
      )}
      {view === "table" && (
        <TableView columns={columns} isLoading={isLoading} />
      )}
      {view === "forecast" && (
        <ForecastView columns={columns} isLoading={isLoading} />
      )}
      {view === "calendar" && (
        <CalendarView columns={columns} isLoading={isLoading} />
      )}

      {/* New deal modal — opens with an inline contact picker (no preset contact). */}
      {showNewDeal && (
        <NewDealModal
          onClose={() => setShowNewDeal(false)}
          onCreated={() => refetch()}
        />
      )}
    </div>
  );
}
