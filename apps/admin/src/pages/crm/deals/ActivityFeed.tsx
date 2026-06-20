import { Skeleton } from "@/components/ui/primitives";
import { ActivityIcon, activityLabel } from "../shared/ActivityIcon";
import type { CrmActivity } from "@/pages/contacts/types";

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const OUTCOME_LABELS: Record<string, string> = {
  connected: "Connected",
  no_answer: "No answer",
  left_voicemail: "Left voicemail",
  reschedule_requested: "Reschedule requested",
  interested: "Interested",
  not_interested: "Not interested",
  follow_up_required: "Follow-up required",
  converted: "Converted",
};

interface ActivityFeedProps {
  activities: CrmActivity[];
  isLoading: boolean;
}

export function ActivityFeed({ activities, isLoading }: ActivityFeedProps) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="w-8 h-8 rounded-full flex-shrink-0" />
            <div className="flex-1 flex flex-col gap-1.5">
              <Skeleton className="h-4 w-32 rounded" />
              <Skeleton className="h-3 w-48 rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!activities.length) {
    return (
      <div className="py-8 text-center text-text-faint text-[13px]">
        No activity yet — log the first touchpoint above.
      </div>
    );
  }

  const sorted = [...activities].sort(
    (a, b) =>
      new Date(b.performed_at).getTime() - new Date(a.performed_at).getTime(),
  );

  return (
    <div className="relative">
      {/* Timeline line */}
      <div className="absolute left-4 top-4 bottom-4 w-px bg-line" />

      <div className="flex flex-col gap-4">
        {sorted.map((act) => (
          <div key={act.activity_id} className="flex gap-3 relative">
            <div className="relative z-10">
              <ActivityIcon type={act.activity_type} />
            </div>

            <div className="flex-1 min-w-0 pt-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[12.5px] font-semibold text-text-primary">
                  {activityLabel(act.activity_type)}
                </span>
                {act.direction && act.direction !== "internal" && (
                  <span className="text-[10.5px] text-text-faint capitalize">
                    {act.direction}
                  </span>
                )}
                {act.outcome && (
                  <span className="text-[10.5px] text-success">
                    {OUTCOME_LABELS[act.outcome] ?? act.outcome}
                  </span>
                )}
              </div>

              {act.subject && (
                <div className="text-[12px] text-text-muted mt-0.5">
                  {act.subject}
                </div>
              )}

              {act.body && (
                <div className="mt-1 p-2.5 rounded-[9px] bg-text-primary/[0.04] border hairline text-[12px] text-text-muted leading-relaxed whitespace-pre-wrap">
                  {act.body}
                </div>
              )}

              {act.duration_minutes && (
                <div className="text-[10.5px] text-text-faint mt-1">
                  Duration: {act.duration_minutes} min
                </div>
              )}

              {act.scheduled_at && (
                <div className="text-[10.5px] text-warn mt-1">
                  Scheduled:{" "}
                  {new Date(act.scheduled_at).toLocaleString("en-NG", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </div>
              )}

              <div className="text-[10.5px] text-text-faint mt-1">
                {relTime(act.performed_at)}
                {act.performed_by_name && ` · ${act.performed_by_name}`}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
