import { Sparkles, MessagesSquare, Target, CalendarClock } from "lucide-react";
import { Card } from "@/components/ui/primitives";

/**
 * Placeholder for the AI Chief of Staff chat (delivered in PR3). PR2 ships the
 * tab so the surface exists; the conversational agent + batch-plan approval
 * land next. The assistant's custom name (default "Chief of Staff") arrives
 * with settings in PR6.
 */
export function ChiefOfStaffTab() {
  return (
    <div className="max-w-[720px] mx-auto">
      <Card className="p-8 text-center">
        <div className="w-[78px] h-[78px] rounded-[22px] mx-auto mb-5 grid place-items-center text-accent-glow bg-accent/10 border border-accent/20">
          <Sparkles className="w-8 h-8" />
        </div>
        <h2 className="font-display text-2xl font-medium mb-2">
          Your Chief of Staff is almost here
        </h2>
        <p className="text-[13px] text-text-muted max-w-[460px] mx-auto mb-7">
          Soon you'll just talk. Describe a goal in plain language and your Chief
          of Staff will draft the whole plan — milestones, tasks, deadlines and
          reminders — for you to approve in one tap, then follow up to keep it on
          track.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
          {[
            {
              icon: <MessagesSquare className="w-4 h-4" />,
              title: "Chat to plan",
              body: "“Launch Accessories in August” → a structured plan.",
            },
            {
              icon: <Target className="w-4 h-4" />,
              title: "One-tap approval",
              body: "Review the full plan, approve it all at once.",
            },
            {
              icon: <CalendarClock className="w-4 h-4" />,
              title: "Proactive follow-up",
              body: "Nudges when something's due or slipping.",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="rounded-[14px] bg-text-primary/[0.03] border hairline p-3.5"
            >
              <div className="text-accent-glow mb-1.5">{f.icon}</div>
              <div className="text-[13px] font-semibold mb-0.5">{f.title}</div>
              <div className="text-[11.5px] text-text-muted">{f.body}</div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-text-faint mt-6">
          Meanwhile, build goals and notes in the tabs above — your Chief of
          Staff will pick up right where you left off.
        </p>
      </Card>
    </div>
  );
}
