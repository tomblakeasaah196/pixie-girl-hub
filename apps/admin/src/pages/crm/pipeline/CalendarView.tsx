import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/primitives";
import type { KanbanColumn } from "../types";
import type { Deal } from "@/pages/contacts/types";

interface CalendarViewProps {
  columns: KanbanColumn[];
  isLoading: boolean;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function CalendarView({ columns, isLoading }: CalendarViewProps) {
  const navigate = useNavigate();
  const today = new Date();
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const allDeals = columns.flatMap((col) =>
    col.deals
      .filter((d) => d.expected_close_date)
      .map((d) => ({ deal: d, colour: col.stage.colour ?? "#690909" })),
  );

  // Group deals by close date
  const dealsByDate = new Map<string, { deal: Deal; colour: string }[]>();
  for (const item of allDeals) {
    const key = item.deal.expected_close_date!.slice(0, 10);
    if (!dealsByDate.has(key)) dealsByDate.set(key, []);
    dealsByDate.get(key)!.push(item);
  }

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));

  if (isLoading) {
    return <Skeleton className="h-[400px] rounded-[14px]" />;
  }

  // Calendar grid — pad with empty cells
  const cells: (number | null)[] = [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null);

  const todayStr = today.toISOString().slice(0, 10);

  return (
    <div>
      {/* Navigation */}
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={prevMonth}
          className="w-8 h-8 grid place-items-center rounded-[9px] text-text-faint hover:text-text-primary hover:bg-text-primary/[0.08] transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-[14px] font-semibold text-text-primary">
          {MONTHS[month]} {year}
        </span>
        <button
          type="button"
          onClick={nextMonth}
          className="w-8 h-8 grid place-items-center rounded-[9px] text-text-faint hover:text-text-primary hover:bg-text-primary/[0.08] transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAYS.map((d) => (
          <div key={d} className="text-center text-[10.5px] font-semibold text-text-faint py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, idx) => {
          if (day === null) {
            return <div key={`empty-${idx}`} className="h-[80px]" />;
          }

          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dayDeals = dealsByDate.get(dateStr) ?? [];
          const isToday = dateStr === todayStr;
          const isPast = dateStr < todayStr;

          return (
            <div
              key={dateStr}
              className={[
                "min-h-[80px] p-1.5 rounded-[10px] border hairline",
                isToday ? "border-accent/40 bg-accent/[0.05]" : "bg-text-primary/[0.02]",
                isPast && !isToday ? "opacity-60" : "",
              ].join(" ")}
            >
              <div
                className={[
                  "text-[11px] font-semibold mb-1",
                  isToday ? "text-accent" : "text-text-faint",
                ].join(" ")}
              >
                {isToday ? (
                  <span className="inline-flex w-5 h-5 rounded-full bg-accent text-[#F4E9D9] items-center justify-center">
                    {day}
                  </span>
                ) : (
                  day
                )}
              </div>

              {/* Deal dots / mini cards */}
              <div className="flex flex-col gap-0.5">
                {dayDeals.slice(0, 3).map(({ deal, colour }) => (
                  <button
                    key={deal.deal_id}
                    type="button"
                    onClick={() => navigate(`/crm/deals/${deal.deal_id}`)}
                    className="w-full text-left truncate px-1 py-0.5 rounded-[4px] text-[9.5px] font-medium transition-opacity hover:opacity-80"
                    style={{ backgroundColor: `${colour}22`, color: colour }}
                  >
                    {deal.title}
                  </button>
                ))}
                {dayDeals.length > 3 && (
                  <span className="text-[9px] text-text-faint px-1">+{dayDeals.length - 3}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      {columns.filter((c) => c.deals.length > 0).length > 0 && (
        <div className="flex flex-wrap gap-3 mt-4 pt-4 border-t hairline">
          {columns
            .filter((c) => c.deals.length > 0)
            .map((col) => (
              <div key={col.stage.stage_id} className="flex items-center gap-1.5">
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: col.stage.colour ?? "#690909" }}
                />
                <span className="text-[11px] text-text-faint">{col.stage.display_name}</span>
              </div>
            ))}
        </div>
      )}

      {allDeals.length === 0 && (
        <div className="py-8 text-center text-text-faint text-[13px]">
          No deals with close dates set
        </div>
      )}
    </div>
  );
}
