import { Calendar, Clock, MapPin } from "lucide-react";
import { cn } from "@/lib/cn";
import { Skeleton, EmptyState } from "@/components/ui/primitives";
import { formatTime, MONTH_NAMES, isSameDay } from "./constants";
import type { CalendarEvent } from "./types";

interface AgendaViewProps {
  events: CalendarEvent[];
  loading?: boolean;
  onSelectEvent: (event: CalendarEvent) => void;
}

/** Group events by date, sorted chronologically. */
function groupByDate(
  events: CalendarEvent[],
): { date: Date; events: CalendarEvent[] }[] {
  const sorted = [...events].sort(
    (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
  );
  const groups: { date: Date; events: CalendarEvent[] }[] = [];
  for (const ev of sorted) {
    const d = new Date(ev.start_at);
    const last = groups[groups.length - 1];
    if (last && isSameDay(last.date, d)) {
      last.events.push(ev);
    } else {
      groups.push({ date: d, events: [ev] });
    }
  }
  return groups;
}

export function AgendaView({
  events,
  loading,
  onSelectEvent,
}: AgendaViewProps) {
  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i}>
            <Skeleton className="h-4 w-32 mb-2 rounded" />
            <Skeleton className="h-14 rounded-xl" />
          </div>
        ))}
      </div>
    );
  }

  const groups = groupByDate(events);

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={<Calendar className="w-7 h-7" />}
        title="No events"
        message="No events in this date range."
      />
    );
  }

  return (
    <div className="space-y-5">
      {groups.map((group) => {
        const isToday = isSameDay(group.date, new Date());
        return (
          <div key={group.date.toISOString()}>
            <div className="flex items-center gap-2 mb-2">
              <div
                className={cn(
                  "text-[12px] font-semibold uppercase tracking-wide",
                  isToday ? "text-accent-glow" : "text-text-faint",
                )}
              >
                {isToday
                  ? "Today"
                  : `${MONTH_NAMES[group.date.getMonth()]} ${group.date.getDate()}`}
              </div>
              <div className="flex-1 h-px bg-line/40" />
            </div>
            <div className="space-y-1.5">
              {group.events.map((ev) => (
                <button
                  key={ev.event_id}
                  onClick={() => onSelectEvent(ev)}
                  className="w-full text-left glass rounded-xl p-3 hover:bg-text-primary/[0.04] transition-colors group"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-1 h-full min-h-[32px] rounded-full bg-accent/40 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-text-primary truncate group-hover:text-accent-glow transition-colors">
                        {ev.title}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-text-faint">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {ev.all_day
                            ? "All day"
                            : `${formatTime(ev.start_at)} - ${formatTime(ev.end_at)}`}
                        </span>
                        {ev.location && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {ev.location}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
