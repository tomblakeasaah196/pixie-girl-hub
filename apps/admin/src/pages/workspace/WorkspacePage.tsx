import { useEffect, useRef, useState, useMemo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { formatDate } from "@/lib/format";
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
  Wallet,
  Target,
  StickyNote,
  Sparkles,
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
import { ModuleInsights } from "@/components/insights/ModuleInsights";
import { useAuthStore } from "@/stores/auth";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  Button,
  IconButton,
  Card,
  KpiTile,
  Skeleton,
  EmptyState,
  Pill,
} from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import MyHrPage from "@/pages/hr/MyHrPage";
import { useCosSettings, useCosFollowups, type CosFollowup } from "@/lib/cos-api";
import { GoalsTab } from "./GoalsTab";
import { NotesTab } from "./NotesTab";
import { ChiefOfStaffTab } from "./ChiefOfStaffTab";
import { useGoals } from "./goals-hooks";
import { GOAL_HEALTH_META } from "./goals-constants";
import type { Goal } from "./goals-types";

import { useTaskBoard, useCalendarEvents, useMoveTask } from "./hooks";
import { TaskAgenda } from "./TaskAgenda";
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
import type {
  WorkspaceTab,
  CalendarViewMode,
  Task,
  CalendarEvent,
} from "./types";

// ── Tab config ───────────────────────────────────────────────────────────

const TABS: {
  key: WorkspaceTab;
  label: string;
  icon: typeof Sun;
  ceoOnly?: boolean;
}[] = [
  { key: "my-day", label: "My Day", icon: Sun },
  { key: "goals", label: "Goals", icon: Target, ceoOnly: true },
  { key: "tasks", label: "Tasks", icon: ListTodo },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "notes", label: "Notes", icon: StickyNote, ceoOnly: true },
  {
    key: "chief-of-staff",
    label: "AI Chief of Staff",
    icon: Sparkles,
    ceoOnly: true,
  },
  { key: "my-hr", label: "My HR", icon: Wallet },
];

const CAL_VIEWS: { key: CalendarViewMode; label: string }[] = [
  { key: "month", label: "Month" },
  { key: "week", label: "Week" },
  { key: "day", label: "Day" },
  { key: "agenda", label: "Agenda" },
];

// Goals still in play — mirrors GoalsTab's filter so the "At Risk / Behind"
// KPI counts the same population the Goals tab shows.
const ACTIVE_GOAL_STATUSES = new Set(["active", "on_hold"]);

// Chief-of-Staff follow-up trigger → human label + severity tone, for the
// "Open Follow-ups" KPI drill-down.
const FOLLOWUP_TRIGGER_META: Record<
  string,
  { label: string; tone: "danger" | "warn" | "info" | "neutral" }
> = {
  overdue: { label: "Overdue", tone: "danger" },
  slippage: { label: "Slipping", tone: "danger" },
  no_progress: { label: "No progress", tone: "warn" },
  due_today: { label: "Due today", tone: "warn" },
  due_tomorrow: { label: "Due tomorrow", tone: "info" },
  weekly_review: { label: "Weekly review", tone: "neutral" },
};

const FOLLOWUP_SUBJECT_LABEL: Record<string, string> = {
  goal: "Goal",
  milestone: "Milestone",
  task: "Task",
};

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
        <span className="text-[10.5px] text-text-faint font-mono">
          {tasks.length}
        </span>
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
          <DraggableTaskCard
            key={task.task_id}
            task={task}
            onClick={() => onSelectTask(task)}
          />
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

