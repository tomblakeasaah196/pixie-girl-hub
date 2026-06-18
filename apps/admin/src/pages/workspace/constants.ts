import type { Tone } from "@/components/ui/primitives";
import type { TaskStatus, TaskPriority } from "./types";

// ── Task status metadata ────────────────────────────────────────────────

export const TASK_STATUS_META: Record<
  TaskStatus,
  { label: string; tone: Tone }
> = {
  to_do: { label: "To Do", tone: "neutral" },
  in_progress: { label: "In Progress", tone: "info" },
  in_review: { label: "In Review", tone: "warn" },
  done: { label: "Done", tone: "success" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

export const TASK_STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "to_do", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "in_review", label: "In Review" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
];

/** Columns shown in the kanban board (excludes cancelled). */
export const BOARD_COLUMNS: TaskStatus[] = [
  "to_do",
  "in_progress",
  "in_review",
  "done",
];

// ── Task priority metadata ──────────────────────────────────────────────

export const TASK_PRIORITY_META: Record<
  TaskPriority,
  { label: string; tone: Tone }
> = {
  low: { label: "Low", tone: "neutral" },
  normal: { label: "Normal", tone: "info" },
  high: { label: "High", tone: "warn" },
  urgent: { label: "Urgent", tone: "danger" },
};

export const TASK_PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

// ── Calendar event type metadata ────────────────────────────────────────

export const EVENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "meeting", label: "Meeting" },
  { value: "call", label: "Call" },
  { value: "appointment", label: "Appointment" },
  { value: "deadline", label: "Deadline" },
  { value: "reminder", label: "Reminder" },
  { value: "personal", label: "Personal" },
  { value: "other", label: "Other" },
];

export const EVENT_TYPE_COLOURS: Record<string, string> = {
  meeting: "bg-info/20 text-info",
  call: "bg-success/20 text-success",
  appointment: "bg-accent/20 text-accent-glow",
  deadline: "bg-danger/20 text-danger",
  reminder: "bg-warn/20 text-warn",
  personal: "bg-text-primary/10 text-text-muted",
  other: "bg-text-primary/10 text-text-muted",
};

// ── Reminder options ────────────────────────────────────────────────────

export const REMINDER_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "No reminder" },
  { value: "0", label: "At time of event" },
  { value: "15", label: "15 minutes before" },
  { value: "60", label: "1 hour before" },
  { value: "1440", label: "1 day before" },
];

// ── Calendar helpers ────────────────────────────────────────────────────

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Build the 6-row calendar grid for a given month. Each cell is a Date. */
export function buildMonthGrid(year: number, month: number): Date[][] {
  const first = new Date(year, month, 1);
  const startDay = first.getDay(); // 0=Sun
  const start = new Date(year, month, 1 - startDay);
  const rows: Date[][] = [];
  const cursor = new Date(start);
  for (let r = 0; r < 6; r++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    rows.push(week);
  }
  return rows;
}

/** Build the 7-day week grid for a given date. */
export function buildWeekDays(date: Date): Date[] {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day); // go to Sunday
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

/** Check if two dates are the same calendar day. */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Format time as HH:mm. */
export function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Format a date as readable string. */
export function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Returns hours array for time grids. */
export function getHours(): number[] {
  return Array.from({ length: 24 }, (_, i) => i);
}

/** Format hour for display. */
export function formatHour(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return "12 PM";
  return `${hour - 12} PM`;
}

/** Get greeting based on hour. */
export function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** Check if a date is today. */
export function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

/** Check if a date is in the past (before today). */
export function isPast(dateStr: string): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  return d < now;
}

/** ISO date string for a Date (YYYY-MM-DD). */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
