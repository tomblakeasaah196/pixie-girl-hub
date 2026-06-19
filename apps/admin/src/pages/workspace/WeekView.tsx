import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/primitives";
import { buildWeekDays, isToday, isSameDay, formatTime, getHours, formatHour, DAY_SHORT } from "./constants";
import type { CalendarEvent } from "./types";

interface WeekViewProps {
  date: Date;
  events: CalendarEvent[];
  loading?: boolean;
  onSelectEvent: (event: CalendarEvent) => void;
  onCreateEvent: (date: Date) => void;
}

export function WeekView({ date, events, loading, onSelectEvent, onCreateEvent }: WeekViewProps) {
  const days = buildWeekDays(date);
  const hours = getHours();

  function eventsForDay(d: Date) {
    return events.filter((e) => {
      const start = new Date(e.start_at);
      return isSameDay(start, d);
    });
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-10 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      {/* Day headers */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b hairline">
        <div className="p-2" />
        {days.map((d, i) => (
          <div key={i} className="p-2 text-center border-l border-line/30">
            <div className="text-[10px] text-text-faint uppercase tracking-wide">
              {DAY_SHORT[d.getDay()]}
            </div>
            <div
              className={cn(
                "text-[14px] font-mono font-semibold mt-0.5 mx-auto",
                isToday(d)
                  ? "w-7 h-7 rounded-full bg-accent-deep text-[#F4E9D9] grid place-items-center"
                  : "text-text-primary",
              )}
            >
              {d.getDate()}
            </div>
          </div>
        ))}
      </div>

      {/* Time grid */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] max-h-[600px] overflow-y-auto">
        {hours.map((hour) => (
          <div key={hour} className="contents">
            <div className="p-1.5 text-[10px] text-text-faint font-mono text-right pr-2 h-[52px] border-b border-line/20">
              {formatHour(hour)}
            </div>
            {days.map((d, di) => {
              const dayEvents = eventsForDay(d).filter((e) => {
                const h = new Date(e.start_at).getHours();
                return h === hour;
              });
              return (
                <div
                  key={di}
                  className="border-l border-b border-line/20 h-[52px] p-0.5 cursor-pointer hover:bg-text-primary/[0.02] transition-colors"
                  onDoubleClick={() => {
                    const nd = new Date(d);
                    nd.setHours(hour, 0, 0, 0);
                    onCreateEvent(nd);
                  }}
                >
                  {dayEvents.map((ev) => (
                    <button
                      key={ev.event_id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectEvent(ev);
                      }}
                      className="w-full text-left text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent-glow truncate mb-0.5 hover:bg-accent/25 transition-colors"
                    >
                      {formatTime(ev.start_at)} {ev.title}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
