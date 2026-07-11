import { useState, useEffect } from "react";
import { Plus, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { Field, TextInput, FormSection } from "@/components/ui/Form";
import { Select } from "@/components/ui/controls";
import { toastReport } from "@/lib/error-report";
import { useCreateGoal, useUpdateGoal } from "./goals-hooks";
import { GOAL_STATUS_OPTIONS, GOAL_PRIORITY_OPTIONS } from "./goals-constants";
import type {
  Goal,
  GoalCreateInput,
  GoalStatus,
  GoalPriority,
  MilestoneInput,
} from "./goals-types";

interface Props {
  open: boolean;
  onClose: () => void;
  goal?: Goal | null;
}

/** ISO/date string → the `date` input format (YYYY-MM-DD). */
function toDateInput(v: string | null | undefined): string {
  if (!v) return "";
  return String(v).slice(0, 10);
}

export function GoalFormModal({ open, onClose, goal }: Props) {
  const isEdit = !!goal;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<GoalStatus>("active");
  const [priority, setPriority] = useState<GoalPriority>("normal");
  const [targetDate, setTargetDate] = useState("");
  const [milestones, setMilestones] = useState<MilestoneInput[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    if (goal) {
      setTitle(goal.title);
      setDescription(goal.description ?? "");
      setStatus(goal.status);
      setPriority(goal.priority);
      setTargetDate(toDateInput(goal.target_date));
    } else {
      setTitle("");
      setDescription("");
      setStatus("active");
      setPriority("normal");
      setTargetDate("");
      setMilestones([]);
    }
    setError("");
  }, [open, goal]);

  const createMut = useCreateGoal();
  const updateMut = useUpdateGoal(goal?.goal_id ?? "");
  const busy = createMut.isPending || updateMut.isPending;

  const addMilestoneRow = () =>
    setMilestones((m) => [...m, { title: "", target_date: "" }]);
  const setMilestoneField = (
    i: number,
    field: keyof MilestoneInput,
    value: string,
  ) =>
    setMilestones((m) =>
      m.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)),
    );
  const removeMilestoneRow = (i: number) =>
    setMilestones((m) => m.filter((_, idx) => idx !== i));

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError("");
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    const cleanMilestones = milestones
      .map((m) => ({
        title: m.title.trim(),
        ...(m.target_date ? { target_date: m.target_date } : {}),
      }))
      .filter((m) => m.title);

    const payload: GoalCreateInput = {
      title: title.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      status,
      priority,
      ...(targetDate ? { target_date: targetDate } : {}),
      ...(!isEdit && cleanMilestones.length
        ? { milestones: cleanMilestones }
        : {}),
    };

    try {
      if (isEdit) {
        await updateMut.mutateAsync({
          title: payload.title,
          description: description.trim() ? description.trim() : null,
          status,
          priority,
          target_date: targetDate || null,
        });
      } else {
        await createMut.mutateAsync(payload);
      }
      onClose();
    } catch (err: unknown) {
      toastReport("Workspace → Goal", "Save goal", err);
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit Goal" : "New Goal"}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={busy}
          >
            {busy ? "Saving..." : isEdit ? "Save Changes" : "Create Goal"}
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

        <FormSection>
          <Field label="Goal *">
            <TextInput
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Launch Pixie Girl Accessories"
              required
              autoFocus
            />
          </Field>
        </FormSection>

        <FormSection>
          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does success look like?"
              rows={3}
              className="w-full px-[13px] py-[10px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none transition-colors focus:border-accent/50 resize-y min-h-[80px]"
            />
          </Field>
        </FormSection>

        <FormSection>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Status">
              <Select
                value={status}
                onChange={setStatus}
                options={GOAL_STATUS_OPTIONS}
              />
            </Field>
            <Field label="Priority">
              <Select
                value={priority}
                onChange={setPriority}
                options={GOAL_PRIORITY_OPTIONS}
              />
            </Field>
            <Field label="Target date">
              <TextInput
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
              />
            </Field>
          </div>
        </FormSection>

        {/* Inline milestones (create only — edit manages them in the detail panel) */}
        {!isEdit && (
          <FormSection>
            <Field label="Milestones (optional)">
              <div className="flex flex-col gap-2">
                {milestones.map((m, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <TextInput
                      value={m.title}
                      onChange={(e) =>
                        setMilestoneField(i, "title", e.target.value)
                      }
                      placeholder={`Milestone ${i + 1}`}
                    />
                    <input
                      type="date"
                      value={m.target_date ?? ""}
                      onChange={(e) =>
                        setMilestoneField(i, "target_date", e.target.value)
                      }
                      className="h-[38px] px-2 rounded-[10px] bg-text-primary/[0.04] border border-line text-[12px] text-text-primary outline-none focus:border-accent/50"
                    />
                    <button
                      type="button"
                      onClick={() => removeMilestoneRow(i)}
                      className="w-8 h-8 grid place-items-center rounded-lg text-text-faint hover:text-danger hover:bg-danger/10 transition-colors shrink-0"
                      aria-label="Remove milestone"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={<Plus className="w-3.5 h-3.5" />}
                  onClick={addMilestoneRow}
                >
                  Add milestone
                </Button>
              </div>
            </Field>
          </FormSection>
        )}
      </form>
    </Modal>
  );
}
