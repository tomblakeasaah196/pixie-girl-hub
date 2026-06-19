import { useDraggable } from "@dnd-kit/core";
import { Calendar, User } from "lucide-react";
import { cn } from "@/lib/cn";
import { Pill } from "@/components/ui/primitives";
import type { Task } from "./types";
import { TASK_PRIORITY_META, isPast } from "./constants";

interface TaskCardProps {
  task: Task;
  isDragging?: boolean;
  onClick?: () => void;
}

export function TaskCard({ task, isDragging, onClick }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: task.task_id,
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  const priorityMeta = TASK_PRIORITY_META[task.priority];

  const overdue =
    !!task.due_at && task.status !== "done" && isPast(task.due_at);

  const subtaskTotal = task.subtask_count ?? 0;
  const subtaskDone = task.subtask_done_count ?? 0;
  const subtaskPct = subtaskTotal > 0 ? (subtaskDone / subtaskTotal) * 100 : 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={cn(
        "glass rounded-[13px] p-3 cursor-grab active:cursor-grabbing transition-shadow hover:shadow-lg",
        isDragging && "opacity-40",
      )}
    >
      {/* Title */}
      <p className="text-sm font-medium text-text-primary line-clamp-2 mb-2">
        {task.title}
      </p>

      {/* Priority pill */}
      <div className="mb-2">
        <Pill tone={priorityMeta.tone}>{priorityMeta.label}</Pill>
      </div>

      {/* Due date + assignee row */}
      <div className="flex items-center gap-3 text-xs text-text-muted">
        {task.due_at && (
          <span
            className={cn(
              "inline-flex items-center gap-1",
              overdue && "text-danger",
            )}
          >
            <Calendar className="w-3.5 h-3.5" />
            {new Date(task.due_at).toLocaleDateString([], {
              month: "short",
              day: "numeric",
            })}
          </span>
        )}

        {task.assigned_to_name && (
          <span className="inline-flex items-center gap-1">
            <User className="w-3.5 h-3.5" />
            {task.assigned_to_name}
          </span>
        )}
      </div>

      {/* Subtask progress */}
      {subtaskTotal > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 h-1 rounded-full bg-text-primary/[0.08] overflow-hidden">
            <div
              className="h-full rounded-full bg-accent-deep transition-all"
              style={{ width: `${subtaskPct}%` }}
            />
          </div>
          <span className="text-[11px] text-text-faint tabular-nums">
            {subtaskDone}/{subtaskTotal}
          </span>
        </div>
      )}
    </div>
  );
}
