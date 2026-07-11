/**
 * Chief of Staff — Meeting Prep card (PR5).
 *
 * A pre-meeting brief for a calendar event: the linked goal's status, its open
 * milestones, the questions worth raising, recent linked notes and who's in the
 * room. Deterministic — reads real Workspace data — so it renders even with no
 * AI vendor configured. Design canon: glass overlay, accent tokens, four states.
 */

import { createPortal } from "react-dom";
import {
  X,
  CalendarClock,
  Target,
  Flag,
  HelpCircle,
  StickyNote,
  Users,
  AlertCircle,
  RotateCw,
} from "lucide-react";
import { Pill, Skeleton } from "@/components/ui/primitives";
import { useCosPrep } from "@/lib/cos-api";

function when(iso: string) {
  return new Date(iso).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MeetingPrepCard({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const { data, isLoading, isError, refetch } = useCosPrep(eventId);

  return createPortal(
    <div className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-[3px] grid place-items-center p-4" onClick={onClose}>
      <div
        className="w-[min(520px,100vw)] max-h-[85vh] overflow-y-auto dropglass shadow-glass rounded-2xl animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center gap-2 p-4 border-b hairline dropglass">
          <CalendarClock className="w-4 h-4 text-accent-glow" />
          <span className="font-display text-[15px] font-medium flex-1">Meeting prep</span>
          <button
            onClick={onClose}
            className="w-8 h-8 grid place-items-center rounded-lg text-text-faint hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-5">
          {isError ? (
            <div className="flex flex-col items-center gap-2.5 py-8 text-center">
              <AlertCircle className="w-5 h-5 text-danger" />
              <p className="text-[12.5px] text-text-muted">Couldn't build the brief.</p>
              <button
                onClick={() => refetch()}
                className="inline-flex items-center gap-1.5 rounded-lg border hairline px-3 py-1.5 text-[12px] hover:text-text-primary"
              >
                <RotateCw className="w-3.5 h-3.5" /> Retry
              </button>
            </div>
          ) : isLoading || !data ? (
            <div className="space-y-3">
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-24 rounded-xl" />
              <Skeleton className="h-16 rounded-xl" />
            </div>
          ) : (
            <>
              {/* Event */}
              <div>
                <div className="font-display text-[15px] font-medium">{data.event.title}</div>
                <div className="text-[12px] text-text-muted mt-0.5">
                  {when(data.event.start_at)}
                  {data.event.location ? ` · ${data.event.location}` : ""}
                </div>
              </div>

              {/* Goal status */}
              {data.goal && (
                <div className="rounded-xl bg-accent/[0.04] border hairline p-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Target className="w-3.5 h-3.5 text-accent-glow" />
                    <span className="text-[13px] font-semibold flex-1 truncate">{data.goal.title}</span>
                    <span className="font-mono text-[12px] text-text-muted">{data.goal.progress_pct}%</span>
                  </div>
                  <Pill tone={data.goal.health === "on_track" ? "success" : data.goal.health === "behind" ? "danger" : "warn"} dot={false}>
                    {data.goal.health.replace("_", " ")}
                  </Pill>
                </div>
              )}

              {/* Open questions */}
              {data.open_questions.length > 0 && (
                <Section icon={<HelpCircle className="w-4 h-4" />} title="Worth raising">
                  <ul className="space-y-1.5">
                    {data.open_questions.map((q, i) => (
                      <li key={i} className="flex gap-2 text-[12.5px] text-text-muted">
                        <span className="text-accent-glow">•</span>
                        {q}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {/* Open milestones */}
              {data.open_milestones.length > 0 && (
                <Section icon={<Flag className="w-4 h-4" />} title="Open milestones">
                  <div className="space-y-1">
                    {data.open_milestones.map((m) => (
                      <div key={m.milestone_id} className="flex items-center gap-2 text-[12.5px]">
                        <span className="flex-1 truncate text-text-muted">{m.title}</span>
                        {m.target_date && (
                          <span className="font-mono text-[10.5px] text-text-faint">{String(m.target_date).slice(0, 10)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Recent notes */}
              {data.recent_notes.length > 0 && (
                <Section icon={<StickyNote className="w-4 h-4" />} title="Recent notes">
                  <div className="space-y-1.5">
                    {data.recent_notes.map((n) => (
                      <div key={n.note_id} className="rounded-lg bg-text-primary/[0.03] p-2 text-[12px] text-text-muted">
                        {n.title && <div className="font-semibold text-text-primary mb-0.5">{n.title}</div>}
                        {n.excerpt}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Participants */}
              {data.participants.length > 0 && (
                <Section icon={<Users className="w-4 h-4" />} title="In the room">
                  <div className="flex flex-wrap gap-1.5">
                    {data.participants.map((p) => (
                      <span
                        key={p.participant_id}
                        className="rounded-full border hairline bg-text-primary/[0.03] px-2.5 py-1 text-[11.5px] text-text-muted"
                      >
                        {p.name}
                        {p.is_organiser ? " (host)" : ""}
                      </span>
                    ))}
                  </div>
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-accent-glow">{icon}</span>
        <span className="text-[13px] font-semibold">{title}</span>
      </div>
      {children}
    </div>
  );
}