function DraggableTaskCard({
  task,
  onClick,
}: {
  task: Task;
  onClick: () => void;
}) {
  // The DragOverlay renders the moving copy, so the source card stays put
  // and only dims (translating it as well would double the motion).
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.task_id,
  });

  return (
    <div ref={setNodeRef} {...listeners} {...attributes}>
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
  // Keep the active tab pill in view as the strip scrolls on phones.
  const activeTabRef = useRef<HTMLButtonElement | null>(null);

  // Mobile "New" menu — the tab strip has no room for two labelled buttons,
  // so phones get one compact icon button that fans to Task / Event instead
  // of losing the create action entirely.
  const [mobileCreateOpen, setMobileCreateOpen] = useState(false);
  const mobileCreateRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mobileCreateOpen) return;
    const onDown = (e: MouseEvent) =>
      !mobileCreateRef.current?.contains(e.target as Node) &&
      setMobileCreateOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [mobileCreateOpen]);

  const [searchParams, setSearchParams] = useSearchParams();
  const isCeo = !!user?.isCeo;
  // CoS surfaces (Goals / Notes / Chief of Staff) are CEO-only for v1.
  const visibleTabs = useMemo(
    () => TABS.filter((t) => !t.ceoOnly || isCeo),
    [isCeo],
  );
  const rawTab = (searchParams.get("tab") as WorkspaceTab) ?? "my-day";
  const activeTab: WorkspaceTab = visibleTabs.some((t) => t.key === rawTab)
    ? rawTab
    : "my-day";

  // PR6: the CoS tab label follows the CEO's chosen assistant name (e.g. "Ada").
  // Only the CoS entry is renamed; every other tab is fixed. Fetched only for
  // the CEO (the only role that sees the tab).
  const cosSettings = useCosSettings(isCeo);
  const cosName = cosSettings.data?.assistant_name?.trim();
  const cosTabLabel =
    cosName && cosName !== "Chief of Staff" ? cosName : "AI Chief of Staff";

  // Calendar state
  const [calView, setCalView] = useState<CalendarViewMode>("month");
  const [calDate, setCalDate] = useState(new Date());

  // Selection state
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(
    null,
  );

  // Modal state
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [editEvent, setEditEvent] = useState<CalendarEvent | null>(null);
  const [defaultDate, setDefaultDate] = useState<string | undefined>();

  // Task search
  const [taskSearch, setTaskSearch] = useState("");

  // Tasks tab audience. Everyone defaults to their own tasks; only users whose
  // tasks.view record scope reaches beyond 'own' can widen to the whole team
  // (the API enforces regardless — 'own' scope is filtered server-side).
  const scopeFor = useAuthStore((s) => s.scopeFor);
  const taskScope = scopeFor("tasks", "view");
  const canSeeAllTasks = taskScope === "all" || taskScope === "team";
  const [taskView, setTaskView] = useState<"mine" | "everyone">("mine");

  // Desktop layout for the Tasks tab: kanban board (default) or the
  // deadline-first agenda list. Phones always get the agenda.
  const [taskLayout, setTaskLayout] = useState<"board" | "list">("board");

  // Kanban drag
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const moveTask = useMoveTask();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // Data. The Tasks tab board can widen to everyone (scope permitting);
  // My Day always shows the signed-in user's own tasks. When both queries
  // ask for "me" they share a query key, so only one request is made.
  const {
    data: board,
    isLoading: boardLoading,
    isError: boardError,
    refetch: refetchBoard,
  } = useTaskBoard(
    taskView === "everyone" && canSeeAllTasks ? {} : { assigned_to: "me" },
  );
  const {
    data: myBoard,
    isLoading: myBoardLoading,
    isError: myBoardError,
    refetch: refetchMyBoard,
  } = useTaskBoard({ assigned_to: "me" });

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
          (a, b) =>
            new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
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

  // My Day KPIs count the user's OWN tasks, never the widened team board.
  const myTasks = useMemo(() => {
    if (!myBoard) return [];
    return [
      ...myBoard.to_do,
      ...myBoard.in_progress,
      ...myBoard.in_review,
      ...myBoard.done,
    ];
  }, [myBoard]);

  const dueTodayTasks = useMemo(
    () =>
      myTasks.filter(
        (t) =>
          t.due_at &&
          isSameDay(new Date(t.due_at), today) &&
          t.status !== "done" &&
          t.status !== "cancelled",
      ),
    [myTasks, todayStr],
  );

  const overdueTasks = useMemo(
    () =>
      myTasks.filter(
        (t) =>
          t.due_at &&
          isPast(t.due_at) &&
          !isSameDay(new Date(t.due_at), today) &&
          t.status !== "done" &&
          t.status !== "cancelled",
      ),
    [myTasks, todayStr],
  );

  const completedToday = useMemo(
    () =>
      myTasks.filter(
        (t) => t.completed_at && isSameDay(new Date(t.completed_at), today),
      ),
    [myTasks, todayStr],
  );

  // CoS-access (CEO) users trade the backward-looking "Overdue / Completed"
  // tiles for two strategic signals: goal health and the Chief-of-Staff
  // accountability queue. Both fetch only when the tiles are shown.
  const { data: goals = [], isLoading: goalsLoading } = useGoals(
    {},
    { enabled: isCeo },
  );
  const atRiskGoals = useMemo(
    () =>
      goals.filter(
        (g) =>
          ACTIVE_GOAL_STATUSES.has(g.status) &&
          (g.health === "at_risk" || g.health === "behind"),
      ),
    [goals],
  );
  const { data: followups = [], isLoading: followupsLoading } = useCosFollowups({
    enabled: isCeo,
  });

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

  // Bring the active tab pill into view on phones — with 7 tabs the strip
  // scrolls, and a selected tab hidden off-screen reads as "missing".
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [activeTab]);

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

  // Phone + Chief of Staff → the chat goes immersive (full viewport, own
  // header); rendering the page chrome behind it would only bleed through
  // the glass. The tab returns via its back chevron.
  if (isMobile && activeTab === "chief-of-staff") {
    return <ChiefOfStaffTab onExit={() => setTab("my-day")} />;
  }

  return (
    <div className="animate-fade-in">
      <ModuleInsights module="tasks" className="mb-4" />
      {/* Tab bar — a swipeable strip on phones (7 tabs never fit), inline on
          desktop. The active pill auto-centres itself into view. */}
      <div className="flex items-center gap-2 mb-4 md:mb-6">
        <div className="min-w-0 flex-1 md:flex-initial">
          <div className="flex gap-0.5 p-0.5 rounded-[12px] bg-text-primary/[0.04] border hairline overflow-x-auto hide-scrollbar">
            {visibleTabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                ref={activeTab === key ? activeTabRef : undefined}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "flex items-center gap-2 px-4 h-[36px] rounded-[10px] text-[13px] font-semibold transition-all whitespace-nowrap shrink-0",
                  activeTab === key
                    ? "bg-accent-deep text-[#F4E9D9] shadow-sm"
                    : "text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06]",
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {key === "chief-of-staff" ? cosTabLabel : label}
              </button>
            ))}
          </div>
        </div>

        {isMobile ? (
          <div className="relative shrink-0" ref={mobileCreateRef}>
            <IconButton
              aria-label="New task or event"
              title="New task or event"
              onClick={() => setMobileCreateOpen((o) => !o)}
            >
              <Plus className="w-[18px] h-[18px]" />
            </IconButton>
            {mobileCreateOpen && (
              <div
                role="menu"
                className="absolute z-[65] top-full right-0 mt-2 w-[168px] p-1.5 rounded-[13px] dropglass animate-fade-in"
              >
                <button
                  role="menuitem"
                  onClick={() => {
                    setMobileCreateOpen(false);
                    openCreateTaskForDate();
                  }}
                  className="w-full flex items-center gap-2.5 p-[9px_10px] rounded-[9px] text-[13px] font-medium text-text-muted hover:bg-text-primary/[0.06] hover:text-text-primary transition-all"
                >
                  <ListTodo className="w-4 h-4" /> New task
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMobileCreateOpen(false);
                    setShowCreateEvent(true);
                  }}
                  className="w-full flex items-center gap-2.5 p-[9px_10px] rounded-[9px] text-[13px] font-medium text-text-muted hover:bg-text-primary/[0.06] hover:text-text-primary transition-all"
                >
                  <CalendarDays className="w-4 h-4" /> New event
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="ml-auto flex items-center gap-2 shrink-0">
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
              isCeo={isCeo}
              todayEvents={todayEvents}
              dueTodayTasks={dueTodayTasks}
              overdueTasks={overdueTasks}
              completedToday={completedToday}
              atRiskGoals={atRiskGoals}
              goalsLoading={goalsLoading}
              followups={followups}
              followupsLoading={followupsLoading}
              eventsLoading={eventsLoading}
              boardLoading={myBoardLoading}
              boardError={myBoardError}
              eventsError={eventsError}
              onRetryBoard={refetchMyBoard}
              onRetryEvents={refetchEvents}
              onSelectTask={(t) => setSelectedTaskId(t.task_id)}
              onSelectEvent={setSelectedEvent}
              onCreateTask={() => openCreateTaskForDate()}
              onCreateEvent={() => setShowCreateEvent(true)}
              onOpenTab={setTab}
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

          {/* Tasks tab controls: audience switch (scopes beyond 'own') +
              desktop Board/List layout switch. Phones always get the agenda. */}
          {activeTab === "tasks" && (canSeeAllTasks || !isMobile) && (
            <div className="mb-4 flex items-center gap-2 flex-wrap">
              {canSeeAllTasks && (
                <div className="inline-flex gap-0.5 p-0.5 rounded-[12px] bg-text-primary/[0.04] border hairline">
                  {(["mine", "everyone"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setTaskView(v)}
                      className={cn(
                        "px-3.5 h-[30px] rounded-[10px] text-[12px] font-semibold transition-all whitespace-nowrap",
                        taskView === v
                          ? "bg-accent-deep text-[#F4E9D9] shadow-sm"
                          : "text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06]",
                      )}
                    >
                      {v === "mine" ? "My tasks" : "Everyone"}
                    </button>
                  ))}
                </div>
              )}
              {!isMobile && (
                <div className="inline-flex gap-0.5 p-0.5 rounded-[12px] bg-text-primary/[0.04] border hairline">
                  {(["board", "list"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setTaskLayout(v)}
                      className={cn(
                        "px-3.5 h-[30px] rounded-[10px] text-[12px] font-semibold transition-all whitespace-nowrap",
                        taskLayout === v
                          ? "bg-accent-deep text-[#F4E9D9] shadow-sm"
                          : "text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06]",
                      )}
                    >
                      {v === "board" ? "Board" : "List"}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {activeTab === "tasks" &&
            (isMobile || taskLayout === "list" ? (
              <TaskAgenda
                tasks={allTasks}
                loading={boardLoading}
                error={boardError}
                search={taskSearch}
                onSearchChange={setTaskSearch}
                onRetry={refetchBoard}
                onSelectTask={(t) => setSelectedTaskId(t.task_id)}
                onCreateTask={() => openCreateTaskForDate()}
                showAssignee={canSeeAllTasks && taskView === "everyone"}
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
                onDragStart={(e: DragStartEvent) =>
                  setActiveDragId(e.active.id as string)
                }
                onDragEnd={onDragEnd}
                onDragCancel={() => setActiveDragId(null)}
                onSelectTask={(t) => setSelectedTaskId(t.task_id)}
                onAddTask={() => {
                  openCreateTaskForDate();
                }}
              />
            ))}

          {activeTab === "goals" && <GoalsTab />}

          {activeTab === "notes" && <NotesTab />}

          {activeTab === "chief-of-staff" && <ChiefOfStaffTab />}

          {activeTab === "my-hr" && <MyHrPage />}
        </div>

        {/* Detail panel (desktop only) — sticky below the top bar with its
            own internal scroll, so scrolling the board never hides it. */}
        {isDesktop && selectedTaskId && (
          <div className="sticky top-[76px] self-start h-[calc(100dvh-100px)] min-h-[320px]">
            <TaskDetailPanel
              taskId={selectedTaskId}
              onClose={() => setSelectedTaskId(null)}
              onEdit={() => {
                const t = allTasks.find((x) => x.task_id === selectedTaskId);
                if (t) setEditTask(t);
              }}
            />
          </div>
        )}
      </div>

      {/* Mobile: show task detail as modal-like overlay */}
      {isMobile &&
        selectedTaskId &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-[3px]"
            onClick={() => setSelectedTaskId(null)}
          >
            <div
              className="absolute bottom-0 left-0 right-0 max-h-[88dvh] overflow-y-auto dropglass rounded-t-[22px] animate-slide-up pb-[max(env(safe-area-inset-bottom,0px),8px)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="grid place-items-center pt-2.5 -mb-1">
                <span
                  className="h-1 w-9 rounded-full bg-text-primary/20"
                  aria-hidden
                />
              </div>
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
    </div>
  );
}

// ── My Day KPI drill-down ────────────────────────────────────────────────

type MyDayKpiKey =
  | "events"
  | "due"
  | "overdue"
  | "completed"
  | "atRisk"
  | "followups";

/** Wraps a KpiTile so the whole tile is a button that opens its drill-down. */
function KpiButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full text-left rounded-[var(--radius)] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.99]"
    >
      {children}
    </button>
  );
}

/** Goal target dates arrive as "YYYY-MM-DD"; render a short, safe label. */
function fmtTargetDate(v?: string | null): string | null {
  if (!v) return null;
  return formatDate(String(v).slice(0, 10));
}

/**
 * Bottom-sheet (mobile) / centered modal (desktop) that expands one My Day KPI
 * into the list of items behind the number. Rows are tappable and route the
 * user to the full surface (task/event detail, or the Goals / Chief-of-Staff
 * tab). Mirrors EventDetailOverlay's glass + portal treatment.
 */
function MyDayKpiDetail({
  kpi,
  today,
  todayEvents,
  dueTodayTasks,
  overdueTasks,
  completedToday,
  atRiskGoals,
  followups,
  onClose,
  onSelectTask,
  onSelectEvent,
  onOpenTab,
}: {
  kpi: MyDayKpiKey;
  today: Date;
  todayEvents: CalendarEvent[];
  dueTodayTasks: Task[];
  overdueTasks: Task[];
  completedToday: Task[];
  atRiskGoals: Goal[];
  followups: CosFollowup[];
  onClose: () => void;
  onSelectTask: (t: Task) => void;
  onSelectEvent: (e: CalendarEvent) => void;
  onOpenTab: (tab: WorkspaceTab) => void;
}) {
  const dateLabel = formatDate(today);

  const emptyRow = (text: string) => (
    <p className="text-[13px] text-text-muted text-center py-8">{text}</p>
  );

  let title = "";
  let subtitle: string | undefined;
  let body: ReactNode = null;
  let jump: { label: string; tab: WorkspaceTab } | null = null;

  if (kpi === "events") {
    title = "Today's Events";
    subtitle = dateLabel;
    jump = { label: "Open Calendar", tab: "calendar" };
    body =
      todayEvents.length === 0
        ? emptyRow("No events today — your day is clear.")
        : todayEvents.map((ev) => (
            <button
              key={ev.event_id}
              onClick={() => onSelectEvent(ev)}
              className="w-full text-left flex items-center gap-3 p-2.5 rounded-xl hover:bg-text-primary/[0.04] transition-colors"
            >
              <div className="w-1 h-9 rounded-full bg-accent/40 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-text-primary truncate">
                  {ev.title}
                </div>
                <div className="text-[11px] text-text-faint">
                  {ev.all_day
                    ? "All day"
                    : `${formatTime(ev.start_at)} - ${formatTime(ev.end_at)}`}
                </div>
              </div>
            </button>
          ));
  } else if (kpi === "due" || kpi === "overdue" || kpi === "completed") {
    const cfg = {
      due: {
        title: "Tasks Due Today",
        subtitle: dateLabel,
        list: dueTodayTasks,
        empty: "Nothing due today.",
        overdue: false,
      },
      overdue: {
        title: "Overdue Tasks",
        subtitle: "Past their due date and still open",
        list: overdueTasks,
        empty: "No overdue tasks — nicely done.",
        overdue: true,
      },
      completed: {
        title: "Completed Today",
        subtitle: dateLabel,
        list: completedToday,
        empty: "Nothing completed yet today.",
        overdue: false,
      },
    }[kpi];
    title = cfg.title;
    subtitle = cfg.subtitle;
    jump = { label: "Open Tasks", tab: "tasks" };
    body =
      cfg.list.length === 0
        ? emptyRow(cfg.empty)
        : cfg.list.map((t) => (
            <TaskRow
              key={t.task_id}
              task={t}
              overdue={cfg.overdue}
              onClick={() => onSelectTask(t)}
            />
          ));
  } else if (kpi === "atRisk") {
    title = "Goals At Risk / Behind";
    subtitle = "Active goals that need your attention";
    jump = { label: "Open Goals", tab: "goals" };
    body =
      atRiskGoals.length === 0
        ? emptyRow("Every active goal is on track.")
        : atRiskGoals.map((g) => {
            const target = fmtTargetDate(g.target_date);
            return (
              <button
                key={g.goal_id}
                onClick={() => onOpenTab("goals")}
                className="w-full text-left flex items-center gap-3 p-2.5 rounded-xl hover:bg-text-primary/[0.04] transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-text-primary truncate">
                    {g.title}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <Pill tone={GOAL_HEALTH_META[g.health].tone} dot={false}>
                      {GOAL_HEALTH_META[g.health].label}
                    </Pill>
                    <span className="text-[11px] text-text-faint font-mono">
                      {g.progress_pct}%
                    </span>
                    {target && (
                      <span className="text-[11px] text-text-faint">
                        · due {target}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-text-faint shrink-0" />
              </button>
            );
          });
  } else {
    title = "Open Follow-ups";
    subtitle = "Nudges from your Chief of Staff";
    jump = { label: "Open Chief of Staff", tab: "chief-of-staff" };
    body =
      followups.length === 0
        ? emptyRow("No open follow-ups. You're all caught up.")
        : followups.map((f) => {
            const trig = FOLLOWUP_TRIGGER_META[f.trigger] ?? {
              label: f.trigger,
              tone: "neutral" as const,
            };
            const subject = FOLLOWUP_SUBJECT_LABEL[f.subject_type] ?? "Item";
            return (
              <button
                key={f.followup_id}
                onClick={() => onOpenTab("chief-of-staff")}
                className="w-full text-left flex items-start gap-3 p-2.5 rounded-xl hover:bg-text-primary/[0.04] transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-text-primary">
                    {f.question || `Check in on this ${subject.toLowerCase()}`}
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <Pill tone={trig.tone} dot={false}>
                      {trig.label}
                    </Pill>
                    <span className="text-[11px] text-text-faint">
                      {subject}
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-text-faint shrink-0 mt-0.5" />
              </button>
            );
          });
  }

  const footerJump = jump;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-[3px]"
      onClick={onClose}
    >
      <div
        className="absolute bottom-0 left-0 right-0 max-h-[82dvh] overflow-y-auto dropglass rounded-t-[22px] animate-slide-up p-5 pb-[calc(max(env(safe-area-inset-bottom,0px),8px)+12px)] lg:absolute lg:bottom-auto lg:top-1/2 lg:left-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:w-[min(480px,94vw)] lg:max-h-[78vh] lg:rounded-[18px] lg:animate-fade-in lg:pb-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <h3 className="font-display text-lg font-medium">{title}</h3>
            {subtitle && (
              <p className="text-[12px] text-text-muted mt-0.5">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 grid place-items-center rounded-lg text-text-faint hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors shrink-0"
          >
            <span className="text-lg">&times;</span>
          </button>
        </div>

        <div className="space-y-0.5">{body}</div>

        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
          {footerJump && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onOpenTab(footerJump.tab)}
            >
              {footerJump.label}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── My Day sub-view ──────────────────────────────────────────────────────

function MyDayView({
  userName,
  isCeo,
  todayEvents,
  dueTodayTasks,
  overdueTasks,
  completedToday,
  atRiskGoals,
  goalsLoading,
  followups,
  followupsLoading,
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
  onOpenTab,
}: {
  userName: string;
  isCeo: boolean;
  todayEvents: CalendarEvent[];
  dueTodayTasks: Task[];
  overdueTasks: Task[];
  completedToday: Task[];
  atRiskGoals: Goal[];
  goalsLoading: boolean;
  followups: CosFollowup[];
  followupsLoading: boolean;
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
  onOpenTab: (tab: WorkspaceTab) => void;
}) {
  const today = new Date();
  const [activeKpi, setActiveKpi] = useState<MyDayKpiKey | null>(null);

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h2 className="font-display text-2xl font-medium">
          {getGreeting()}, {userName.split(" ")[0]}
        </h2>
        <p className="text-[13px] text-text-muted mt-1">
          {formatDate(today)}
        </p>
      </div>

      {/* KPI row — each tile opens a drill-down modal. CoS-access users get
          goal-health + follow-ups in place of the Overdue/Completed tiles. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiButton onClick={() => setActiveKpi("events")}>
          <KpiTile
            label="Today's Events"
            value={eventsLoading ? "--" : String(todayEvents.length)}
            tone="accent"
          />
        </KpiButton>
        <KpiButton onClick={() => setActiveKpi("due")}>
          <KpiTile
            label="Tasks Due Today"
            value={boardLoading ? "--" : String(dueTodayTasks.length)}
            tone="accent"
          />
        </KpiButton>
        {isCeo ? (
          <>
            <KpiButton onClick={() => setActiveKpi("atRisk")}>
              <KpiTile
                label="At Risk / Behind"
                value={goalsLoading ? "--" : String(atRiskGoals.length)}
                tone={atRiskGoals.length > 0 ? "warn" : "accent"}
              />
            </KpiButton>
            <KpiButton onClick={() => setActiveKpi("followups")}>
              <KpiTile
                label="Open Follow-ups"
                value={followupsLoading ? "--" : String(followups.length)}
                tone={followups.length > 0 ? "warn" : "accent"}
              />
            </KpiButton>
          </>
        ) : (
          <>
            <KpiButton onClick={() => setActiveKpi("overdue")}>
              <KpiTile
                label="Overdue"
                value={boardLoading ? "--" : String(overdueTasks.length)}
                tone={overdueTasks.length > 0 ? "warn" : "accent"}
              />
            </KpiButton>
            <KpiButton onClick={() => setActiveKpi("completed")}>
              <KpiTile
                label="Completed Today"
                value={boardLoading ? "--" : String(completedToday.length)}
                tone="accent"
              />
            </KpiButton>
          </>
        )}
      </div>

      {activeKpi && (
        <MyDayKpiDetail
          kpi={activeKpi}
          today={today}
          todayEvents={todayEvents}
          dueTodayTasks={dueTodayTasks}
          overdueTasks={overdueTasks}
          completedToday={completedToday}
          atRiskGoals={atRiskGoals}
          followups={followups}
          onClose={() => setActiveKpi(null)}
          onSelectTask={(t) => {
            setActiveKpi(null);
            onSelectTask(t);
          }}
          onSelectEvent={(e) => {
            setActiveKpi(null);
            onSelectEvent(e);
          }}
          onOpenTab={(tab) => {
            setActiveKpi(null);
            onOpenTab(tab);
          }}
        />
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Today's Schedule */}
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 p-4 border-b hairline">
            <Clock className="w-4 h-4 text-accent-glow" />
            <span className="text-[13px] font-semibold flex-1">
              Today's Schedule
            </span>
            <Button
              variant="ghost"
              size="sm"
              icon={<Plus className="w-3 h-3" />}
              onClick={onCreateEvent}
            >
              Event
            </Button>
          </div>
          <div className="p-3">
            {eventsError && (
              <ErrorState
                message="Could not load events."
                onRetry={onRetryEvents}
              />
            )}
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
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Plus className="w-3 h-3" />}
                    onClick={onCreateEvent}
                  >
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
                      {ev.all_day
                        ? "All day"
                        : `${formatTime(ev.start_at)} - ${formatTime(ev.end_at)}`}
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
            <Button
              variant="ghost"
              size="sm"
              icon={<Plus className="w-3 h-3" />}
              onClick={onCreateTask}
            >
              Task
            </Button>
          </div>
          <div className="p-3">
            {boardError && (
              <ErrorState
                message="Could not load tasks."
                onRetry={onRetryBoard}
              />
            )}
            {boardLoading && (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded-xl" />
                ))}
              </div>
            )}
            {!boardLoading &&
              !boardError &&
              overdueTasks.length === 0 &&
              dueTodayTasks.length === 0 && (
                <EmptyState
                  icon={<CheckCircle2 className="w-6 h-6" />}
                  title="All caught up"
                  message="No tasks due today."
                  action={
                    <Button
                      variant="primary"
                      size="sm"
                      icon={<Plus className="w-3 h-3" />}
                      onClick={onCreateTask}
                    >
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
                      <TaskRow
                        key={t.task_id}
                        task={t}
                        overdue
                        onClick={() => onSelectTask(t)}
                      />
                    ))}
                  </div>
                )}
                {dueTodayTasks.length > 0 && (
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-text-faint mb-2">
                      Due Today
                    </div>
                    {dueTodayTasks.map((t) => (
                      <TaskRow
                        key={t.task_id}
                        task={t}
                        onClick={() => onSelectTask(t)}
                      />
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
      <span className="text-[13px] text-text-primary flex-1 truncate">
        {task.title}
      </span>
      {task.due_at && (
        <span
          className={cn(
            "text-[10px] font-mono",
            overdue ? "text-danger" : "text-text-faint",
          )}
        >
          {formatDate(task.due_at)}
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
  if (error)
    return (
      <ErrorState message="Could not load calendar events." onRetry={onRetry} />
    );

  const title =
    calView === "month"
      ? `${MONTH_NAMES[calDate.getMonth()]} ${calDate.getFullYear()}`
      : calView === "week"
        ? `Week of ${calDate.toLocaleDateString([], { month: "short", day: "numeric" })}`
        : calDate.toLocaleDateString([], {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          });

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
        <AgendaView
          events={events}
          loading={loading}
          onSelectEvent={onSelectEvent}
        />
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
  if (error)
    return <ErrorState message="Could not load tasks." onRetry={onRetry} />;

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
            className="w-full h-[36px] pl-9 pr-3 rounded-[10px] bg-text-primary/[0.04] border border-line text-[12px] text-text-primary outline-none focus:border-accent/50 transition-colors" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
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
            {activeDragTask ? (
              <TaskCard task={activeDragTask} isDragging />
            ) : null}
          </DragOverlay>
        </DndContext>
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
    <div
      className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-[3px]"
      onClick={onClose}
    >
      <div
        className="absolute bottom-0 left-0 right-0 max-h-[78dvh] overflow-y-auto dropglass rounded-t-[22px] animate-slide-up p-5 pb-[calc(max(env(safe-area-inset-bottom,0px),8px)+12px)] lg:absolute lg:bottom-auto lg:top-1/2 lg:left-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:w-[min(460px,94vw)] lg:rounded-[18px] lg:animate-fade-in lg:pb-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-1">
            <h3 className="font-display text-lg font-medium">{event.title}</h3>
            <p className="text-[12px] text-text-muted mt-0.5">
              {event.event_type}
            </p>
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
                ? formatDate(event.start_at)
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
              <div className="text-text-faint text-[12px] mb-1">
                Description
              </div>
              <p className="text-text-muted whitespace-pre-wrap">
                {event.description}
              </p>
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
