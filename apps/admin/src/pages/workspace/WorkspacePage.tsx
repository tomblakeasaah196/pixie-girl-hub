import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import {
  Sun,
  CalendarDays,
  ListTodo,
  Plus,
  ChevronLeft,
  ChevronRight,
  Search,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Calendar,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
} from "@dnd-kit/core";
import { cn } from "@/lib/cn";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Button, Card, KpiTile, Skeleton, EmptyState, Pill } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";

import { useTaskBoard, useCalendarEvents, useMoveTask } from "./hooks";
import { TaskCard } from "./TaskCard";
import { TaskFormModal } from "./TaskFormModal";
import { EventFormModal } from "./EventFormModal";
import TaskDetailPanel from "./TaskDetailPanel";
import CalendarGrid from "./CalendarGrid";
import { WeekView } from "./WeekView";
import { DayView } from "./DayView";
import { AgendaView } from "./AgendaView";
import {
  BOARD_COLUMNS,
  TASK_STATUS_META,
  TASK_PRIORITY_META,
  MONTH_NAMES,
  getGreeting,
  isSameDay,
  isPast,
  formatTime,
  toISODate,
} from "./constants";
import type { WorkspaceTab, CalendarViewMode, Task, CalendarEvent } from "./types";

// ── Tab config ───────────────────────────────────────────────────────────

const TABS: { key: WorkspaceTab; label: string; icon: typeof Sun }[] = [
  { key: "my-day", label: "My Day", icon: Sun },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "tasks", label: "Tasks", icon: ListTodo },
];

const CAL_VIEWS: { key: CalendarViewMode; label: string }[] = [
  { key: "month", label: "Month" },
  { key: "week", label: "Week" },
  { key: "day", label: "Day" },
  { key: "agenda", label: "Agenda" },
];

// ── Droppable column ─────────────────────────────────────────────────────

function KanbanColumn({
  status,
  tasks,
  onAddTask,
  onSelectTask,
}: {
  status: string;
  tasks: Task[];
  onAddTask: () => void;
  onSelectTask: (t: Task) => void;
}) {
  const meta = TASK_STATUS_META[status as keyof typeof TASK_STATUS_META];
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div className="flex-shrink-0 w-[260px] flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[12px] font-semibold text-text-primary flex-1 truncate">
          {meta?.label ?? status}
        </span>
        <span className="text-[10.5px] text-text-faint font-mono">{tasks.length}</span>
        <button
          onClick={onAddTask}
          className="w-6 h-6 grid place-items-center rounded-md text-text-faint hover:text-accent-glow hover:bg-accent/10 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 flex flex-col gap-2 min-h-[120px] p-2 rounded-[14px] transition-all",
          isOver
            ? "bg-accent/[0.08] ring-2 ring-accent/40"
            : "bg-text-primary/[0.025]",
        )}
      >
        {tasks.map((task) => (
          <DraggableTaskCard key={task.task_id} task={task} onClick={() => onSelectTask(task)} />
        ))}
        {tasks.length === 0 && !isOver && (
          <div className="flex-1 grid place-items-center text-[11px] text-text-faint italic py-6">
            No tasks
          </div>
        )}
      </div>
    </div>
  );
}

