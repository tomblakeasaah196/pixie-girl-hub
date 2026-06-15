import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { Field, TextInput, FormSection } from "@/components/ui/Form";
import { ActivityIcon, activityLabel } from "../shared/ActivityIcon";
import { useAddDealActivity, useDraftActivity } from "../hooks";
import type { ActivityType, ActivityOutcome } from "@/pages/contacts/types";

const ACTIVITY_TYPES: ActivityType[] = [
  "call", "whatsapp_msg", "sms", "instagram_dm",
  "email", "meeting", "walk_in_visit", "website_chat",
  "quote_sent", "payment_received", "follow_up_scheduled", "task_created",
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

const PHONE_TYPES: ActivityType[] = ["call", "sms", "whatsapp_msg", "instagram_dm"];

interface Props {
  dealId: string;
  contactId?: string;
  onClose: () => void;
}

export function LogActivityModal({ dealId, contactId, onClose }: Props) {
  const [activityType, setActivityType] = useState<ActivityType>("call");
  const [direction, setDirection] = useState<"inbound" | "outbound">("outbound");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [outcome, setOutcome] = useState<ActivityOutcome | "">("");
  const [durationMins, setDurationMins] = useState("");
  const [performedAt, setPerformedAt] = useState(
    new Date().toISOString().slice(0, 16),
  );
  const [scheduledAt, setScheduledAt] = useState("");

  const addActivity = useAddDealActivity(dealId);
  const draftAi = useDraftActivity();
  const [aiDrafted, setAiDrafted] = useState(false);

  const isPhone = PHONE_TYPES.includes(activityType);
  const isScheduled = activityType === "follow_up_scheduled" || activityType === "task_created";

  const handleDraftAi = () => {
    draftAi.mutate(
      { deal_id: dealId, contact_id: contactId, activity_type: activityType, direction },
      {
        onSuccess: (draft) => {
          if (draft.subject) setSubject(draft.subject);
          if (draft.body) setBody(draft.body);
          setAiDrafted(true);
        },
      },
    );
  };

  const handleSubmit = () => {
    addActivity.mutate(
      {
        activity_type: activityType,
        direction,
        subject: subject.trim() || undefined,
        body: body.trim() || undefined,
        outcome: (outcome as ActivityOutcome) || undefined,
        performed_at: performedAt || undefined,
        duration_minutes: durationMins ? parseInt(durationMins) : undefined,
        scheduled_at: isScheduled && scheduledAt ? scheduledAt : undefined,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Log Activity"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={addActivity.isPending}
            icon={addActivity.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : undefined}
          >
            Log
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Activity type grid */}
        <FormSection title="Activity type">
          <div className="grid grid-cols-4 gap-1.5">
            {ACTIVITY_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setActivityType(type)}
                className={[
                  "flex flex-col items-center gap-1 p-2 rounded-[10px] border text-[10.5px] font-semibold transition-all",
                  activityType === type
                    ? "border-accent/40 bg-accent/[0.08] text-accent"
                    : "border-line bg-text-primary/[0.02] text-text-muted hover:bg-text-primary/[0.06]",
                ].join(" ")}
              >
                <ActivityIcon type={type} size="sm" />
                <span className="text-center leading-tight">{activityLabel(type)}</span>
              </button>
            ))}
          </div>
        </FormSection>

        {/* Direction */}
        {activityType !== "system_note" && activityType !== "task_created" && (
          <FormSection title="Direction">
            <div className="flex gap-1 p-0.5 rounded-[9px] bg-text-primary/[0.04] border hairline w-fit">
              {(["outbound", "inbound"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDirection(d)}
                  className={[
                    "px-3 h-[28px] rounded-[8px] text-[11.5px] font-semibold capitalize transition-all",
                    direction === d
                      ? "bg-accent-deep text-[#F4E9D9]"
                      : "text-text-muted hover:text-text-primary",
                  ].join(" ")}
                >
                  {d}
                </button>
              ))}
            </div>
          </FormSection>
        )}

        {/* Body with AI draft */}
        <FormSection title="Notes">
          <Field label="Subject">
            <TextInput
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Optional subject line"
            />
          </Field>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10.5px] uppercase tracking-[0.1em] font-bold text-text-muted">
                Notes
              </span>
              <button
                type="button"
                onClick={handleDraftAi}
                disabled={draftAi.isPending}
                className="flex items-center gap-1 text-[10.5px] text-accent hover:text-accent-glow transition-colors"
              >
                {draftAi.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Sparkles className="w-3 h-3" />
                )}
                {aiDrafted ? "Re-draft with AI" : "Draft with Praxis AI"}
              </button>
            </div>
            <textarea
              value={body}
              onChange={(e) => { setBody(e.target.value); setAiDrafted(false); }}
              placeholder={`Notes about this ${activityLabel(activityType).toLowerCase()}…`}
              rows={4}
              className={[
                "w-full px-3 py-2 rounded-[11px] border text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none transition-colors resize-none",
                aiDrafted
                  ? "bg-accent/[0.05] border-accent/30 focus:border-accent/50"
                  : "bg-text-primary/[0.04] border-line focus:border-accent/40",
              ].join(" ")}
            />
            {aiDrafted && (
              <p className="text-[10.5px] text-accent/70 mt-1 flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> Drafted by Praxis — edit freely
              </p>
            )}
          </div>
        </FormSection>

        {/* Outcome (phone types) */}
        {isPhone && (
          <FormSection title="Outcome">
            <div className="relative">
              <select
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as ActivityOutcome)}
                className="w-full h-[42px] px-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary appearance-none focus:outline-none focus:border-accent/40 transition-colors"
              >
                <option value="">— select outcome —</option>
                {OUTCOMES.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </FormSection>
        )}

        {/* Duration (phone) */}
        {isPhone && (
          <FormSection title="Duration">
            <Field label="Duration (minutes)">
              <TextInput
                type="number"
                value={durationMins}
                onChange={(e) => setDurationMins(e.target.value)}
                placeholder="0"
              />
            </Field>
          </FormSection>
        )}

        {/* Scheduled at (for follow-up/task) */}
        {isScheduled && (
          <FormSection title="Schedule">
            <Field label="Scheduled for">
              <TextInput
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </Field>
          </FormSection>
        )}

        {/* Performed at */}
        <FormSection title="When">
          <Field label="Activity time">
            <TextInput
              type="datetime-local"
              value={performedAt}
              onChange={(e) => setPerformedAt(e.target.value)}
            />
          </Field>
        </FormSection>

        {addActivity.isError && (
          <p className="text-[12px] text-danger text-center">Failed to log activity. Try again.</p>
        )}
        {draftAi.isError && (
          <p className="text-[12px] text-warn text-center">AI draft failed — type your notes manually.</p>
        )}
      </div>
    </Modal>
  );
}
