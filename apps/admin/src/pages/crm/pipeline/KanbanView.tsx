import { useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
} from "@dnd-kit/core";
import { Plus } from "lucide-react";
import { MoneyText, Skeleton } from "@/components/ui/primitives";
import { useMoveDeal } from "../hooks";
import { DealCard } from "./DealCard";
import { WonLostModal } from "./WonLostModal";
import type { Deal } from "@/pages/contacts/types";
import type { KanbanColumn } from "../types";

// ── Droppable column ──────────────────────────────────────────────────────

function KanbanColumnUI({
  column,
  onWonLost,
}: {
  column: KanbanColumn;
  onWonLost: (deal: Deal) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.stage.stage_id });
  const colour = column.stage.colour ?? "#690909";

  return (
    <div className="flex-shrink-0 w-[260px] flex flex-col">
      {/* Column header */}
      <div className="flex items-center gap-2 mb-3">
        <div
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: colour }}
        />
        <span className="text-[12px] font-semibold text-text-primary flex-1 truncate">
          {column.stage.display_name}
        </span>
        <span className="text-[10.5px] text-text-faint font-mono">
          {column.deals.length}
        </span>
      </div>

      {/* Value strip */}
      {column.total_value_ngn > 0 && (
        <div className="text-[10.5px] text-text-faint mb-2 font-mono">
          <MoneyText ngn={column.total_value_ngn} />
        </div>
      )}

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={[
          "flex-1 flex flex-col gap-2 min-h-[120px] p-2 rounded-[14px] transition-all",
          isOver
            ? "bg-accent/[0.08] ring-2 ring-accent/40 ring-dashed"
            : "bg-text-primary/[0.025]",
        ].join(" ")}
      >
        {column.deals.map((deal) => (
          <DraggableDealCard
            key={deal.deal_id}
            deal={deal}
            onWonLost={onWonLost}
          />
        ))}

        {column.deals.length === 0 && !isOver && (
          <div className="flex-1 grid place-items-center text-[11px] text-text-faint italic py-6">
            Drop deals here
          </div>
        )}
      </div>
    </div>
  );
}

// ── Draggable deal card ───────────────────────────────────────────────────

function DraggableDealCard({
  deal,
  onWonLost,
}: {
  deal: Deal;
  onWonLost: (deal: Deal) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: deal.deal_id,
    });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={isDragging ? "opacity-40" : ""}
    >
      <DealCard deal={deal} onWonLost={onWonLost} />
    </div>
  );
}

// ── Main kanban view ──────────────────────────────────────────────────────

interface KanbanViewProps {
  columns: KanbanColumn[];
  isLoading: boolean;
  onAddDeal?: () => void;
}

export function KanbanView({ columns, isLoading, onAddDeal }: KanbanViewProps) {
  const moveDeal = useMoveDeal();
  const [wonLostDeal, setWonLostDeal] = useState<Deal | null>(null);
  const [activeDealId, setActiveDealId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const allDeals = columns.flatMap((c) => c.deals);
  const activeDeal = allDeals.find((d) => d.deal_id === activeDealId);

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveDealId(null);
    if (!over) return;
    const dealId = active.id as string;
    const targetStageId = over.id as string;
    const deal = allDeals.find((d) => d.deal_id === dealId);
    if (!deal || deal.current_stage_id === targetStageId) return;
    moveDeal.mutate({ id: dealId, stageId: targetStageId });
  }

  if (isLoading) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex-shrink-0 w-[260px]">
            <Skeleton className="h-5 w-32 mb-3 rounded" />
            <div className="flex flex-col gap-2">
              {Array.from({ length: 3 - i }).map((_, j) => (
                <Skeleton key={j} className="h-[90px] rounded-[13px]" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={(e: DragStartEvent) =>
          setActiveDealId(e.active.id as string)
        }
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveDealId(null)}
      >
        <div className="flex gap-4 overflow-x-auto pb-4 min-h-[400px]">
          {columns.map((col) => (
            <KanbanColumnUI
              key={col.stage.stage_id}
              column={col}
              onWonLost={setWonLostDeal}
            />
          ))}

          {/* Add deal column shortcut */}
          {onAddDeal && (
            <div className="flex-shrink-0 w-[260px]">
              <button
                type="button"
                onClick={onAddDeal}
                className="w-full h-[80px] rounded-[14px] border border-dashed border-line text-text-faint hover:border-accent/50 hover:text-accent transition-all flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span className="text-[12px] font-semibold">New deal</span>
              </button>
            </div>
          )}
        </div>

        {/* Drag overlay — floating ghost card */}
        <DragOverlay>
          {activeDeal ? <DealCard deal={activeDeal} isDragging /> : null}
        </DragOverlay>
      </DndContext>

      {wonLostDeal && (
        <WonLostModal deal={wonLostDeal} onClose={() => setWonLostDeal(null)} />
      )}
    </>
  );
}
