import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/primitives";
import type { CalendarEvent } from "./types";
import {
  buildMonthGrid,
  DAY_SHORT,
  isSameDay,
  isToday,
  formatTime,
  toISODate,
  EVENT_TYPE_COLOURS,
} from "./constants";

interface CalendarGridProps {
  year: number;
  month: number;
  events: CalendarEvent[];
  loading?: boolean;
  onSelectDay: (date: Date) => void;
  onSelectEvent: (event: CalendarEvent) => void;
  onCreateEvent: (date: Date) => void;
}

const MAX_VISIBLE_EVENTS = 3;

export default function CalendarGrid({
  year,
  month,
  events,
  loading,
  onSelectDay,
  onSelectEvent,
  onCreateEvent,
}: CalendarGridProps) {
  const weeks = useMemo(() => buildMonthGrid(year, month), [year, month]);

  /** Map ISO date string -> events for O(1) lookup per cell. */
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const key = toISODate(new Date(ev.start_at));
      const list = map.get(key);
      if (list) {
        list.push(ev);
      } else {
        map.set(key, [ev]);
      }
    }
    return map;
  }, [events]);

  // ── Loading skeleton ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div>
        {/* Day header row */}
        <div className="grid grid-cols-7">
          {DAY_SHORT.map((d) => (
            <div
              key={d}
              className="p-2 text-center text-[11px] font-semibold uppercase tracking-wider text-text-muted"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Skeleton grid */}
        <div className="grid grid-cols-7">
          {Array.from({ length: 42 }).map((_, i) => (
            <div
              key={i}
              className="min-h-[100px] max-md:min-h-[60px] p-1.5 border border-line/30"
            >
              <Skeleton className="w-5 h-4 mb-2" />
              <Skeleton className="w-full h-3 mb-1" />
              <Skeleton className="w-3/4 h-3" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Rendered grid ─────────────────────────────────────────────────────
  return (
    <div>
      {/* Day header row */}
      <div className="grid grid-cols-7">
        {DAY_SHORT.map((d) => (
          <div
            key={d}
            className="p-2 text-center text-[11px] font-semibold uppercase tracking-wider text-text-muted"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Week rows */}
      <div className="grid grid-cols-7">
        {weeks.map((week) =>
          week.map((date) => {
            const inMonth = date.getMonth() === month;
            const today = isToday(date);
            const key = toISODate(date);
            const dayEvents = eventsByDate.get(key) ?? [];
            const visible = dayEvents.slice(0, MAX_VISIBLE_EVENTS);
            const overflow = dayEvents.length - MAX_VISIBLE_EVENTS;

            return (
              <div
                key={key}
                className={cn(
                  "min-h-[100px] max-md:min-h-[60px] p-1.5 border border-line/30 cursor-pointer transition-colors hover:bg-text-primary/[0.04]",
                  !inMonth && "opacity-40",
                )}
                onClick={() => onSelectDay(date)}
                onDoubleClick={() => onCreateEvent(date)}
              >
                {/* Day number */}
                <div className="flex items-start justify-start mb-1">
                  <span
                    className={cn(
                      "text-[12px] font-mono font-semibold",
                      today
                        ? "bg-accent-deep text-[#F4E9D9] rounded-full w-7 h-7 grid place-items-center"
                        : inMonth
                          ? "text-text-primary"
                          : "text-text-faint",
                    )}
                  >
                    {date.getDate()}
                  </span>
                </div>

                {/* Event pills */}
                <div className="max-md:hidden">
                  {visible.map((ev) => {
                    const colourClasses =
                      EVENT_TYPE_COLOURS[ev.event_type] ??
                      EVENT_TYPE_COLOURS.other;

                    return (
                      <div
                        key={ev.event_id}
                        className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded-md truncate cursor-pointer mb-0.5",
                          colourClasses,
                        )}
                        title={`${ev.all_day ? "All day" : formatTime(ev.start_at)} — ${ev.title}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectEvent(ev);
                        }}
                      >
                        {ev.all_day ? ev.title : `${formatTime(ev.start_at)} ${ev.title}`}
                      </div>
                    );
                  })}

                  {overflow > 0 && (
                    <div className="text-[10px] text-text-muted px-1.5">
                      +{overflow} more
                    </div>
                  )}
                </div>

                {/* Mobile: just show dot indicators */}
                <div className="md:hidden flex gap-0.5 flex-wrap">
                  {dayEvents.length > 0 && (
                    <span className="w-1.5 h-1.5 rounded-full bg-accent-deep" />
                  )}
                </div>
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}
