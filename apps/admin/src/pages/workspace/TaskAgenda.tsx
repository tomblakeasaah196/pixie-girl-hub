/**
 * TaskAgenda — deadline-first task list (the mobile default for the Tasks
 * tab; desktop offers it as the "List" layout beside the kanban).
 *
 * Tasks group into urgency sections — Overdue and Today open, the rest
 * collapsed behind counts — so 25 open tasks read as the handful that
 * matter now. Touch: swipe right to complete (right-to-left to reschedule);
 * pointer: hover actions on each row. Reschedule opens a glass sheet with
 * quick picks (canon: all overlays are glass).
 */

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Search,
  Plus,
  ListTodo,
  Check,
  CalendarClock,
  ChevronRight,
  RotateCcw,
  X,
  Sparkles,
  User,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, Pill, Skeleton, EmptyState } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import { formatDate } from "@/lib/format";
import { useMoveTask, useRescheduleTask } from "./hooks";
import {
  TASK_STATUS_META,
  DAY_SHORT,
  isSameDay,
  isPast,
  formatTime,
} from "./constants";
import type { Task, TaskPriority } from "./types";

// ── Sectioning ───────────────────────────────────────────────────────────

type SectionKey = "overdue" | "today" | "week" | "later" | "done";

const SECTION_META: Record<
  SectionKey,
  { label: string; defaultOpen: boolean; tone?: "danger" }
> = {
  overdue: { label: "Overdue", defaultOpen: true, tone: "danger" },
  today: { label: "Today", defaultOpen: true },
  week: { label: "This Week", defaultOpen: false },
  later: { label: "Later", defaultOpen: false },
  done: { label: "Done Today", defaultOpen: false },
};

const SECTION_ORDER: SectionKey[] = [
  "overdue",
  "today",
  "week",
  "later",
  "done",
];

const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/** Due-date first (earliest wins), undated last, priority as tiebreaker. */
function bySchedule(a: Task, b: Task): number {
  if (a.due_at && b.due_at) {
    const d = +new Date(a.due_at) - +new Date(b.due_at);
    if (d !== 0) return d;
  } else if (a.due_at !== b.due_at) {
    return a.due_at ? -1 : 1;
  }
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
}

function sectionTasks(tasks: Task[]): Record<SectionKey, Task[]> {
  const today = new Date();
  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 7);
  weekEnd.setHours(23, 59, 59, 999);

  const s: Record<SectionKey, Task[]> = {
    overdue: [],
    today: [],
    week: [],
    later: [],
    done: [],
  };
  for (const t of tasks) {
    if (t.status === "cancelled") continue;
    if (t.status === "done") {
      // Only today's wins — older history lives on the board / reports.
      if (t.completed_at && isSameDay(new Date(t.completed_at), today))
        s.done.push(t);
      continue;
    }
    if (!t.due_at) {
      s.later.push(t);
    } else if (isSameDay(new Date(t.due_at), today)) {
      s.today.push(t);
    } else if (isPast(t.due_at)) {
      s.overdue.push(t);
    } else if (new Date(t.due_at) <= weekEnd) {
      s.week.push(t);
    } else {
      s.later.push(t);
    }
  }
  s.overdue.sort(bySchedule);
  s.today.sort(bySchedule);
  s.week.sort(bySchedule);
  s.later.sort(bySchedule);
  s.done.sort(
    (a, b) => +new Date(b.completed_at ?? 0) - +new Date(a.completed_at ?? 0),
  );
  return s;
}

/** Compact due label: time for today, weekday for this week, date beyond. */
function dueLabel(t: Task): string | null {
  if (!t.due_at) return null;
  const due = new Date(t.due_at);
  const now = new Date();
  if (isSameDay(due, now)) return formatTime(t.due_at);
  const in6days = new Date(now);
  in6days.setDate(in6days.getDate() + 6);
  if (due > now && due <= in6days) return DAY_SHORT[due.getDay()];
  return formatDate(t.due_at);
}

const PRIORITY_DOT: Record<TaskPriority, string> = {
  urgent: "bg-danger",
  high: "bg-warn",
  normal: "bg-info",
  low: "bg-text-faint",
};

// ── Swipeable row ────────────────────────────────────────────────────────

const SWIPE_TRIGGER = 72;
const SWIPE_MAX = 110;

