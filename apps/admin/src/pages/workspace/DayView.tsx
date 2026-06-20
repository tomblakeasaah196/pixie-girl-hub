import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/primitives";
import {
  isToday,
  isSameDay,
  formatTime,
  getHours,
  formatHour,
  DAY_NAMES,
  MONTH_NAMES,
} from "./constants";
import type { CalendarEvent } from "./types";

interface DayViewProps {
  date: Date;
  events: CalendarEvent[];
  loading?: boolean;
  onSelectEvent: (event: CalendarEvent) => void;
  onCreateEvent: (date: Date) => void;
}

export function DayView({
  date,
  events,
  loading,
  onSelectEvent,
  onCreateEvent,
}: DayViewProps) {
  const hours = getHours();
  const dayEvents = events.filter((e) => isSameDay(new Date(e.start_at), date));

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-10 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* Day header */}
      <div className="text-center mb-4">
        <div className="text-[11px] text-text-faint uppercase tracking-wide">
          {DAY_NAMES[date.getDay()]}
        </div>
        <div
          className={cn(
            "text-[28px] font-display font-medium mt-1 mx-auto",
            isToday(date)
              ? "w-11 h-11 rounded-full bg-accent-deep text-[#F4E9D9] grid place-items-center"
              : "text-text-primary",
          )}
        >
          {date.getDate()}
        </div>
        <div className="text-[12px] text-text-muted mt-0.5">
          {MONTH_NAMES[date.getMonth()]} {date.getFullYear()}
        </div>
      </div>

      {/* Time grid */}
      <div className="max-h-[600px] overflow-y-auto">
        {hours.map((hour) => {
          const hourEvents = dayEvents.filter(
            (e) => new Date(e.start_at).getHours() === hour,
          );
          return (
            <div
              key={hour}
              className="flex border-b border-line/20 min-h-[52px] cursor-pointer hover:bg-text-primary/[0.02] transition-colors"
              onDoubleClick={() => {
                const nd = new Date(date);
                nd.setHours(hour, 0, 0, 0);
                onCreateEvent(nd);
              }}
            >
              <div className="w-[60px] shrink-0 p-1.5 text-[10px] text-text-faint font-mono text-right pr-3">
                {formatHour(hour)}
              </div>
              <div className="flex-1 p-1 space-y-0.5">
                {hourEvents.map((ev) => (
                  <button
                    key={ev.event_id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectEvent(ev);
                    }}
                    className="w-full text-left text-[12px] px-2.5 py-1.5 rounded-lg bg-accent/15 text-accent-glow hover:bg-accent/25 transition-colors"
                  >
                    <span className="font-mono text-[10px] text-text-faint mr-2">
                      {formatTime(ev.start_at)}
                    </span>
                    {ev.title}
                    {ev.location && (
                      <span className="text-[10px] text-text-faint ml-2">
                        {ev.location}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
