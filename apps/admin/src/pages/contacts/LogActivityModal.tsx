import { useState } from "react";
import {
  Phone,
  MessageCircle,
  Mail,
  FileText,
  Users,
  CheckSquare,
  Activity,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { Field, TextInput, FormSection } from "@/components/ui/Form";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useBusinessStore } from "@/stores/business";
import * as contactsApi from "./api";
import type { ActivityType, ActivityOutcome } from "./types";

const ACTIVITY_TYPES: { key: ActivityType; label: string; icon: typeof Phone; color: string }[] = [
  { key: "call", label: "Call", icon: Phone, color: "text-success" },
  { key: "whatsapp_msg", label: "WhatsApp", icon: MessageCircle, color: "text-[#25D366]" },
  { key: "sms", label: "SMS", icon: MessageCircle, color: "text-info" },
  { key: "email", label: "Email", icon: Mail, color: "text-info" },
  { key: "meeting", label: "Meeting", icon: Users, color: "text-accent" },
  { key: "instagram_dm", label: "Instagram", icon: Activity, color: "text-rose" },
  { key: "system_note", label: "Note", icon: FileText, color: "text-text-muted" },
  { key: "follow_up_scheduled", label: "Follow-up", icon: CheckSquare, color: "text-warn" },
];

const OUTCOMES: { key: ActivityOutcome; label: string }[] = [
  { key: "connected", label: "Connected" },
  { key: "no_answer", label: "No answer" },
  { key: "left_voicemail", label: "Left voicemail" },
  { key: "interested", label: "Interested" },
  { key: "not_interested", label: "Not interested" },
  { key: "reschedule_requested", label: "Reschedule requested" },
  { key: "follow_up_required", label: "Follow-up required" },
  { key: "converted", label: "Converted" },
];

const PHONE_TYPES: ActivityType[] = ["call", "sms", "whatsapp_msg"];

/** Logs a CRM activity directly against a contact (no deal required).
 *  The activity_type + contact_id is sent to POST /crm/contacts/{contactId}/activities. */
export function LogActivityModal({
  contactId,
  contactName,
  onClose,
}: {
  contactId: string;
  contactName: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const biz = useBusinessStore((s) => s.activeKey);

  const [activityType, setActivityType] = useState<ActivityType>("call");
  const [direction, setDirection] = useState<"inbound" | "outbound">("outbound");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [outcome, setOutcome] = useState<ActivityOutcome | "">("");
  const [durationMin, setDurationMin] = useState("");
  const [performedAt, setPerformedAt] = useState(
    () => new Date().toISOString().slice(0, 16), // "YYYY-MM-DDTHH:mm"
  );
  const [scheduledAt, setScheduledAt] = useState("");
  const [error, setError] = useState("");

  const logMut = useMutation({
    mutationFn: () =>
      contactsApi.logContactActivity(contactId, {
        activity_type: activityType,
        direction,
        subject: subject.trim() || undefined,
        body: body.trim() || undefined,
        outcome: outcome || undefined,
        performed_at: performedAt,
        duration_minutes: durationMin ? Number(durationMin) : undefined,
        scheduled_at: scheduledAt || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts", biz, "timeline", contactId] });
      onClose();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to log activity.");
    },
  });

  const isPhone = PHONE_TYPES.includes(activityType);
  const isNote = activityType === "system_note";

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-accent" />
          Log Activity · {contactName}
        </span>
      }
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={logMut.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => logMut.mutate()}
            disabled={logMut.isPending}
          >
            {logMut.isPending ? "Logging…" : "Log Activity"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-0">
        {error && (
          <div className="mb-4 px-3 py-2.5 rounded-[10px] bg-danger/[0.1] border border-danger/30 text-[12px] text-danger">
            {error}
          </div>
        )}

        {/* Activity type picker */}
        <FormSection>
          <Field label="Activity type">
            <div className="grid grid-cols-4 gap-2">
              {ACTIVITY_TYPES.map(({ key, label, icon: Icon, color }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActivityType(key)}
                  className={[
                    "flex flex-col items-center gap-1 py-2.5 rounded-[10px] border text-[11px] font-semibold transition-all",
                    activityType === key
                      ? "bg-accent-deep/[0.15] border-accent-deep/50 text-accent-glow"
                      : "bg-text-primary/[0.04] border-line text-text-muted hover:text-text-primary hover:bg-text-primary/[0.08]",
                  ].join(" ")}
                >
                  <Icon
                    className={[
                      "w-4 h-4",
                      activityType === key ? "text-accent" : color,
                    ].join(" ")}
                  />
                  {label}
                </button>
              ))}
            </div>
          </Field>
        </FormSection>

        {/* Direction (for calls/messages) */}
        {!isNote && (
          <FormSection>
            <Field label="Direction">
              <div className="flex gap-2">
                {(["outbound", "inbound"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDirection(d)}
                    className={[
                      "flex-1 py-1.5 rounded-[9px] text-[12px] font-semibold border transition-all capitalize",
                      direction === d
                        ? "bg-accent-deep/[0.15] border-accent-deep/50 text-accent-glow"
                        : "bg-text-primary/[0.04] border-line text-text-muted hover:text-text-primary",
                    ].join(" ")}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </Field>
          </FormSection>
        )}

        {/* Subject / Note content */}
        <FormSection>
          {isNote ? (
            <Field label="Note *">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write your note here…"
                rows={4}
                autoFocus
                className="w-full px-[13px] py-[10px] rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-accent/50 transition-colors resize-none"
              />
            </Field>
          ) : (
            <>
              <Field label="Subject / Summary">
                <TextInput
                  autoFocus
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder={`e.g. ${activityType === "call" ? "Discussed colour options for lace wig" : "Sent catalogue link"}`}
                />
              </Field>
              <Field label="Notes">
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Optional additional details…"
                  rows={2}
                  className="w-full px-[13px] py-[10px] rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-accent/50 transition-colors resize-none"
                />
              </Field>
            </>
          )}
        </FormSection>

        {/* Outcome (calls/meetings) */}
        {isPhone && (
          <FormSection>
            <Field label="Outcome">
              <select
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as ActivityOutcome)}
                className="w-full h-[42px] px-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary focus:outline-none focus:border-accent/50 transition-colors"
              >
                <option value="">— select outcome —</option>
                {OUTCOMES.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </FormSection>
        )}

        {/* Time + duration */}
        <FormSection>
          <div className="grid grid-cols-2 gap-3">
            <Field label="When">
              <TextInput
                type="datetime-local"
                value={performedAt}
                onChange={(e) => setPerformedAt(e.target.value)}
              />
            </Field>
            {isPhone && (
              <Field label="Duration (minutes)">
                <TextInput
                  type="number"
                  min={0}
                  max={999}
                  value={durationMin}
                  onChange={(e) => setDurationMin(e.target.value)}
                  placeholder="e.g. 5"
                />
              </Field>
            )}
          </div>
          {activityType === "follow_up_scheduled" && (
            <Field label="Scheduled for">
              <TextInput
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </Field>
          )}
        </FormSection>
      </div>
    </Modal>
  );
}
