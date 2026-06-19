import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { Field, TextInput, FormSection, FormGrid } from "@/components/ui/Form";
import { Select } from "@/components/ui/controls";
import { usePipelines, usePipelineStages, useCreateDeal } from "../hooks";
import type { DealCreateInput, DealChannel } from "@/pages/contacts/types";

const DEAL_CHANNELS: { value: DealChannel; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "website", label: "Website" },
  { value: "walk_in", label: "Walk-in" },
  { value: "referral", label: "Referral" },
  { value: "campaign", label: "Campaign" },
  { value: "google_ads", label: "Google Ads" },
  { value: "meta_ads", label: "Meta Ads" },
  { value: "storefront", label: "Storefront" },
  { value: "pos", label: "POS" },
  { value: "event", label: "Event" },
  { value: "other", label: "Other" },
];

const CHANNEL_OPTS: { value: DealChannel | ""; label: string }[] = [
  { value: "", label: "— select channel —" },
  ...DEAL_CHANNELS,
];

interface Props {
  contactId: string;
  contactName: string;
  onClose: () => void;
  onCreated?: (dealId: string) => void;
}

export function NewDealModal({
  contactId,
  contactName,
  onClose,
  onCreated,
}: Props) {
  const { data: pipelines = [] } = usePipelines();
  const defaultPipeline = pipelines.find((p) => p.is_default) ?? pipelines[0];
  const [pipelineId, setPipelineId] = useState(
    defaultPipeline?.pipeline_id ?? "",
  );
  const { data: _stages = [] } = usePipelineStages(pipelineId || null);

  const [title, setTitle] = useState(`${contactName} — Deal`);
  const [description, setDescription] = useState("");
  const [value, setValue] = useState("");
  const [channel, setChannel] = useState<DealChannel | "">("");
  const [closeDate, setCloseDate] = useState("");

  const createDeal = useCreateDeal();

  const handleSubmit = () => {
    if (!title.trim() || !pipelineId) return;
    const input: DealCreateInput = {
      contact_id: contactId,
      pipeline_id: pipelineId,
      title: title.trim(),
      description: description.trim() || undefined,
      expected_value_ngn: value ? parseFloat(value) : undefined,
      expected_close_date: closeDate || undefined,
      source_channel: (channel as DealChannel) || undefined,
    };

    createDeal.mutate(input, {
      onSuccess: (deal) => {
        onCreated?.(deal.deal_id);
        onClose();
      },
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`New Deal · ${contactName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!title.trim() || !pipelineId || createDeal.isPending}
            icon={
              createDeal.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : undefined
            }
          >
            Create deal
          </Button>
        </>
      }
    >
      {/* On desktop the sections flow into two columns; on phone they stack in
          the original source order (single column) — mobile is unchanged. */}
      <div className="lg:grid lg:grid-cols-2 lg:gap-x-8 lg:items-start">
        <div>
          <FormSection title="Deal info">
            <Field label="Deal title">
              <TextInput
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Custom wig order — June"
              />
            </Field>
            <Field label="Description">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional notes about this deal…"
                rows={2}
                className="w-full px-3 py-2 rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-accent/50 transition-colors resize-none"
              />
            </Field>
          </FormSection>

          <FormSection title="Pipeline">
            <Field label="Pipeline">
              <Select
                value={pipelineId}
                onChange={setPipelineId}
                options={pipelines.map((p) => ({
                  value: p.pipeline_id,
                  label: p.display_name,
                }))}
              />
            </Field>
          </FormSection>
        </div>

        <div>
          <FormSection title="Value & timing">
            <FormGrid cols={2}>
              <Field label="Expected value (NGN)">
                <TextInput
                  type="number"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="0"
                />
              </Field>
              <Field label="Expected close date">
                <TextInput
                  type="date"
                  value={closeDate}
                  onChange={(e) => setCloseDate(e.target.value)}
                />
              </Field>
            </FormGrid>
          </FormSection>

          <FormSection title="Source">
            <Field label="Channel">
              <Select
                value={channel}
                onChange={(v) => setChannel(v as DealChannel | "")}
                options={CHANNEL_OPTS}
              />
            </Field>
          </FormSection>

          {createDeal.isError && (
            <p className="text-[12px] text-danger text-center">
              Failed to create deal. Please try again.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
