import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { Field, TextInput } from "@/components/ui/Form";
import { ActivityIcon, activityLabel } from "../shared/ActivityIcon";
import { useLogContactActivity } from "../hooks";
import { toastReport } from "@/lib/error-report";
import { toast } from "@/stores/toast";
import type { ActivityType, ActivityOutcome } from "@/pages/contacts/types";

const ACTIVITY_TYPES: ActivityType[] = [
  "call",
  "whatsapp_msg",
  "sms",
  "instagram_dm",
  "email",
  "meeting",
  "walk_in_visit",
  "website_chat",
];

const OUTCOMES: { value: ActivityOutcome; label: string }[] = [
  { value: "connected", label: "Connected" },
  { value: "no_answer", label: "No answer" },
  { value: "left_voicemail", label: "Left voicemail" },
  { value: "interested", label: "Interested" },
  { value: "not_interested", label: "Not interested" },
  { value: "reschedule_requested", label: "Reschedule requested" },
  { value: "follow_up_required", label: "Follow-up required" },
  { value: "converted", label: "Converted" },
];

interface Props {
  contactId: string;
  contactName: string;
  onClose: () => void;
}

/** Log a call / WhatsApp / email against the client directly (no deal needed).
 *  The row lands on the contact-360 timeline automatically. */
export function ContactLogActivityModal({
  contactId,
  contactName,
  onClose,
}: Props) {
  const [activityType, setActivityType] = useState<ActivityType>("call");
  const [direction, setDirection] = useState<"inbound" | "outbound">(
    "outbound",
  );
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [outcome, setOutcome] = useState<ActivityOutcome | "">("");
  const [durationMins, setDurationMins] = useState("");
  const log = useLogContactActivity(contactId);

  function submit() {
    log.mutate(
      {
        activity_type: activityType,
        direction,
        subject: subject || undefined,
        body: body || undefined,
        outcome: outcome || undefined,
        duration_minutes: durationMins ? Number(durationMins) : undefined,
      },
      {
        onSuccess: () => {
          toast.success("Activity logged");
          onClose();
        },
        onError: (err) =>
          toastReport("CRM → Client profile", "Log activity", err),
      },
    );
  }

  return (
    <Modal open title={`Log activity — ${contactName}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {/* Type picker */}
        <div>
          <div className="micro mb-2">What happened?</div>
          <div className="grid grid-cols-4 gap-1.5">
            {ACTIVITY_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setActivityType(t)}
                className={[
                  "flex flex-col items-center gap-1 py-2 rounded-[10px] border text-[10px] font-medium transition-all",
                  activityType === t
                    ? "border-accent/50 bg-accent/10 text-text-primary"
                    : "border-line bg-text-primary/[0.02] text-text-muted hover:text-text-primary",
                ].join(" ")}
              >
                <ActivityIcon type={t} size="sm" />
                {activityLabel(t)}
              </button>
            ))}
          </div>
        </div>

        {/* Direction */}
        <div className="flex gap-1 p-0.5 rounded-[10px] bg-text-primary/[0.04] border hairline w-fit">
          {(["outbound", "inbound"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDirection(d)}
              className={[
                "px-3 h-[26px] rounded-[8px] text-[11px] font-semibold capitalize transition-all",
                direction === d
                  ? "bg-accent-deep text-[#F4E9D9]"
                  : "text-text-muted hover:text-text-primary",
              ].join(" ")}
            >
              {d === "outbound" ? "We reached out" : "They reached out"}
            </button>
          ))}
        </div>

        <Field label="Subject">
          <TextInput
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Follow-up on the HD lace order"
          />
        </Field>

        <Field label="Notes">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="What was said, what they want, next step…"
            className="w-full px-3 py-2 rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-accent/40 transition-colors resize-none"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Outcome">
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as ActivityOutcome)}
              className="w-full h-[38px] px-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary focus:outline-none focus:border-accent/40 transition-colors"
            >
              <option value="">—</option>
              {OUTCOMES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Duration (mins)">
            <TextInput
              type="number"
              min={0}
              value={durationMins}
              onChange={(e) => setDurationMins(e.target.value)}
              placeholder="e.g. 10"
            />
          </Field>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={log.isPending}
            icon={
              log.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : undefined
            }
            onClick={submit}
          >
            Log activity
          </Button>
        </div>
      </div>
    </Modal>
  );
}
