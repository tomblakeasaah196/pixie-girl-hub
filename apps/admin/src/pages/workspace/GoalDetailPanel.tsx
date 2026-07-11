import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Plus,
  Pencil,
  Trash2,
  Flag,
  ListTodo,
  CalendarDays,
  StickyNote,
  Link2,
  Unlink,
  Sparkles,
  BookMarked,
  CalendarClock,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, Pill, Skeleton } from "@/components/ui/primitives";
import { ErrorState, Select } from "@/components/ui/controls";
import { ProgressRing } from "./ProgressRing";
import { MeetingPrepCard } from "./MeetingPrepCard";
import {
  useGoal,
  useAddMilestone,
  useUpdateMilestone,
  useDeleteMilestone,
  useDeleteGoal,
  useLinkTask,
  useUnlinkTask,
  useNotes,
  useCreateNote,
} from "./goals-hooks";
import { useTaskBoard } from "./hooks";
import {
  GOAL_STATUS_META,
  GOAL_HEALTH_META,
  GOAL_PRIORITY_META,
  MILESTONE_STATUS_OPTIONS,
} from "./goals-constants";
import { TASK_STATUS_META, TASK_PRIORITY_META } from "./constants";
import { toastReport } from "@/lib/error-report";
import {
  useCosFollowups,
  useSnoozeFollowup,
  useDismissFollowup,
  useSaveTemplate,
} from "@/lib/cos-api";
import type { Goal, MilestoneStatus } from "./goals-types";
import type { Task } from "./types";

function formatDate(v: string | null | undefined): string | null {
  if (!v) return null;
  return new Date(String(v).slice(0, 10) + "T00:00:00").toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function GoalDetailPanel({
  goal: summary,
  onClose,
  onEdit,
}: {
  goal: Goal;
  onClose: () => void;
  onEdit: (g: Goal) => void;
}) {
  const goalId = summary.goal_id;
  const { data: goal, isLoading, isError, refetch } = useGoal(goalId);

  return createPortal(
    <div
      className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-[3px]"
      onClick={onClose}
    >
      <div
        className="absolute right-0 top-0 bottom-0 w-[min(560px,100vw)] overflow-y-auto dropglass shadow-glass animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center gap-2 p-4 border-b hairline dropglass">
          <span className="font-display text-[15px] font-medium flex-1 truncate">
            {(goal ?? summary).title}
          </span>
          <Button
            variant="ghost"
            size="sm"
            icon={<Pencil className="w-3.5 h-3.5" />}
            onClick={() => onEdit(goal ?? summary)}
          >
            Edit
          </Button>
          <button
            onClick={onClose}
            className="w-8 h-8 grid place-items-center rounded-lg text-text-faint hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4">
          {isError && (
            <ErrorState message="Could not load this goal." onRetry={refetch} />
          )}
          {isLoading && !goal && (
            <div className="space-y-3">
              <Skeleton className="h-20 rounded-xl" />
              <Skeleton className="h-32 rounded-xl" />
            </div>
          )}
          {goal && <GoalBody goal={goal} onDeleted={onClose} />}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function GoalBody({ goal, onDeleted }: { goal: Goal; onDeleted: () => void }) {
  const status = GOAL_STATUS_META[goal.status];
  const health = GOAL_HEALTH_META[goal.health];
  const priority = GOAL_PRIORITY_META[goal.priority];
  const deleteGoal = useDeleteGoal();
  const saveTemplate = useSaveTemplate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [savedPlaybook, setSavedPlaybook] = useState(false);

  const handleDelete = async () => {
    try {
      await deleteGoal.mutateAsync(goal.goal_id);
      onDeleted();
    } catch (err) {
      toastReport("Workspace → Goal", "Delete goal", err);
    }
  };

  const handleSavePlaybook = async () => {
    try {
      await saveTemplate.mutateAsync({ goal_id: goal.goal_id });
      setSavedPlaybook(true);
    } catch {
      /* toasted by the mutation */
    }
  };

  return (
    <div className="space-y-6">
      {/* Overview */}
      <div className="flex items-center gap-4">
        <ProgressRing value={goal.progress_pct ?? 0} size={60} stroke={5} />
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone={status.tone} dot={false}>
            {status.label}
          </Pill>
          {goal.status === "active" && (
            <Pill tone={health.tone} dot={false}>
              {health.label}
            </Pill>
          )}
          <Pill tone={priority.tone} dot={false}>
            {priority.label}
          </Pill>
          {goal.target_date && (
            <span className="text-[11px] font-mono text-text-faint">
              Target {formatDate(goal.target_date)}
            </span>
          )}
        </div>
      </div>

      {goal.description && (
        <p className="text-[13px] text-text-muted whitespace-pre-wrap">
          {goal.description}
        </p>
      )}

      <AiInsightsSection goal={goal} />
      <MilestonesSection goal={goal} />
      <LinkedTasksSection goal={goal} />
      <LinkedEventsSection goal={goal} />
      <GoalNotesSection goalId={goal.goal_id} />

      {/* Save as playbook (wow #9) */}
      <div className="pt-2 border-t hairline">
        <Button
          variant="ghost"
          size="sm"
          icon={<BookMarked className="w-3.5 h-3.5" />}
          onClick={handleSavePlaybook}
          disabled={saveTemplate.isPending || savedPlaybook}
        >
          {savedPlaybook
            ? "Saved as playbook ✓"
            : saveTemplate.isPending
              ? "Saving…"
              : "Save as playbook"}
        </Button>
        <span className="ml-2 text-[11px] text-text-faint">
          Reuse this goal's plan later with fresh dates.
        </span>
      </div>

      {/* Danger zone */}
      <div className="pt-2 border-t hairline">
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-text-muted flex-1">
              Delete this goal? Linked tasks/events are kept (just unlinked).
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleDelete}
              disabled={deleteGoal.isPending}
            >
              {deleteGoal.isPending ? "Deleting..." : "Delete"}
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 className="w-3.5 h-3.5" />}
            onClick={() => setConfirmDelete(true)}
          >
            Delete goal
          </Button>
        )}
      </div>
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  count,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <span className="text-accent-glow">{icon}</span>
      <span className="text-[13px] font-semibold">{title}</span>
      {count !== undefined && (
        <span className="text-[11px] text-text-faint font-mono">{count}</span>
      )}
      <span className="ml-auto">{action}</span>
    </div>
  );
}

