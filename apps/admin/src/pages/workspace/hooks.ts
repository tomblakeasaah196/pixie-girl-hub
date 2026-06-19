import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBusinessStore } from "@/stores/business";
import * as ws from "./api";
import type {
  TaskCreateInput,
  TaskUpdateInput,
  EventCreateInput,
  EventUpdateInput,
} from "./types";

function useBiz() {
  return useBusinessStore((s) => s.activeKey);
}

// ── Task queries ─────────────────────────────────────────────────────────

export function useTaskBoard() {
  const biz = useBiz();
  return useQuery({
    queryKey: ["workspace", biz, "task-board"],
    queryFn: ws.getTaskBoard,
    staleTime: 30_000,
  });
}

export function useTasks(params: ws.TaskListParams = {}) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["workspace", biz, "tasks", params],
    queryFn: () => ws.listTasks(params),
    staleTime: 30_000,
  });
}

export function useTask(id: string | null) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["workspace", biz, "task", id],
    queryFn: () => ws.getTask(id!),
    enabled: !!id,
  });
}

// ── Task mutations ───────────────────────────────────────────────────────

export function useCreateTask() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (input: TaskCreateInput) => ws.createTask(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace", biz, "task-board"] });
      qc.invalidateQueries({ queryKey: ["workspace", biz, "tasks"] });
    },
  });
}

export function useUpdateTask(id: string) {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (input: TaskUpdateInput) => ws.updateTask(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace", biz, "task-board"] });
      qc.invalidateQueries({ queryKey: ["workspace", biz, "tasks"] });
      qc.invalidateQueries({ queryKey: ["workspace", biz, "task", id] });
    },
  });
}

export function useMoveTask() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      ws.moveTask(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace", biz, "task-board"] });
      qc.invalidateQueries({ queryKey: ["workspace", biz, "tasks"] });
    },
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (id: string) => ws.deleteTask(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace", biz, "task-board"] });
      qc.invalidateQueries({ queryKey: ["workspace", biz, "tasks"] });
    },
  });
}

// ── Subtask mutations ────────────────────────────────────────────────────

export function useAddSubtask(taskId: string) {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (title: string) => ws.addSubtask(taskId, title),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace", biz, "task", taskId] });
      qc.invalidateQueries({ queryKey: ["workspace", biz, "task-board"] });
    },
  });
}

export function useToggleSubtask(taskId: string) {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: ({ subtaskId, is_done }: { subtaskId: string; is_done: boolean }) =>
      ws.toggleSubtask(taskId, subtaskId, is_done),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace", biz, "task", taskId] });
      qc.invalidateQueries({ queryKey: ["workspace", biz, "task-board"] });
    },
  });
}

export function useDeleteSubtask(taskId: string) {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (subtaskId: string) => ws.deleteSubtask(taskId, subtaskId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace", biz, "task", taskId] });
      qc.invalidateQueries({ queryKey: ["workspace", biz, "task-board"] });
    },
  });
}

// ── Calendar queries ─────────────────────────────────────────────────────

export function useCalendarEvents(params: ws.EventListParams = {}) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["workspace", biz, "events", params],
    queryFn: () => ws.listCalendarEvents(params),
    staleTime: 60_000,
  });
}

export function useCalendarEvent(id: string | null) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["workspace", biz, "event", id],
    queryFn: () => ws.getCalendarEvent(id!),
    enabled: !!id,
  });
}

// ── Calendar mutations ───────────────────────────────────────────────────

export function useCreateEvent() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (input: EventCreateInput) => ws.createCalendarEvent(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace", biz, "events"] });
    },
  });
}

export function useUpdateEvent(id: string) {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (input: EventUpdateInput) => ws.updateCalendarEvent(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace", biz, "events"] });
      qc.invalidateQueries({ queryKey: ["workspace", biz, "event", id] });
    },
  });
}

export function useDeleteEvent() {
  const qc = useQueryClient();
  const biz = useBiz();
  return useMutation({
    mutationFn: (id: string) => ws.deleteCalendarEvent(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace", biz, "events"] });
    },
  });
}
