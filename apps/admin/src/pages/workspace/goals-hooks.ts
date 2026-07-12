import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBusinessStore } from "@/stores/business";
import * as g from "./goals-api";
import type {
  GoalCreateInput,
  GoalUpdateInput,
  MilestoneInput,
  MilestoneUpdateInput,
  NoteInput,
} from "./goals-types";

function useBiz() {
  return useBusinessStore((s) => s.activeKey);
}

// ── Goal queries ─────────────────────────────────────────────────────────

export function useGoals(
  params: g.GoalListParams = {},
  options: { enabled?: boolean } = {},
) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["workspace", biz, "goals", params],
    queryFn: () => g.listGoals(params),
    staleTime: 30_000,
    enabled: options.enabled ?? true,
  });
}

export function useGoal(id: string | null) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["workspace", biz, "goal", id],
    queryFn: () => g.getGoal(id!),
    enabled: !!id,
  });
}

// ── Goal mutations ───────────────────────────────────────────────────────

export function useCreateGoal() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (input: GoalCreateInput) => g.createGoal(input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["workspace", biz, "goals"] }),
  });
}

export function useUpdateGoal(id: string) {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (input: GoalUpdateInput) => g.updateGoal(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace", biz, "goals"] });
      qc.invalidateQueries({ queryKey: ["workspace", biz, "goal", id] });
    },
  });
}

export function useDeleteGoal() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (id: string) => g.deleteGoal(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["workspace", biz, "goals"] }),
  });
}

// ── Milestone mutations (invalidate the parent goal + list for progress) ──

function useGoalInvalidator(goalId: string) {
  const qc = useQueryClient();
  const biz = useBiz();
  return () => {
    qc.invalidateQueries({ queryKey: ["workspace", biz, "goal", goalId] });
    qc.invalidateQueries({ queryKey: ["workspace", biz, "goals"] });
  };
}

export function useAddMilestone(goalId: string) {
  const invalidate = useGoalInvalidator(goalId);
  return useMutation({
    mutationFn: (input: MilestoneInput) => g.addMilestone(goalId, input),
    onSuccess: invalidate,
  });
}

export function useUpdateMilestone(goalId: string) {
  const invalidate = useGoalInvalidator(goalId);
  return useMutation({
    mutationFn: ({
      milestoneId,
      input,
    }: {
      milestoneId: string;
      input: MilestoneUpdateInput;
    }) => g.updateMilestone(goalId, milestoneId, input),
    onSuccess: invalidate,
  });
}

export function useDeleteMilestone(goalId: string) {
  const invalidate = useGoalInvalidator(goalId);
  return useMutation({
    mutationFn: (milestoneId: string) => g.deleteMilestone(goalId, milestoneId),
    onSuccess: invalidate,
  });
}

// ── Task linking (also refreshes the task board) ─────────────────────────

export function useLinkTask(goalId: string) {
  const qc = useQueryClient();
  const biz = useBiz();
  const invalidate = useGoalInvalidator(goalId);
  return useMutation({
    mutationFn: ({
      taskId,
      milestoneId,
    }: {
      taskId: string;
      milestoneId?: string | null;
    }) => g.linkTask(goalId, taskId, milestoneId),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["workspace", biz, "task-board"] });
    },
  });
}

export function useUnlinkTask(goalId: string) {
  const qc = useQueryClient();
  const biz = useBiz();
  const invalidate = useGoalInvalidator(goalId);
  return useMutation({
    mutationFn: (taskId: string) => g.unlinkTask(goalId, taskId),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["workspace", biz, "task-board"] });
    },
  });
}

// ── Notes ────────────────────────────────────────────────────────────────

export function useNotes(params: g.NoteListParams = {}) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["workspace", biz, "notes", params],
    queryFn: () => g.listNotes(params),
    staleTime: 30_000,
  });
}

export function useCreateNote() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (input: NoteInput) => g.createNote(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspace", biz, "notes"] }),
  });
}

export function useUpdateNote(id: string) {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (input: NoteInput) => g.updateNote(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspace", biz, "notes"] }),
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (id: string) => g.deleteNote(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspace", biz, "notes"] }),
  });
}