const HEALTH_NOTE: Record<string, string> = {
  on_track: "On track — progressing well against the target.",
  at_risk: "At risk — this may slip past its target date.",
  behind: "Behind — something is overdue or projected to miss the target.",
  achieved: "Achieved 🎉",
};

const TRIGGER_LABEL: Record<string, string> = {
  no_progress: "No progress",
  slippage: "Projected to slip",
  overdue: "Overdue",
  due_today: "Due today",
  due_tomorrow: "Due tomorrow",
  weekly_review: "Weekly review",
};

/**
 * AI Insights (PR4) — the CoS accountability read-out for a goal: health with a
 * plain-language note, and the goal's open follow-ups (snooze / dismiss). Fills
 * the PR2 placeholder.
 */
function AiInsightsSection({ goal }: { goal: Goal }) {
  const health = GOAL_HEALTH_META[goal.health];
  const { data: followups = [], isLoading } = useCosFollowups({
    subject_type: "goal",
    subject_id: goal.goal_id,
  });
  const snooze = useSnoozeFollowup();
  const dismiss = useDismissFollowup();

  const open = followups.filter(
    (f) => f.state === "open" || f.state === "asked" || f.state === "answered",
  );

  return (
    <div>
      <SectionHeader
        icon={<Sparkles className="w-4 h-4" />}
        title="AI Insights"
        count={open.length || undefined}
      />
      <div className="rounded-xl bg-accent/[0.04] border hairline p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Pill tone={health.tone} dot={false}>
            {health.label}
          </Pill>
          <span className="text-[12px] text-text-muted">
            {HEALTH_NOTE[goal.health] ?? ""}
          </span>
        </div>

        {isLoading ? (
          <Skeleton className="h-4 w-2/3" />
        ) : open.length === 0 ? (
          <p className="text-[12px] text-text-faint italic">
            No open follow-ups — your Chief of Staff has nothing to chase here.
          </p>
        ) : (
          <div className="space-y-1.5">
            {open.map((f) => (
              <div
                key={f.followup_id}
                className="flex items-start gap-2 rounded-lg bg-text-primary/[0.03] p-2"
              >
                <Pill tone="warn" dot={false}>
                  {TRIGGER_LABEL[f.trigger] ?? f.trigger}
                </Pill>
                <span className="flex-1 text-[12px] text-text-muted">
                  {f.question || "Follow-up"}
                  {f.reason && (
                    <span className="block text-[11px] text-text-faint mt-0.5">
                      Reason: {f.reason}
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() =>
                      snooze.mutate({
                        id: f.followup_id,
                        until: new Date(Date.now() + 86_400_000).toISOString(),
                      })
                    }
                    disabled={snooze.isPending}
                    className="px-2 py-0.5 rounded-lg text-[11px] text-text-faint hover:text-accent hover:bg-accent/10 transition-colors"
                    title="Snooze 1 day"
                  >
                    Snooze
                  </button>
                  <button
                    onClick={() => dismiss.mutate({ id: f.followup_id })}
                    disabled={dismiss.isPending}
                    className="px-2 py-0.5 rounded-lg text-[11px] text-text-faint hover:text-danger hover:bg-danger/10 transition-colors"
                    title="Dismiss"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MilestonesSection({ goal }: { goal: Goal }) {
  const milestones = goal.milestones ?? [];
  const add = useAddMilestone(goal.goal_id);
  const update = useUpdateMilestone(goal.goal_id);
  const del = useDeleteMilestone(goal.goal_id);
  const [newTitle, setNewTitle] = useState("");

  const submitNew = async () => {
    const t = newTitle.trim();
    if (!t) return;
    try {
      await add.mutateAsync({ title: t });
      setNewTitle("");
    } catch (err) {
      toastReport("Workspace → Goal", "Add milestone", err);
    }
  };

  return (
    <div>
      <SectionHeader
        icon={<Flag className="w-4 h-4" />}
        title="Milestones"
        count={milestones.length}
      />
      <div className="space-y-1.5">
        {milestones.map((m) => (
          <div
            key={m.milestone_id}
            className="flex items-center gap-2 p-2 rounded-xl bg-text-primary/[0.03]"
          >
            <span
              className={cn(
                "text-[13px] flex-1 truncate",
                m.status === "done" && "line-through text-text-faint",
              )}
            >
              {m.title}
            </span>
            {m.target_date && (
              <span className="text-[10px] font-mono text-text-faint shrink-0">
                {formatDate(m.target_date)}
              </span>
            )}
            <div className="w-[130px] shrink-0">
              <Select
                value={m.status}
                onChange={(v: string) =>
                  update.mutate({
                    milestoneId: m.milestone_id,
                    input: { status: v as MilestoneStatus },
                  })
                }
                options={MILESTONE_STATUS_OPTIONS}
              />
            </div>
            <button
              onClick={() => del.mutate(m.milestone_id)}
              className="w-7 h-7 grid place-items-center rounded-lg text-text-faint hover:text-danger hover:bg-danger/10 transition-colors shrink-0"
              aria-label="Delete milestone"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {milestones.length === 0 && (
          <p className="text-[12px] text-text-faint italic py-1">
            No milestones yet.
          </p>
        )}
      </div>
      {/* Add milestone */}
      <div className="flex items-center gap-2 mt-2">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitNew()}
          placeholder="Add a milestone…"
          className="flex-1 h-[34px] px-3 rounded-[10px] bg-text-primary/[0.04] border border-line text-[12px] text-text-primary outline-none focus:border-accent/50"
        />
        <Button
          variant="secondary"
          size="sm"
          icon={<Plus className="w-3.5 h-3.5" />}
          onClick={submitNew}
          disabled={add.isPending || !newTitle.trim()}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

function LinkedTasksSection({ goal }: { goal: Goal }) {
  const tasks = goal.tasks ?? [];
  const link = useLinkTask(goal.goal_id);
  const unlink = useUnlinkTask(goal.goal_id);
  const { data: board } = useTaskBoard();
  const [pick, setPick] = useState("");

  const linkable = useMemo(() => {
    if (!board) return [] as Task[];
    const all = [
      ...board.to_do,
      ...board.in_progress,
      ...board.in_review,
      ...board.done,
    ];
    return all.filter((t) => t.goal_id !== goal.goal_id);
  }, [board, goal.goal_id]);

  const doLink = async () => {
    if (!pick) return;
    try {
      await link.mutateAsync({ taskId: pick });
      setPick("");
    } catch (err) {
      toastReport("Workspace → Goal", "Link task", err);
    }
  };

  return (
    <div>
      <SectionHeader
        icon={<ListTodo className="w-4 h-4" />}
        title="Tasks"
        count={tasks.length}
      />
      <div className="space-y-1.5">
        {tasks.map((t) => (
          <div
            key={t.task_id}
            className="flex items-center gap-2 p-2 rounded-xl bg-text-primary/[0.03]"
          >
            <Pill tone={TASK_STATUS_META[t.status].tone} dot={false}>
              {TASK_STATUS_META[t.status].label}
            </Pill>
            <span className="text-[13px] flex-1 truncate">{t.title}</span>
            <Pill tone={TASK_PRIORITY_META[t.priority].tone} dot={false}>
              {TASK_PRIORITY_META[t.priority].label}
            </Pill>
            <button
              onClick={() => unlink.mutate(t.task_id)}
              className="w-7 h-7 grid place-items-center rounded-lg text-text-faint hover:text-danger hover:bg-danger/10 transition-colors shrink-0"
              aria-label="Unlink task"
            >
              <Unlink className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {tasks.length === 0 && (
          <p className="text-[12px] text-text-faint italic py-1">
            No tasks linked yet.
          </p>
        )}
      </div>
      {/* Link an existing task */}
      {linkable.length > 0 && (
        <div className="flex items-center gap-2 mt-2">
          <div className="flex-1">
            <Select
              value={pick}
              onChange={setPick}
              options={[
                { value: "", label: "Link an existing task…" },
                ...linkable.map((t) => ({ value: t.task_id, label: t.title })),
              ]}
            />
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={<Link2 className="w-3.5 h-3.5" />}
            onClick={doLink}
            disabled={!pick || link.isPending}
          >
            Link
          </Button>
        </div>
      )}
    </div>
  );
}

function LinkedEventsSection({ goal }: { goal: Goal }) {
  const events = goal.calendar_events ?? [];
  const [prepId, setPrepId] = useState<string | null>(null);
  if (events.length === 0) return null;
  return (
    <div>
      <SectionHeader
        icon={<CalendarDays className="w-4 h-4" />}
        title="Calendar"
        count={events.length}
      />
      <div className="space-y-1.5">
        {events.map((e) => (
          <div
            key={e.event_id}
            className="flex items-center gap-2 p-2 rounded-xl bg-text-primary/[0.03]"
          >
            <span className="text-[13px] flex-1 truncate">{e.title}</span>
            <span className="text-[10px] font-mono text-text-faint shrink-0">
              {new Date(e.start_at).toLocaleDateString([], {
                month: "short",
                day: "numeric",
              })}
            </span>
            <button
              onClick={() => setPrepId(e.event_id)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] text-text-faint hover:text-accent-glow hover:bg-accent/10 transition-colors shrink-0"
              title="Meeting prep brief"
            >
              <CalendarClock className="w-3.5 h-3.5" /> Prep
            </button>
          </div>
        ))}
      </div>
      {prepId && <MeetingPrepCard eventId={prepId} onClose={() => setPrepId(null)} />}
    </div>
  );
}

function GoalNotesSection({ goalId }: { goalId: string }) {
  const { data: notes = [], isLoading } = useNotes({ goal_id: goalId });
  const create = useCreateNote();
  const [body, setBody] = useState("");

  const submit = async () => {
    const b = body.trim();
    if (!b) return;
    try {
      await create.mutateAsync({ body: b, goal_id: goalId });
      setBody("");
    } catch (err) {
      toastReport("Workspace → Goal", "Add note", err);
    }
  };

  return (
    <div>
      <SectionHeader
        icon={<StickyNote className="w-4 h-4" />}
        title="Notes"
        count={notes.length}
      />
      {isLoading ? (
        <Skeleton className="h-10 rounded-xl" />
      ) : (
        <div className="space-y-1.5">
          {notes.map((n) => (
            <div
              key={n.note_id}
              className="p-2.5 rounded-xl bg-text-primary/[0.03] text-[12px] text-text-muted whitespace-pre-wrap"
            >
              {n.title && (
                <div className="font-semibold text-text-primary mb-0.5">
                  {n.title}
                </div>
              )}
              {n.body}
            </div>
          ))}
          {notes.length === 0 && (
            <p className="text-[12px] text-text-faint italic py-1">
              No notes on this goal.
            </p>
          )}
        </div>
      )}
      <div className="mt-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Jot a quick note about this goal…"
          rows={2}
          className="w-full px-3 py-2 rounded-[10px] bg-text-primary/[0.04] border border-line text-[12px] text-text-primary outline-none focus:border-accent/50 resize-y"
        />
        <div className="flex justify-end mt-1.5">
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={submit}
            disabled={create.isPending || !body.trim()}
          >
            Add note
          </Button>
        </div>
      </div>
    </div>
  );
}
