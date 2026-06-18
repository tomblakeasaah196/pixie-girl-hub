import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { Field, TextInput, FormSection } from "@/components/ui/Form";
import { Select } from "@/components/ui/controls";
import { Toggle } from "@/components/ui/controls";
import { useCreateTask, useUpdateTask } from "./hooks";
import { TASK_STATUS_OPTIONS, TASK_PRIORITY_OPTIONS, REMINDER_OPTIONS } from "./constants";
import type { Task, TaskCreateInput, TaskStatus, TaskPriority } from "./types";

interface Props {
  open: boolean;
  onClose: () => void;
  task?: Task | null;
  defaultDate?: string;
}

/** Convert an ISO date string to the `datetime-local` input format (YYYY-MM-DDTHH:mm). */
function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TaskFormModal({ open, onClose, task, defaultDate }: Props) {
  const isEdit = !!task;

  // ── Form state ────────────────────────────────────────────────────────
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("to_do");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [dueAt, setDueAt] = useState("");
  const [reminderMinutes, setReminderMinutes] = useState("");
  const [isPersonal, setIsPersonal] = useState(false);
  const [error, setError] = useState("");

  // Reset form state when modal opens or task changes
  useEffect(() => {
    if (!open) return;
    if (task) {
      setTitle(task.title);
      setDescription(task.description ?? "");
      setStatus(task.status);
      setPriority(task.priority);
      setDueAt(toDatetimeLocal(task.due_at));
      setReminderMinutes(task.reminder_minutes != null ? String(task.reminder_minutes) : "");
      setIsPersonal(task.is_personal ?? false);
    } else {
      setTitle("");
      setDescription("");
      setStatus("to_do");
      setPriority("normal");
      setDueAt(defaultDate ? toDatetimeLocal(defaultDate) : "");
      setReminderMinutes("");
      setIsPersonal(false);
    }
    setError("");
  }, [open, task, defaultDate]);

  // ── Mutations ─────────────────────────────────────────────────────────
  const createMut = useCreateTask();
  const updateMut = useUpdateTask(task?.task_id ?? "");
  const busy = createMut.isPending || updateMut.isPending;

  // ── Submit ────────────────────────────────────────────────────────────
  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError("");

    if (!title.trim()) {
      setError("Title is required.");
      return;
    }

    const payload: TaskCreateInput = {
      title: title.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      status,
      priority,
      ...(dueAt ? { due_at: new Date(dueAt).toISOString() } : {}),
      ...(reminderMinutes !== "" ? { reminder_minutes: Number(reminderMinutes) } : {}),
      is_personal: isPersonal,
    };

    try {
      if (isEdit) {
        await updateMut.mutateAsync(payload);
      } else {
        await createMut.mutateAsync(payload);
      }
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit Task" : "New Task"}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={busy}>
            {busy ? "Saving..." : isEdit ? "Save Changes" : "Create Task"}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-0">
        {error && (
          <div className="mb-4 px-3 py-2.5 rounded-[10px] bg-danger/[0.1] border border-danger/30 text-[12px] text-danger">
            {error}
          </div>
        )}

        {/* Title */}
        <FormSection>
          <Field label="Title *">
            <TextInput
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              required
              autoFocus
            />
          </Field>
        </FormSection>

        {/* Description */}
        <FormSection>
          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add more detail..."
              rows={3}
              className="w-full px-[13px] py-[10px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none transition-colors focus:border-accent/50 resize-y min-h-[80px]"
            />
          </Field>
        </FormSection>

        {/* Status + Priority */}
        <FormSection>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Status">
              <Select
                value={status}
                onChange={setStatus}
                options={TASK_STATUS_OPTIONS}
              />
            </Field>
            <Field label="Priority">
              <Select
                value={priority}
                onChange={setPriority}
                options={TASK_PRIORITY_OPTIONS}
              />
            </Field>
          </div>
        </FormSection>

        {/* Due Date + Reminder */}
        <FormSection>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Due date">
              <TextInput
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </Field>
            <Field label="Reminder">
              <Select
                value={reminderMinutes}
                onChange={setReminderMinutes}
                options={REMINDER_OPTIONS}
              />
            </Field>
          </div>
        </FormSection>

        {/* Personal toggle */}
        <FormSection>
          <Toggle
            checked={isPersonal}
            onChange={setIsPersonal}
            label="Personal task (visible only to you)"
          />
        </FormSection>
      </form>
    </Modal>
  );
}
