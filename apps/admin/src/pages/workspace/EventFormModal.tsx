import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { Field, TextInput, FormSection } from "@/components/ui/Form";
import { Select, Toggle } from "@/components/ui/controls";
import { useCreateEvent, useUpdateEvent } from "./hooks";
import { EVENT_TYPE_OPTIONS } from "./constants";
import type { CalendarEvent, EventCreateInput } from "./types";

interface Props {
  open: boolean;
  onClose: () => void;
  event?: CalendarEvent | null;
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

/** Build a default end time one hour after the start. */
function defaultEnd(startLocal: string): string {
  if (!startLocal) return "";
  const d = new Date(startLocal);
  if (isNaN(d.getTime())) return "";
  d.setHours(d.getHours() + 1);
  return toDatetimeLocal(d.toISOString());
}

export function EventFormModal({ open, onClose, event, defaultDate }: Props) {
  const isEdit = !!event;

  // ── Form state ──────────────────────────────────────────────────────────
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState("meeting");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState("");

  // Reset form state when modal opens or event changes
  useEffect(() => {
    if (!open) return;
    if (event) {
      setTitle(event.title);
      setEventType(event.event_type);
      setStartAt(toDatetimeLocal(event.start_at));
      setEndAt(toDatetimeLocal(event.end_at));
      setAllDay(event.all_day);
      setLocation(event.location ?? "");
      setDescription(event.description ?? "");
      setIsPrivate(event.is_private ?? false);
    } else {
      setTitle("");
      setEventType("meeting");
      const start = defaultDate ? toDatetimeLocal(defaultDate) : "";
      setStartAt(start);
      setEndAt(defaultEnd(start));
      setAllDay(false);
      setLocation("");
      setDescription("");
      setIsPrivate(false);
    }
    setError("");
  }, [open, event, defaultDate]);

  // ── Mutations ───────────────────────────────────────────────────────────
  const createMut = useCreateEvent();
  const updateMut = useUpdateEvent(event?.event_id ?? "");
  const busy = createMut.isPending || updateMut.isPending;

  // ── Submit ──────────────────────────────────────────────────────────────
  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError("");

    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (!startAt) {
      setError("Start date/time is required.");
      return;
    }
    if (!endAt) {
      setError("End date/time is required.");
      return;
    }
    if (new Date(endAt) <= new Date(startAt)) {
      setError("End must be after start.");
      return;
    }

    const payload: EventCreateInput = {
      title: title.trim(),
      event_type: eventType,
      start_at: new Date(startAt).toISOString(),
      end_at: new Date(endAt).toISOString(),
      all_day: allDay,
      ...(location.trim() ? { location: location.trim() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      is_private: isPrivate,
    };

    try {
      if (isEdit) {
        await updateMut.mutateAsync(payload);
      } else {
        await createMut.mutateAsync(payload);
      }
      onClose();
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit Event" : "New Event"}
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
            {busy ? "Saving..." : isEdit ? "Save Changes" : "Create Event"}
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
              placeholder="Event title"
              required
              autoFocus
            />
          </Field>
        </FormSection>

        {/* Type + Location */}
        <FormSection>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Event Type">
              <Select
                value={eventType}
                onChange={setEventType}
                options={EVENT_TYPE_OPTIONS}
              />
            </Field>
            <Field label="Location">
              <TextInput
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Office, Zoom link, etc."
              />
            </Field>
          </div>
        </FormSection>

        {/* Start + End */}
        <FormSection>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Start *">
              <TextInput
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                required
              />
            </Field>
            <Field label="End *">
              <TextInput
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
                required
              />
            </Field>
          </div>
        </FormSection>

        {/* All Day + Private toggles */}
        <FormSection>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Toggle checked={allDay} onChange={setAllDay} label="All day" />
            <Toggle
              checked={isPrivate}
              onChange={setIsPrivate}
              label="Private (visible only to you)"
            />
          </div>
        </FormSection>

        {/* Description */}
        <FormSection>
          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add details, agenda, notes..."
              rows={3}
              className="w-full px-[13px] py-[10px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none transition-colors focus:border-accent/50 resize-y min-h-[80px]"
            />
          </Field>
        </FormSection>
      </form>
    </Modal>
  );
}