function DraggableTaskCard({ task, onClick }: { task: Task; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.task_id,
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={isDragging ? "opacity-40" : ""}
    >
      <TaskCard task={task} onClick={onClick} isDragging={isDragging} />
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────

export function WorkspacePage() {
  useBreadcrumbs([{ label: "Workspace" }]);

  const user = useAuthStore((s) => s.user);
  const isMobile = useMediaQuery("(max-width: 767px)");
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") as WorkspaceTab) ?? "my-day";

  // Calendar state
  const [calView, setCalView] = useState<CalendarViewMode>("month");
  const [calDate, setCalDate] = useState(new Date());

  // Selection state
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

  // Modal state
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [editEvent, setEditEvent] = useState<CalendarEvent | null>(null);
  const [defaultDate, setDefaultDate] = useState<string | undefined>();

  // Task search
  const [taskSearch, setTaskSearch] = useState("");

  // Kanban drag
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const moveTask = useMoveTask();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // Data
  const {
    data: board,
    isLoading: boardLoading,
    isError: boardError,
    refetch: refetchBoard,
  } = useTaskBoard();

  // Calendar events for the visible range
  const calRange = useMemo(() => {
    const y = calDate.getFullYear();
    const m = calDate.getMonth();
    return {
      start: new Date(y, m - 1, 1).toISOString(),
      end: new Date(y, m + 2, 0).toISOString(),
    };
  }, [calDate]);

  const {
    data: events = [],
    isLoading: eventsLoading,
    isError: eventsError,
    refetch: refetchEvents,
  } = useCalendarEvents(calRange);

  // Derived data
  const today = new Date();
  const todayStr = toISODate(today);

  const todayEvents = useMemo(
    () =>
      events
        .filter((e) => isSameDay(new Date(e.start_at), today))
        .sort(
          (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
        ),
    [events, todayStr],
  );

  const allTasks = useMemo(() => {
    if (!board) return [];
    return [
      ...board.to_do,
      ...board.in_progress,
      ...board.in_review,
      ...board.done,
    ];
  }, [board]);

  const dueTodayTasks = useMemo(
    () => allTasks.filter((t) => t.due_at && isSameDay(new Date(t.due_at), today) && t.status !== "done" && t.status !== "cancelled"),
    [allTasks, todayStr],
  );

  const overdueTasks = useMemo(
    () =>
      allTasks.filter(
        (t) =>
          t.due_at &&
          isPast(t.due_at) &&
          !isSameDay(new Date(t.due_at), today) &&
          t.status !== "done" &&
          t.status !== "cancelled",
      ),
    [allTasks, todayStr],
  );

  const completedToday = useMemo(
    () =>
      allTasks.filter(
        (t) => t.completed_at && isSameDay(new Date(t.completed_at), today),
      ),
    [allTasks, todayStr],
  );

  // Filtered tasks for kanban search
  const filteredBoard = useMemo(() => {
    if (!board) return null;
    if (!taskSearch.trim()) return board;
    const q = taskSearch.toLowerCase();
    const filter = (tasks: Task[]) =>
      tasks.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.assigned_to_name?.toLowerCase().includes(q),
      );
    return {
      to_do: filter(board.to_do),
      in_progress: filter(board.in_progress),
      in_review: filter(board.in_review),
      done: filter(board.done),
    };
  }, [board, taskSearch]);

  const activeDragTask = activeDragId
    ? allTasks.find((t) => t.task_id === activeDragId)
    : null;

  function setTab(tab: WorkspaceTab) {
    setSearchParams({ tab });
    setSelectedTaskId(null);
    setSelectedEvent(null);
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveDragId(null);
    if (!over) return;
    const taskId = active.id as string;
    const targetStatus = over.id as string;
    const task = allTasks.find((t) => t.task_id === taskId);
    if (!task || task.status === targetStatus) return;
    moveTask.mutate({ id: taskId, status: targetStatus });
  }

  function navCalendar(direction: -1 | 1) {
    setCalDate((d) => {
      const next = new Date(d);
      if (calView === "month") {
        next.setMonth(next.getMonth() + direction);
      } else if (calView === "week") {
        next.setDate(next.getDate() + direction * 7);
      } else {
        next.setDate(next.getDate() + direction);
      }
      return next;
    });
  }

  function goToday() {
    setCalDate(new Date());
  }

  function openCreateEvent(date: Date) {
    setDefaultDate(date.toISOString().slice(0, 16));
    setShowCreateEvent(true);
  }

  function openCreateTaskForDate(date?: string) {
    if (date) setDefaultDate(date);
    else setDefaultDate(undefined);
    setShowCreateTask(true);
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="animate-fade-in">
      {/* Tab bar — top on all sizes; mobile gets shell bottom nav */}
      <div className="flex items-center gap-2 mb-6">

        <div className="flex gap-0.5 p-0.5 rounded-[12px] bg-text-primary/[0.04] border hairline">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "flex items-center gap-2 px-4 h-[36px] rounded-[10px] text-[13px] font-semibold transition-all",
                activeTab === key
                  ? "bg-accent-deep text-[#F4E9D9] shadow-sm"
                  : "text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06]",
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {!isMobile && (
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => openCreateTaskForDate()}
            >
              Task
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => setShowCreateEvent(true)}
            >
              Event
            </Button>
          </div>
        )}
      </div>

      {/* Content area */}
      <div
        className={cn(
          isDesktop && selectedTaskId && "grid grid-cols-[1fr_340px] gap-5",
        )}
      >
        <div className="min-w-0">
          {activeTab === "my-day" && (
            <MyDayView
              userName={user?.name ?? "there"}
              todayEvents={todayEvents}
              dueTodayTasks={dueTodayTasks}
              overdueTasks={overdueTasks}
              completedToday={completedToday}
              eventsLoading={eventsLoading}
              boardLoading={boardLoading}
              boardError={boardError}
              eventsError={eventsError}
              onRetryBoard={refetchBoard}
              onRetryEvents={refetchEvents}
              onSelectTask={(t) => setSelectedTaskId(t.task_id)}
              onSelectEvent={setSelectedEvent}
              onCreateTask={() => openCreateTaskForDate()}
              onCreateEvent={() => setShowCreateEvent(true)}
            />
          )}

          {activeTab === "calendar" && (
            <CalendarTab
              calView={calView}
              calDate={calDate}
              events={events}
              loading={eventsLoading}
              error={eventsError}
              onRetry={refetchEvents}
              onSetView={setCalView}
              onNav={navCalendar}
              onToday={goToday}
              onSelectEvent={setSelectedEvent}
              onCreateEvent={openCreateEvent}
              onSelectDay={(d) => {
                setCalDate(d);
                setCalView("day");
              }}
            />
          )}

          {activeTab === "tasks" && (
            isMobile ? (
              <TaskListMobile
                board={filteredBoard}
                loading={boardLoading}
                error={boardError}
                search={taskSearch}
                onSearchChange={setTaskSearch}
                onRetry={refetchBoard}
                onSelectTask={(t) => setSelectedTaskId(t.task_id)}
                onCreateTask={() => openCreateTaskForDate()}
              />
            ) : (
              <TasksKanban
                board={filteredBoard}
                loading={boardLoading}
                error={boardError}
                search={taskSearch}
                onSearchChange={setTaskSearch}
                onRetry={refetchBoard}
                sensors={sensors}
                activeDragTask={activeDragTask ?? null}
                onDragStart={(e: DragStartEvent) => setActiveDragId(e.active.id as string)}
                onDragEnd={onDragEnd}
                onDragCancel={() => setActiveDragId(null)}
                onSelectTask={(t) => setSelectedTaskId(t.task_id)}
                onAddTask={() => {
                  openCreateTaskForDate();
                }}
              />
            )
          )}
        </div>

        {/* Detail panel (desktop only) */}
        {isDesktop && selectedTaskId && (
          <TaskDetailPanel
            taskId={selectedTaskId}
            onClose={() => setSelectedTaskId(null)}
            onEdit={() => {
              const t = allTasks.find((x) => x.task_id === selectedTaskId);
              if (t) setEditTask(t);
            }}
          />
        )}
      </div>

      {/* Mobile: show task detail as modal-like overlay */}
      {isMobile && selectedTaskId && createPortal(
        <div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-[3px]" onClick={() => setSelectedTaskId(null)}>
          <div
            className="absolute bottom-0 left-0 right-0 max-h-[80vh] overflow-y-auto dropglass rounded-t-[22px] animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <TaskDetailPanel
              taskId={selectedTaskId}
              onClose={() => setSelectedTaskId(null)}
              onEdit={() => {
                const t = allTasks.find((x) => x.task_id === selectedTaskId);
                if (t) setEditTask(t);
              }}
            />
          </div>
        </div>,
        document.body,
      )}

      {/* Event detail overlay (mobile + tablet) */}
      {selectedEvent && (
        <EventDetailOverlay
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onEdit={() => {
            setEditEvent(selectedEvent);
            setSelectedEvent(null);
          }}
        />
      )}

      {/* Modals */}
      <TaskFormModal
        open={showCreateTask}
        onClose={() => {
          setShowCreateTask(false);
          setDefaultDate(undefined);
        }}
        defaultDate={defaultDate}
      />
      <TaskFormModal
        open={!!editTask}
        onClose={() => setEditTask(null)}
        task={editTask}
      />
      <EventFormModal
        open={showCreateEvent}
        onClose={() => {
          setShowCreateEvent(false);
          setDefaultDate(undefined);
        }}
        defaultDate={defaultDate}
      />
      <EventFormModal
        open={!!editEvent}
        onClose={() => setEditEvent(null)}
        event={editEvent}
      />

      {/* Mobile FAB */}
      {isMobile && (
        <button
          onClick={() => {
            if (activeTab === "calendar") setShowCreateEvent(true);
            else openCreateTaskForDate();
          }}
          className="fixed bottom-[80px] right-4 z-40 w-14 h-14 rounded-full bg-accent-deep text-[#F4E9D9] shadow-lg grid place-items-center hover:bg-accent transition-colors"
        >
          <Plus className="w-6 h-6" />
        </button>
      )}
    </div>
  );
}

