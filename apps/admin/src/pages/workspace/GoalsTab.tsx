import { useMemo, useState } from "react";
import { Target, Plus, Flag, CalendarClock } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Button,
  Card,
  KpiTile,
  Skeleton,
  EmptyState,
  Pill,
} from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import { useGoals } from "./goals-hooks";
import { GoalFormModal } from "./GoalFormModal";
import { GoalDetailPanel } from "./GoalDetailPanel";
import { ProgressRing } from "./ProgressRing";
import {
  GOAL_STATUS_META,
  GOAL_HEALTH_META,
  GOAL_PRIORITY_META,
} from "./goals-constants";
import type { Goal } from "./goals-types";

const DAY = 86_400_000;

function daysUntil(date: string): number {
  const d = new Date(date + "T00:00:00");
  return Math.ceil((d.getTime() - Date.now()) / DAY);
}

function formatTarget(date: string | null | undefined): string | null {
  if (!date) return null;
  return new Date(date + "T00:00:00").toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const ACTIVE_STATUSES = new Set(["active", "on_hold"]);

export function GoalsTab() {
  const [showCreate, setShowCreate] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);
  const [editGoal, setEditGoal] = useState<Goal | null>(null);
  const { data: goals = [], isLoading, isError, refetch } = useGoals();

  const stats = useMemo(() => {
    const active = goals.filter((g) => ACTIVE_STATUSES.has(g.status));
    const avg =
      active.length === 0
        ? 0
        : Math.round(
            active.reduce((s, g) => s + (g.progress_pct ?? 0), 0) /
              active.length,
          );
    const upcoming = active.filter((g) => {
      if (!g.target_date) return false;
      const d = daysUntil(g.target_date);
      return d >= 0 && d <= 14;
    }).length;
    const overdue = active.filter(
      (g) => g.target_date && daysUntil(g.target_date) < 0,
    ).length;
    return { activeCount: active.length, avg, upcoming, overdue };
  }, [goals]);

  if (isError)
    return <ErrorState message="Could not load goals." onRetry={refetch} />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div>
          <h2 className="font-display text-2xl font-medium">My Goals</h2>
          <p className="text-[13px] text-text-muted mt-1">
            Turn intentions into tracked execution.
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          className="ml-auto"
          icon={<Plus className="w-3.5 h-3.5" />}
          onClick={() => setShowCreate(true)}
        >
          New Goal
        </Button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile
          label="Active Goals"
          value={isLoading ? "--" : String(stats.activeCount)}
          tone="accent"
        />
        <KpiTile
          label="Avg Progress"
          value={isLoading ? "--" : `${stats.avg}%`}
          tone="accent"
        />
        <KpiTile
          label="Due ≤ 14 days"
          value={isLoading ? "--" : String(stats.upcoming)}
          tone="accent"
        />
        <KpiTile
          label="Overdue"
          value={isLoading ? "--" : String(stats.overdue)}
          tone={stats.overdue > 0 ? "warn" : "accent"}
        />
      </div>

      {/* Goal list */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[132px] rounded-[var(--radius)]" />
          ))}
        </div>
      ) : goals.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Target className="w-7 h-7" />}
            title="No goals yet"
            message="Create your first goal and break it into milestones and tasks."
            action={
              <Button
                variant="primary"
                size="sm"
                icon={<Plus className="w-3 h-3" />}
                onClick={() => setShowCreate(true)}
              >
                New Goal
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {goals.map((g) => (
            <GoalCard
              key={g.goal_id}
              goal={g}
              onClick={() => setSelectedGoal(g)}
            />
          ))}
        </div>
      )}

      <GoalFormModal open={showCreate} onClose={() => setShowCreate(false)} />
      <GoalFormModal
        open={!!editGoal}
        goal={editGoal}
        onClose={() => setEditGoal(null)}
      />

      {selectedGoal && (
        <GoalDetailPanel
          goal={selectedGoal}
          onClose={() => setSelectedGoal(null)}
          onEdit={(g) => {
            setSelectedGoal(null);
            setEditGoal(g);
          }}
        />
      )}
    </div>
  );
}

function GoalCard({ goal, onClick }: { goal: Goal; onClick: () => void }) {
  const status = GOAL_STATUS_META[goal.status];
  const health = GOAL_HEALTH_META[goal.health];
  const priority = GOAL_PRIORITY_META[goal.priority];
  const target = formatTarget(goal.target_date);
  const overdue =
    goal.target_date &&
    daysUntil(goal.target_date) < 0 &&
    ACTIVE_STATUSES.has(goal.status);

  const mDone = goal.milestone_done ?? 0;
  const mTotal = goal.milestone_total ?? 0;
  const tDone = goal.task_done ?? 0;
  const tTotal = goal.task_total ?? 0;

  return (
    <button
      onClick={onClick}
      className="text-left glass rounded-[var(--radius)] shadow-glass p-4 hover:bg-text-primary/[0.03] transition-colors w-full"
    >
      <div className="flex items-start gap-3">
        <ProgressRing value={goal.progress_pct ?? 0} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <h3 className="font-display text-[15px] font-medium text-text-primary flex-1 truncate">
              {goal.title}
            </h3>
            <Pill tone={priority.tone} dot={false}>
              {priority.label}
            </Pill>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <Pill tone={status.tone} dot={false}>
              {status.label}
            </Pill>
            {goal.status === "active" && (
              <Pill tone={health.tone} dot={false}>
                {health.label}
              </Pill>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 mt-3 text-[11px] text-text-faint">
        {(mTotal > 0 || tTotal > 0) && (
          <span className="inline-flex items-center gap-1">
            <Flag className="w-3 h-3" />
            {mDone}/{mTotal} · {tDone}/{tTotal} tasks
          </span>
        )}
        {target && (
          <span
            className={cn(
              "inline-flex items-center gap-1 ml-auto font-mono",
              overdue ? "text-danger" : "text-text-faint",
            )}
          >
            <CalendarClock className="w-3 h-3" />
            {target}
          </span>
        )}
      </div>
    </button>
  );
}
