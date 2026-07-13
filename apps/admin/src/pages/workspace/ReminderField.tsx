/**
 * Reminder picker shared by the task and event modals (V2.2 §6.18/§6.19).
 *
 * Presets: at time / 15 min / 1 hour / 1 day / 2 days / 1 week before, plus a
 * fully custom date & time. Day-level presets take a wall-clock time ("1 day
 * before at 09:00") and the date is filled in automatically from the task's
 * due date or the event's start — shown as a live hint so there's no surprise.
 *
 * Payload rules (mirror the backend):
 *   - minute presets send reminder_minutes; the server derives remind_at and
 *     re-derives it whenever the anchor datetime moves.
 *   - day presets send reminder_minutes AND the computed remind_at (the exact
 *     instant, honouring the chosen wall-clock time).
 *   - custom sends remind_at only.
 */

import { Field, TextInput } from "@/components/ui/Form";
import { Select } from "@/components/ui/controls";
import { formatDateTime } from "@/lib/format";

export type ReminderPreset =
  | ""
  | "0"
  | "15"
  | "60"
  | "1440"
  | "2880"
  | "10080"
  | "custom";

export interface ReminderState {
  preset: ReminderPreset;
  /** "HH:MM" — only meaningful for day-level presets. */
  time: string;
  /** datetime-local string — only meaningful for the custom preset. */
  customAt: string;
}

export const EMPTY_REMINDER: ReminderState = {
  preset: "",
  time: "09:00",
  customAt: "",
};

const DAY_PRESETS = new Set<ReminderPreset>(["1440", "2880", "10080"]);

/** Convert an ISO date string to the `datetime-local` input format. */
function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toTimeLocal(iso: string | null | undefined): string {
  const local = toDatetimeLocal(iso);
  return local ? local.slice(11, 16) : "09:00";
}

/** Rebuild the picker state from a saved task/event. */
export function reminderStateFrom(rec: {
  reminder_minutes?: number | null;
  remind_at?: string | null;
}): ReminderState {
  const mins = rec.reminder_minutes;
  if (mins != null) {
    const preset = String(mins) as ReminderPreset;
    if (DAY_PRESETS.has(preset)) {
      return { ...EMPTY_REMINDER, preset, time: toTimeLocal(rec.remind_at) };
    }
    if (["0", "15", "60"].includes(preset)) {
      return { ...EMPTY_REMINDER, preset };
    }
  }
  if (rec.remind_at) {
    return {
      ...EMPTY_REMINDER,
      preset: "custom",
      customAt: toDatetimeLocal(rec.remind_at),
    };
  }
  return EMPTY_REMINDER;
}

/** The exact reminder instant for a day-level preset, or null when unknowable. */
function dayPresetInstant(
  anchorLocal: string,
  minutes: number,
  time: string,
): Date | null {
  if (!anchorLocal) return null;
  const anchor = new Date(anchorLocal);
  if (isNaN(anchor.getTime())) return null;
  const d = new Date(anchor);
  d.setDate(d.getDate() - Math.round(minutes / 1440));
  const [hh, mm] = time.split(":").map(Number);
  d.setHours(hh || 0, mm || 0, 0, 0);
  return d;
}

/**
 * The reminder fields to merge into the create/update payload.
 * `anchorLocal` is the datetime-local value of the due date (tasks) or start
 * (events). Relative presets without an anchor degrade to "no reminder".
 */
export function reminderPayload(
  state: ReminderState,
  anchorLocal: string,
): { reminder_minutes: number | null; remind_at?: string | null } {
  if (state.preset === "custom") {
    const d = state.customAt ? new Date(state.customAt) : null;
    return d && !isNaN(d.getTime())
      ? { reminder_minutes: null, remind_at: d.toISOString() }
      : { reminder_minutes: null, remind_at: null };
  }
  if (state.preset === "") return { reminder_minutes: null, remind_at: null };
  const minutes = Number(state.preset);
  if (!anchorLocal) return { reminder_minutes: null, remind_at: null };
  if (DAY_PRESETS.has(state.preset)) {
    const d = dayPresetInstant(anchorLocal, minutes, state.time);
    return d
      ? { reminder_minutes: minutes, remind_at: d.toISOString() }
      : { reminder_minutes: minutes };
  }
  // Sub-day presets: the server derives remind_at from the anchor and keeps
  // it in sync when the anchor later moves.
  return { reminder_minutes: minutes };
}

function fmtInstant(d: Date): string {
  return formatDateTime(d);
}

export function ReminderField({
  value,
  onChange,
  anchorLocal,
  anchorLabel,
}: {
  value: ReminderState;
  onChange: (s: ReminderState) => void;
  /** datetime-local value of the due date / start time the presets hang off. */
  anchorLocal: string;
  /** "due date" (tasks) or "start time" (events) — used in labels/hints. */
  anchorLabel: string;
}) {
  const options: { value: ReminderPreset; label: string }[] = [
    { value: "", label: "No reminder" },
    { value: "0", label: `At the ${anchorLabel}` },
    { value: "15", label: "15 minutes before" },
    { value: "60", label: "1 hour before" },
    { value: "1440", label: "1 day before" },
    { value: "2880", label: "2 days before" },
    { value: "10080", label: "1 week before" },
    { value: "custom", label: "Custom date & time" },
  ];

  const isDay = DAY_PRESETS.has(value.preset);
  const isRelative = value.preset !== "" && value.preset !== "custom";
  const missingAnchor = isRelative && !anchorLocal;
  const dayInstant = isDay
    ? dayPresetInstant(anchorLocal, Number(value.preset), value.time)
    : null;

  return (
    <Field label="Reminder">
      <div className="flex flex-col gap-2">
        <Select
          value={value.preset}
          onChange={(preset) => onChange({ ...value, preset })}
          options={options}
          ariaLabel="Reminder"
        />
        {isDay && (
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-text-muted shrink-0">at</span>
            <TextInput
              type="time"
              value={value.time}
              onChange={(e) => onChange({ ...value, time: e.target.value })}
              aria-label="Reminder time"
            />
          </div>
        )}
        {value.preset === "custom" && (
          <TextInput
            type="datetime-local"
            value={value.customAt}
            onChange={(e) => onChange({ ...value, customAt: e.target.value })}
            aria-label="Reminder date and time"
          />
        )}
        {missingAnchor ? (
          <span className="text-[11px] text-warn">
            Set a {anchorLabel} first — relative reminders hang off it.
          </span>
        ) : dayInstant ? (
          <span className="text-[11px] text-text-faint">
            Will remind you {fmtInstant(dayInstant)}
          </span>
        ) : null}
      </div>
    </Field>
  );
}