// ── My Day sub-view ──────────────────────────────────────────────────────

function MyDayView({
  userName,
  todayEvents,
  dueTodayTasks,
  overdueTasks,
  completedToday,
  eventsLoading,
  boardLoading,
  boardError,
  eventsError,
  onRetryBoard,
  onRetryEvents,
  onSelectTask,
  onSelectEvent,
  onCreateTask,
  onCreateEvent,
}: {
  userName: string;
  todayEvents: CalendarEvent[];
  dueTodayTasks: Task[];
  overdueTasks: Task[];
  completedToday: Task[];
  eventsLoading: boolean;
  boardLoading: boolean;
  boardError: boolean;
  eventsError: boolean;
  onRetryBoard: () => void;
  onRetryEvents: () => void;
  onSelectTask: (t: Task) => void;
  onSelectEvent: (e: CalendarEvent) => void;
  onCreateTask: () => void;
  onCreateEvent: () => void;
}) {
  const today = new Date();

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h2 className="font-display text-2xl font-medium">
          {getGreeting()}, {userName.split(" ")[0]}
        </h2>
        <p className="text-[13px] text-text-muted mt-1">
          {today.toLocaleDateString([], {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
        </p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile
          label="Today's Events"
          value={eventsLoading ? "--" : String(todayEvents.length)}
          tone="accent"
        />
        <KpiTile
          label="Tasks Due Today"
          value={boardLoading ? "--" : String(dueTodayTasks.length)}
          tone="accent"
        />
        <KpiTile
          label="Overdue"
          value={boardLoading ? "--" : String(overdueTasks.length)}
          tone={overdueTasks.length > 0 ? "warn" : "accent"}
        />
        <KpiTile
          label="Completed Today"
          value={boardLoading ? "--" : String(completedToday.length)}
          tone="accent"
        />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Today's Schedule */}
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 p-4 border-b hairline">
            <Clock className="w-4 h-4 text-accent-glow" />
            <span className="text-[13px] font-semibold flex-1">Today's Schedule</span>
            <Button variant="ghost" size="sm" icon={<Plus className="w-3 h-3" />} onClick={onCreateEvent}>
              Event
            </Button>
          </div>
          <div className="p-3">
            {eventsError && <ErrorState message="Could not load events." onRetry={onRetryEvents} />}
            {eventsLoading && (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded-xl" />
                ))}
              </div>
            )}
            {!eventsLoading && !eventsError && todayEvents.length === 0 && (
              <EmptyState
                icon={<CalendarDays className="w-6 h-6" />}
                title="No events today"
                message="Your day is clear."
                action={
                  <Button variant="primary" size="sm" icon={<Plus className="w-3 h-3" />} onClick={onCreateEvent}>
                    New Event
                  </Button>
                }
              />
            )}
            {!eventsLoading &&
              !eventsError &&
              todayEvents.map((ev) => (
                <button
                  key={ev.event_id}
                  onClick={() => onSelectEvent(ev)}
                  className="w-full text-left flex items-center gap-3 p-2.5 rounded-xl hover:bg-text-primary/[0.04] transition-colors"
                >
                  <div className="w-1 h-10 rounded-full bg-accent/40 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-text-primary truncate">
                      {ev.title}
                    </div>
                    <div className="text-[11px] text-text-faint">
                      {ev.all_day ? "All day" : `${formatTime(ev.start_at)} - ${formatTime(ev.end_at)}`}
                    </div>
                  </div>
                </button>
              ))}
          </div>
        </Card>

        {/* Tasks Due */}
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 p-4 border-b hairline">
            <ListTodo className="w-4 h-4 text-accent-glow" />
            <span className="text-[13px] font-semibold flex-1">Tasks Due</span>
            <Button variant="ghost" size="sm" icon={<Plus className="w-3 h-3" />} onClick={onCreateTask}>
              Task
            </Button>
          </div>
          <div className="p-3">
            {boardError && <ErrorState message="Could not load tasks." onRetry={onRetryBoard} />}
            {boardLoading && (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded-xl" />
                ))}
              </div>
            )}
            {!boardLoading && !boardError && overdueTasks.length === 0 && dueTodayTasks.length === 0 && (
              <EmptyState
                icon={<CheckCircle2 className="w-6 h-6" />}
                title="All caught up"
                message="No tasks due today."
                action={
                  <Button variant="primary" size="sm" icon={<Plus className="w-3 h-3" />} onClick={onCreateTask}>
                    New Task
                  </Button>
                }
              />
            )}
            {!boardLoading && !boardError && (
              <>
                {overdueTasks.length > 0 && (
                  <div className="mb-3">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-danger mb-2 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Overdue
                    </div>
                    {overdueTasks.map((t) => (
                      <TaskRow key={t.task_id} task={t} overdue onClick={() => onSelectTask(t)} />
                    ))}
                  </div>
                )}
                {dueTodayTasks.length > 0 && (
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-text-faint mb-2">
                      Due Today
                    </div>
                    {dueTodayTasks.map((t) => (
                      <TaskRow key={t.task_id} task={t} onClick={() => onSelectTask(t)} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

/** Compact task row for My Day view. */
function TaskRow({
  task,
  overdue,
  onClick,
}: {
  task: Task;
  overdue?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center gap-3 p-2 rounded-xl hover:bg-text-primary/[0.04] transition-colors mb-0.5"
    >
      <Pill tone={TASK_PRIORITY_META[task.priority].tone} dot={false}>
        {TASK_PRIORITY_META[task.priority].label}
      </Pill>
      <span className="text-[13px] text-text-primary flex-1 truncate">{task.title}</span>
      {task.due_at && (
        <span className={cn("text-[10px] font-mono", overdue ? "text-danger" : "text-text-faint")}>
          {new Date(task.due_at).toLocaleDateString([], { month: "short", day: "numeric" })}
        </span>
      )}
    </button>
  );
}

// ── Calendar sub-view ────────────────────────────────────────────────────

function CalendarTab({
  calView,
  calDate,
  events,
  loading,
  error,
  onRetry,
  onSetView,
  onNav,
  onToday,
  onSelectEvent,
  onCreateEvent,
  onSelectDay,
}: {
  calView: CalendarViewMode;
  calDate: Date;
  events: CalendarEvent[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onSetView: (v: CalendarViewMode) => void;
  onNav: (d: -1 | 1) => void;
  onToday: () => void;
  onSelectEvent: (e: CalendarEvent) => void;
  onCreateEvent: (d: Date) => void;
  onSelectDay: (d: Date) => void;
}) {
  if (error) return <ErrorState message="Could not load calendar events." onRetry={onRetry} />;

  const title =
    calView === "month"
      ? `${MONTH_NAMES[calDate.getMonth()]} ${calDate.getFullYear()}`
      : calView === "week"
        ? `Week of ${calDate.toLocaleDateString([], { month: "short", day: "numeric" })}`
        : calDate.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          onClick={() => onNav(-1)}
          className="w-8 h-8 grid place-items-center rounded-lg text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          onClick={onToday}
          className="px-3 h-8 rounded-lg text-[12px] font-semibold text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors"
        >
          Today
        </button>
        <button
          onClick={() => onNav(1)}
          className="w-8 h-8 grid place-items-center rounded-lg text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        <h3 className="font-display text-lg font-medium flex-1">{title}</h3>

        <div className="flex gap-0.5 p-0.5 rounded-[9px] bg-text-primary/[0.04] border hairline">
          {CAL_VIEWS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => onSetView(key)}
              className={cn(
                "px-2.5 h-[28px] rounded-[7px] text-[11.5px] font-semibold transition-all",
                calView === key
                  ? "bg-accent-deep text-[#F4E9D9]"
                  : "text-text-muted hover:text-text-primary",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* View */}
      {calView === "month" && (
        <CalendarGrid
          year={calDate.getFullYear()}
          month={calDate.getMonth()}
          events={events}
          loading={loading}
          onSelectDay={onSelectDay}
          onSelectEvent={onSelectEvent}
          onCreateEvent={onCreateEvent}
        />
      )}
      {calView === "week" && (
        <WeekView
          date={calDate}
          events={events}
          loading={loading}
          onSelectEvent={onSelectEvent}
          onCreateEvent={onCreateEvent}
        />
      )}
      {calView === "day" && (
        <DayView
          date={calDate}
          events={events}
          loading={loading}
          onSelectEvent={onSelectEvent}
          onCreateEvent={onCreateEvent}
        />
      )}
      {calView === "agenda" && (
        <AgendaView events={events} loading={loading} onSelectEvent={onSelectEvent} />
      )}
    </div>
  );
}

// ── Tasks Kanban (desktop) ───────────────────────────────────────────────

function TasksKanban({
  board,
  loading,
  error,
  search,
  onSearchChange,
  onRetry,
  sensors,
  activeDragTask,
  onDragStart,
  onDragEnd,
  onDragCancel,
  onSelectTask,
  onAddTask,
}: {
  board: ReturnType<typeof useTaskBoard>["data"] | null;
  loading: boolean;
  error: boolean;
  search: string;
  onSearchChange: (s: string) => void;
  onRetry: () => void;
  sensors: ReturnType<typeof useSensors>;
  activeDragTask: Task | null;
  onDragStart: (e: DragStartEvent) => void;
  onDragEnd: (e: DragEndEvent) => void;
  onDragCancel: () => void;
  onSelectTask: (t: Task) => void;
  onAddTask: (status: string) => void;
}) {
  if (error) return <ErrorState message="Could not load tasks." onRetry={onRetry} />;

  return (
    <div>
      {/* Search */}
      <div className="mb-4 max-w-[300px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search tasks..."
            className="w-full h-[36px] pl-9 pr-3 rounded-[10px] bg-text-primary/[0.04] border border-line text-[12px] text-text-primary outline-none focus:border-accent/50 transition-colors"
          />
        </div>
      </div>

      {loading && (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex-shrink-0 w-[260px]">
              <Skeleton className="h-5 w-32 mb-3 rounded" />
              <div className="flex flex-col gap-2">
                {Array.from({ length: 3 - i }).map((_, j) => (
                  <Skeleton key={j} className="h-[90px] rounded-[13px]" />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && board && (
        <DndContext
          sensors={sensors}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <div className="flex gap-4 overflow-x-auto pb-4 min-h-[400px]">
            {BOARD_COLUMNS.map((status) => (
              <KanbanColumn
                key={status}
                status={status}
                tasks={board[status]}
                onAddTask={() => onAddTask(status)}
                onSelectTask={onSelectTask}
              />
            ))}
          </div>
          <DragOverlay>
            {activeDragTask ? <TaskCard task={activeDragTask} isDragging /> : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

// ── Tasks List (mobile) ──────────────────────────────────────────────────

function TaskListMobile({
  board,
  loading,
  error,
  search,
  onSearchChange,
  onRetry,
  onSelectTask,
  onCreateTask,
}: {
  board: ReturnType<typeof useTaskBoard>["data"] | null;
  loading: boolean;
  error: boolean;
  search: string;
  onSearchChange: (s: string) => void;
  onRetry: () => void;
  onSelectTask: (t: Task) => void;
  onCreateTask: () => void;
}) {
  if (error) return <ErrorState message="Could not load tasks." onRetry={onRetry} />;

  const allTasks = board
    ? [...board.to_do, ...board.in_progress, ...board.in_review, ...board.done]
    : [];

  const filtered = search.trim()
    ? allTasks.filter(
        (t) =>
          t.title.toLowerCase().includes(search.toLowerCase()) ||
          t.assigned_to_name?.toLowerCase().includes(search.toLowerCase()),
      )
    : allTasks;

  return (
    <div>
      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search tasks..."
            className="w-full h-[36px] pl-9 pr-3 rounded-[10px] bg-text-primary/[0.04] border border-line text-[12px] text-text-primary outline-none focus:border-accent/50 transition-colors"
          />
        </div>
      </div>

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <EmptyState
          icon={<ListTodo className="w-6 h-6" />}
          title="No tasks"
          message={search ? "No tasks match your search." : "Create your first task to get started."}
          action={
            !search ? (
              <Button variant="primary" size="sm" icon={<Plus className="w-3 h-3" />} onClick={onCreateTask}>
                New Task
              </Button>
            ) : undefined
          }
        />
      )}

      {!loading && (
        <div className="space-y-1.5">
          {filtered.map((task) => (
            <button
              key={task.task_id}
              onClick={() => onSelectTask(task)}
              className="w-full text-left glass rounded-xl p-3 hover:bg-text-primary/[0.04] transition-colors"
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-text-primary truncate">
                    {task.title}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <Pill tone={TASK_STATUS_META[task.status].tone} dot={false}>
                      {TASK_STATUS_META[task.status].label}
                    </Pill>
                    <Pill tone={TASK_PRIORITY_META[task.priority].tone} dot={false}>
                      {TASK_PRIORITY_META[task.priority].label}
                    </Pill>
                  </div>
                </div>
                {task.due_at && (
                  <span
                    className={cn(
                      "text-[10px] font-mono shrink-0",
                      isPast(task.due_at) && task.status !== "done"
                        ? "text-danger"
                        : "text-text-faint",
                    )}
                  >
                    {new Date(task.due_at).toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Event detail overlay ─────────────────────────────────────────────────

function EventDetailOverlay({
  event,
  onClose,
  onEdit,
}: {
  event: CalendarEvent;
  onClose: () => void;
  onEdit: () => void;
}) {
  return createPortal(
    <div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-[3px]" onClick={onClose}>
      <div
        className="absolute bottom-0 left-0 right-0 max-h-[70vh] overflow-y-auto dropglass rounded-t-[22px] p-5 lg:absolute lg:bottom-auto lg:top-1/2 lg:left-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:w-[min(460px,94vw)] lg:rounded-[18px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-1">
            <h3 className="font-display text-lg font-medium">{event.title}</h3>
            <p className="text-[12px] text-text-muted mt-0.5">{event.event_type}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 grid place-items-center rounded-lg text-text-faint hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors"
          >
            <span className="text-lg">&times;</span>
          </button>
        </div>

        <div className="space-y-3 text-[13px]">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-text-faint" />
            <span className="text-text-primary">
              {event.all_day
                ? new Date(event.start_at).toLocaleDateString([], {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })
                : `${formatTime(event.start_at)} - ${formatTime(event.end_at)}`}
            </span>
          </div>
          {event.location && (
            <div className="flex items-center gap-2">
              <span className="text-text-faint text-[12px]">Location:</span>
              <span className="text-text-primary">{event.location}</span>
            </div>
          )}
          {event.description && (
            <div>
              <div className="text-text-faint text-[12px] mb-1">Description</div>
              <p className="text-text-muted whitespace-pre-wrap">{event.description}</p>
            </div>
          )}
          {event.created_by_name && (
            <div className="text-[11px] text-text-faint">
              Created by {event.created_by_name}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" size="sm" onClick={onEdit}>
            Edit
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
