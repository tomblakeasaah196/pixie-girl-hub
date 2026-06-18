import { useState, useRef, type KeyboardEvent } from "react";
import {
  X,
  Calendar,
  User,
  Plus,
  Trash2,
  Check,
  Square,
  CheckSquare,
  Edit2,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, IconButton, Pill, Skeleton } from "@/components/ui/primitives";
import type { Subtask } from "./types";
import {
  TASK_STATUS_META,
  TASK_PRIORITY_META,
  formatDate,
  formatTime,
  isPast,
} from "./constants";
import {
  useTask,
  useAddSubtask,
  useToggleSubtask,
  useDeleteSubtask,
} from "./hooks";

// ── Props ───────────────────────────────────────────────────────────────

interface TaskDetailPanelProps {
  taskId: string;
  onClose: () => void;
  onEdit: () => void;
}

// ── Loading skeleton ────────────────────────────────────────────────────

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-5 p-5">
      {/* header */}
      <div className="flex items-start justify-between gap-3">
        <Skeleton className="w-3/4" style={{ height: 22 }} />
        <Skeleton className="w-8 shrink-0" style={{ height: 22 }} />
      </div>

      {/* pills */}
      <div className="flex gap-2">
        <Skeleton className="w-20" style={{ height: 24 }} />
        <Skeleton className="w-20" style={{ height: 24 }} />
      </div>

      {/* info rows */}
      <div className="flex flex-col gap-3">
        <Skeleton className="w-full" style={{ height: 14 }} />
        <Skeleton className="w-2/3" style={{ height: 14 }} />
        <Skeleton className="w-1/2" style={{ height: 14 }} />
        <Skeleton className="w-2/3" style={{ height: 14 }} />
      </div>

      {/* description */}
      <Skeleton className="w-full" style={{ height: 60 }} />

      {/* subtasks */}
      <Skeleton className="w-full" style={{ height: 14 }} />
      <Skeleton className="w-full" style={{ height: 32 }} />
      <Skeleton className="w-full" style={{ height: 32 }} />
    </div>
  );
}

// ── Info row helper ─────────────────────────────────────────────────────