function AgendaRow({
  task,
  showAssignee,
  busy,
  onOpen,
  onComplete,
  onReopen,
  onReschedule,
}: {
  task: Task;
  showAssignee: boolean;
  busy: boolean;
  onOpen: () => void;
  onComplete: () => void;
  onReopen: () => void;
  onReschedule: () => void;
}) {
  const [dx, setDx] = useState(0);
  const [settling, setSettling] = useState(false);
  const touch = useRef<{ x: number; y: number; lock: null | "h" | "v" } | null>(
    null,
  );

  const done = task.status === "done";
  const overdue = !!task.due_at && !done && isPast(task.due_at);
  const statusMeta = TASK_STATUS_META[task.status];
  const due = dueLabel(task);
  const subtaskTotal = task.subtask_count ?? 0;
  const subtaskDone = task.subtask_done_count ?? 0;

  function onTouchStart(e: React.TouchEvent) {
    touch.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      lock: null,
    };
    setSettling(false);
  }
  function onTouchMove(e: React.TouchEvent) {
    const t = touch.current;
    if (!t) return;
    const mx = e.touches[0].clientX - t.x;
    const my = e.touches[0].clientY - t.y;
    if (!t.lock) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      t.lock = Math.abs(mx) > Math.abs(my) ? "h" : "v";
    }
    if (t.lock === "h") setDx(Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, mx)));
  }
  function onTouchEnd() {
    const t = touch.current;
    touch.current = null;
    setSettling(true);
    if (t?.lock === "h" && !busy) {
      if (dx > SWIPE_TRIGGER) (done ? onReopen : onComplete)();
      else if (dx < -SWIPE_TRIGGER && !done) onReschedule();
    }
    setDx(0);
  }

  return (
    <div
      className={cn(
        "relative rounded-xl overflow-hidden",
        busy && "opacity-60 pointer-events-none",
      )}
    >
      {/* Action reveal layers (behind the row) */}
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-between px-4 rounded-xl",
          dx > 0 && "bg-success/15",
          dx < 0 && "bg-warn/15",
        )}
        aria-hidden
      >
        <span
          className={cn(
            "text-success transition-opacity",
            dx > 24 ? "opacity-100" : "opacity-0",
          )}
        >
          {done ? (
            <RotateCcw className="w-5 h-5" />
          ) : (
            <Check className="w-5 h-5" />
          )}
        </span>
        <span
          className={cn(
            "text-warn transition-opacity",
            dx < -24 && !done ? "opacity-100" : "opacity-0",
          )}
        >
          <CalendarClock className="w-5 h-5" />
        </span>
      </div>

      {/* Foreground row */}
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        style={{
          transform: dx ? `translateX(${dx}px)` : undefined,
          touchAction: "pan-y",
        }}
        className={cn(
          "group relative glass rounded-xl p-3 cursor-pointer hover:bg-text-primary/[0.04] transition-colors",
          settling && "transition-transform duration-200",
        )}
      >
        <div className="flex items-start gap-2.5">
          <span
            className={cn(
              "mt-[7px] w-2 h-2 rounded-full shrink-0",
              done ? "bg-success" : PRIORITY_DOT[task.priority],
            )}
            aria-hidden
          />
          <div className="flex-1 min-w-0">
            <div
              className={cn(
                "text-[13px] font-semibold text-text-primary truncate",
                done && "line-through text-text-muted",
              )}
            >
              {task.title}
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {due && (
                <span
                  className={cn(
                    "text-[10.5px] font-mono",
                    overdue ? "text-danger font-semibold" : "text-text-faint",
                  )}
                >
                  {due}
                </span>
              )}
              {(task.status === "in_progress" ||
                task.status === "in_review") && (
                <Pill tone={statusMeta.tone} dot={false}>
                  {statusMeta.label}
                </Pill>
              )}
              {subtaskTotal > 0 && (
                <span className="text-[10.5px] text-text-faint tabular-nums">
                  {subtaskDone}/{subtaskTotal}
                </span>
              )}
              {showAssignee && task.assigned_to_name && (
                <span className="inline-flex items-center gap-1 text-[10.5px] text-text-faint truncate">
                  <User className="w-3 h-3 shrink-0" />
                  {task.assigned_to_name}
                </span>
              )}
            </div>
          </div>

          {/* Pointer actions — hover-revealed on desktop; touch uses swipe */}
          <div className="hidden md:flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
            {done ? (
              <button
                type="button"
                title="Reopen"
                onClick={(e) => {
                  e.stopPropagation();
                  onReopen();
                }}
                className="w-7 h-7 grid place-items-center rounded-lg text-text-faint hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  title="Mark done"
                  onClick={(e) => {
                    e.stopPropagation();
                    onComplete();
                  }}
                  className="w-7 h-7 grid place-items-center rounded-lg text-success hover:bg-success/10 transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  title="Reschedule"
                  onClick={(e) => {
                    e.stopPropagation();
                    onReschedule();
                  }}
                  className="w-7 h-7 grid place-items-center rounded-lg text-warn hover:bg-warn/10 transition-colors"
                >
                  <CalendarClock className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Reschedule sheet ─────────────────────────────────────────────────────

function quickPicks(): { label: string; hint: string; iso: string }[] {
  const now = new Date();
  const picks: { label: string; hint: string; iso: string }[] = [];

  const laterToday = new Date(now);
  laterToday.setHours(now.getHours() + 3, 0, 0, 0);
  if (isSameDay(laterToday, now)) {
    picks.push({
      label: "Later today",
      hint: formatTime(laterToday.toISOString()),
      iso: laterToday.toISOString(),
    });
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  picks.push({
    label: "Tomorrow",
    hint: `${DAY_SHORT[tomorrow.getDay()]} 09:00`,
    iso: tomorrow.toISOString(),
  });

  const nextMonday = new Date(now);
  nextMonday.setDate(now.getDate() + (((8 - now.getDay()) % 7) || 7));
  nextMonday.setHours(9, 0, 0, 0);
  picks.push({
    label: "Next week",
    hint: `Mon 09:00`,
    iso: nextMonday.toISOString(),
  });

  return picks;
}

function RescheduleSheet({ task, onClose }: { task: Task; onClose: () => void }) {
  const reschedule = useRescheduleTask();
  const [showPicker, setShowPicker] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const picks = useMemo(quickPicks, []);

  function apply(iso: string | null) {
    reschedule.mutate(
      { id: task.task_id, due_at: iso },
      { onSuccess: onClose },
    );
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-[3px]"
      onClick={onClose}
    >
      <div
        className="absolute bottom-0 left-0 right-0 dropglass rounded-t-[22px] p-4 pb-[max(env(safe-area-inset-bottom,0px),16px)] animate-slide-up md:bottom-auto md:left-1/2 md:right-auto md:top-1/2 md:w-[360px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[22px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-[0.18em] text-text-faint">
              Reschedule
            </div>
            <div className="text-[13px] font-semibold text-text-primary truncate mt-0.5">
              {task.title}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 grid place-items-center rounded-lg text-text-faint hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-1">
          {picks.map((p) => (
            <button
              key={p.label}
              type="button"
              disabled={reschedule.isPending}
              onClick={() => apply(p.iso)}
              className="w-full flex items-center gap-3 p-3 rounded-xl text-left hover:bg-text-primary/[0.05] transition-colors disabled:opacity-50"
            >
              <CalendarClock className="w-4 h-4 text-accent-glow shrink-0" />
              <span className="flex-1 text-[13px] font-semibold text-text-primary">
                {p.label}
              </span>
              <span className="text-[11px] font-mono text-text-faint">
                {p.hint}
              </span>
            </button>
          ))}

          <button
            type="button"
            disabled={reschedule.isPending}
            onClick={() => setShowPicker((v) => !v)}
            className="w-full flex items-center gap-3 p-3 rounded-xl text-left hover:bg-text-primary/[0.05] transition-colors disabled:opacity-50"
          >
            <ChevronRight
              className={cn(
                "w-4 h-4 text-text-faint shrink-0 transition-transform",
                showPicker && "rotate-90",
              )}
            />
            <span className="flex-1 text-[13px] font-semibold text-text-primary">
              Pick date &amp; time…
            </span>
          </button>
          {showPicker && (
            <div className="flex items-center gap-2 px-3 pb-1">
              <input
                type="datetime-local"
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                className="flex-1 h-[36px] px-3 rounded-[10px] bg-text-primary/[0.04] border border-line text-[12px] text-text-primary outline-none focus:border-accent/50 transition-colors"
              />
              <Button
                variant="primary"
                size="sm"
                disabled={!customValue || reschedule.isPending}
                onClick={() => apply(new Date(customValue).toISOString())}
              >
                Set
              </Button>
            </div>
          )}

          {task.due_at && (
            <button
              type="button"
              disabled={reschedule.isPending}
              onClick={() => apply(null)}
              className="w-full flex items-center gap-3 p-3 rounded-xl text-left hover:bg-text-primary/[0.05] transition-colors disabled:opacity-50"
            >
              <X className="w-4 h-4 text-text-faint shrink-0" />
              <span className="flex-1 text-[13px] text-text-muted">
                Remove due date
              </span>
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Agenda ───────────────────────────────────────────────────────────────

export function TaskAgenda({
  tasks,
  loading,
  error,
  search,
  onSearchChange,
  onRetry,
  onSelectTask,
  onCreateTask,
  showAssignee = false,
}: {
  tasks: Task[];
  loading: boolean;
  error: boolean;
  search: string;
  onSearchChange: (s: string) => void;
  onRetry: () => void;
  onSelectTask: (t: Task) => void;
  onCreateTask: () => void;
  /** Show who each task belongs to (team-wide audience). */
  showAssignee?: boolean;
}) {
  const [open, setOpen] = useState<Record<SectionKey, boolean>>(() => {
    const o = {} as Record<SectionKey, boolean>;
    for (const k of SECTION_ORDER) o[k] = SECTION_META[k].defaultOpen;
    return o;
  });
  const [rescheduleTarget, setRescheduleTarget] = useState<Task | null>(null);
  const move = useMoveTask();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.assigned_to_name?.toLowerCase().includes(q),
    );
  }, [tasks, search]);

  const sections = useMemo(() => sectionTasks(filtered), [filtered]);
  const openCount =
    sections.overdue.length +
    sections.today.length +
    sections.week.length +
    sections.later.length;
  const clearForToday =
    !loading &&
    sections.overdue.length === 0 &&
    sections.today.length === 0 &&
    openCount > 0;

  if (error)
    return <ErrorState message="Could not load tasks." onRetry={onRetry} />;

  const busyId =
    move.isPending && move.variables ? move.variables.id : null;

  return (
    <div>
      {/* Search */}
      <div className="mb-4 md:max-w-[300px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search tasks..."
            className="w-full h-[36px] pl-9 pr-3 rounded-[10px] bg-text-primary/[0.04] border border-line text-[12px] text-text-primary outline-none focus:border-accent/50 transition-colors" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
          />
        </div>
      </div>

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <EmptyState
          icon={<ListTodo className="w-6 h-6" />}
          title="No tasks"
          message={
            search
              ? "No tasks match your search."
              : "Create your first task to get started."
          }
          action={
            !search ? (
              <Button
                variant="primary"
                size="sm"
                icon={<Plus className="w-3 h-3" />}
                onClick={onCreateTask}
              >
                New Task
              </Button>
            ) : undefined
          }
        />
      )}

      {clearForToday && (
        <div className="glass rounded-xl p-3 mb-3 flex items-center gap-2.5">
          <Sparkles className="w-4 h-4 text-success shrink-0" />
          <span className="text-[12.5px] text-text-muted">
            Nothing overdue or due today — you&apos;re clear.
          </span>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="space-y-4">
          {SECTION_ORDER.map((key) => {
            const list = sections[key];
            if (list.length === 0) return null;
            const meta = SECTION_META[key];
            const isOpen = open[key];
            return (
              <div key={key}>
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}
                  className="w-full flex items-center gap-2 px-1 py-1.5"
                >
                  <ChevronRight
                    className={cn(
                      "w-3.5 h-3.5 text-text-faint transition-transform",
                      isOpen && "rotate-90",
                    )}
                  />
                  <span
                    className={cn(
                      "text-[11px] font-semibold uppercase tracking-[0.18em]",
                      meta.tone === "danger" ? "text-danger" : "text-text-faint",
                    )}
                  >
                    {meta.label}
                  </span>
                  <span className="text-[10.5px] font-mono text-text-faint">
                    {list.length}
                  </span>
                  <span className="flex-1 h-px bg-text-primary/[0.06]" />
                </button>
                {isOpen && (
                  <div className="space-y-1.5 mt-1">
                    {list.map((t) => (
                      <AgendaRow
                        key={t.task_id}
                        task={t}
                        showAssignee={showAssignee}
                        busy={busyId === t.task_id}
                        onOpen={() => onSelectTask(t)}
                        onComplete={() =>
                          move.mutate({ id: t.task_id, status: "done" })
                        }
                        onReopen={() =>
                          move.mutate({ id: t.task_id, status: "to_do" })
                        }
                        onReschedule={() => setRescheduleTarget(t)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {rescheduleTarget && (
        <RescheduleSheet
          task={rescheduleTarget}
          onClose={() => setRescheduleTarget(null)}
        />
      )}
    </div>
  );
}