function InfoRow({
  icon,
  label,
  value,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5 text-[13px]", className)}>
      <span className="text-text-faint shrink-0">{icon}</span>
      <span className="text-text-muted shrink-0 w-20">{label}</span>
      <span className="text-text-primary truncate">{value}</span>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────

export default function TaskDetailPanel({
  taskId,
  onClose,
  onEdit,
}: TaskDetailPanelProps) {
  const { data: task, isLoading } = useTask(taskId);
  const addSubtask = useAddSubtask(taskId);
  const toggleSubtask = useToggleSubtask(taskId);
  const deleteSubtask = useDeleteSubtask(taskId);

  const [showAddInput, setShowAddInput] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // ── handlers ──────────────────────────────────────────────────────────

  function handleAddSubtask() {
    const title = newSubtaskTitle.trim();
    if (!title) return;
    addSubtask.mutate(title, {
      onSuccess: () => {
        setNewSubtaskTitle("");
        inputRef.current?.focus();
      },
    });
  }

  function handleAddKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddSubtask();
    }
    if (e.key === "Escape") {
      setShowAddInput(false);
      setNewSubtaskTitle("");
    }
  }

  function handleToggle(subtask: Subtask) {
    toggleSubtask.mutate({
      subtaskId: subtask.subtask_id,
      is_done: !subtask.is_done,
    });
  }

  function handleDelete(subtaskId: string) {
    deleteSubtask.mutate(subtaskId);
  }

  function handleShowAdd() {
    setShowAddInput(true);
    // focus after render
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  // ── derived ───────────────────────────────────────────────────────────

  const subtasks: Subtask[] = task?.subtasks ?? [];
  const doneCount = task?.subtask_done_count ?? subtasks.filter((s) => s.is_done).length;
  const totalCount = task?.subtask_count ?? subtasks.length;
  const statusMeta = task ? TASK_STATUS_META[task.status] : null;
  const priorityMeta = task ? TASK_PRIORITY_META[task.priority] : null;
  const overdue = task?.due_at ? isPast(task.due_at) && task.status !== "done" && task.status !== "cancelled" : false;

  // ── render ────────────────────────────────────────────────────────────

  return (
    <div className="glass rounded-[var(--radius)] shadow-glass overflow-hidden flex flex-col h-full">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-3 p-5 pb-0">
        <h2 className="font-display text-lg font-medium text-text-primary leading-snug flex-1 min-w-0 break-words">
          {isLoading ? <Skeleton style={{ height: 22 }} /> : task?.title}
        </h2>
        <div className="flex items-center gap-1 shrink-0">
          <IconButton onClick={onEdit} aria-label="Edit task">
            <Edit2 size={16} />
          </IconButton>
          <IconButton onClick={onClose} aria-label="Close panel">
            <X size={16} />
          </IconButton>
        </div>
      </div>

      {isLoading ? (
        <DetailSkeleton />
      ) : task ? (
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
          {/* ── Status + Priority pills ── */}
          <div className="flex items-center gap-2 flex-wrap">
            {statusMeta && <Pill tone={statusMeta.tone}>{statusMeta.label}</Pill>}
            {priorityMeta && <Pill tone={priorityMeta.tone}>{priorityMeta.label}</Pill>}
          </div>

          {/* ── Info rows ── */}
          <div className="flex flex-col gap-2.5">
            {task.assigned_to_name && (
              <InfoRow
                icon={<User size={14} />}
                label="Assigned to"
                value={task.assigned_to_name}
              />
            )}

            {task.due_at && (
              <InfoRow
                icon={<Calendar size={14} />}
                label="Due date"
                value={
                  <span className={cn(overdue && "text-danger font-semibold")}>
                    {formatDate(task.due_at)}
                    {" "}
                    <span className="text-text-faint">{formatTime(task.due_at)}</span>
                    {overdue && <span className="ml-1.5 text-[11px]">Overdue</span>}
                  </span>
                }
                className={cn(overdue && "text-danger")}
              />
            )}

            {task.created_by_name && (
              <InfoRow
                icon={<User size={14} />}
                label="Created by"
                value={task.created_by_name}
              />
            )}

            <InfoRow
              icon={<Clock size={14} />}
              label="Created at"
              value={formatDate(task.created_at)}
            />
          </div>

          {/* ── Description ── */}
          {task.description && (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-text-faint">
                Description
              </h3>
              <p className="text-[13px] text-text-muted leading-relaxed whitespace-pre-wrap">
                {task.description}
              </p>
            </div>
          )}

          {/* ── Subtasks ── */}
          <div className="flex flex-col gap-2.5">
            {/* subtask header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-text-faint">
                  Subtasks
                </h3>
                {totalCount > 0 && (
                  <span className="text-[11px] text-text-muted">
                    {doneCount} of {totalCount} done
                  </span>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon={<Plus size={14} />}
                onClick={handleShowAdd}
              >
                Add
              </Button>
            </div>

            {/* subtask list */}
            {subtasks.length > 0 && (
              <ul className="flex flex-col gap-1">
                {subtasks.map((st) => (
                  <li
                    key={st.subtask_id}
                    className="group flex items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-text-primary/[0.04] transition-colors"
                  >
                    <button
                      type="button"
                      className="shrink-0 text-text-muted hover:text-accent-glow transition-colors"
                      onClick={() => handleToggle(st)}
                      aria-label={st.is_done ? "Mark incomplete" : "Mark complete"}
                    >
                      {st.is_done ? (
                        <CheckSquare size={16} className="text-accent-glow" />
                      ) : (
                        <Square size={16} />
                      )}
                    </button>
                    <span
                      className={cn(
                        "flex-1 text-[13px] leading-snug min-w-0 truncate",
                        st.is_done
                          ? "line-through text-text-faint"
                          : "text-text-primary",
                      )}
                    >
                      {st.title}
                    </span>
                    <button
                      type="button"
                      className="shrink-0 opacity-0 group-hover:opacity-100 text-text-faint hover:text-danger transition-all"
                      onClick={() => handleDelete(st.subtask_id)}
                      aria-label="Delete subtask"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* add subtask input */}
            {showAddInput && (
              <div className="flex items-center gap-2 px-2.5">
                <Check size={16} className="text-text-faint shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  value={newSubtaskTitle}
                  onChange={(e) => setNewSubtaskTitle(e.target.value)}
                  onKeyDown={handleAddKeyDown}
                  placeholder="Subtask title..."
                  className="flex-1 bg-transparent border-b border-line text-[13px] text-text-primary placeholder:text-text-faint py-1.5 outline-none focus:border-accent-glow transition-colors"
                  disabled={addSubtask.isPending}
                />
              </div>
            )}

            {/* empty state */}
            {subtasks.length === 0 && !showAddInput && (
              <p className="text-[12px] text-text-faint px-2.5">
                No subtasks yet
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
