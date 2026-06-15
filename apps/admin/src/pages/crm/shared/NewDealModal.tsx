import { useState } from "react";
import { Loader2, ChevronDown } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { Field, TextInput, FormSection } from "@/components/ui/Form";
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

interface Props {
  contactId: string;
  contactName: string;
  onClose: () => void;
  onCreated?: (dealId: string) => void;
}

export function NewDealModal({ contactId, contactName, onClose, onCreated }: Props) {
  const { data: pipelines = [] } = usePipelines();
  const defaultPipeline = pipelines.find((p) => p.is_default) ?? pipelines[0];
  const [pipelineId, setPipelineId] = useState(defaultPipeline?.pipeline_id ?? "");
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
      title={`New Deal · ${contactName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!title.trim() || !pipelineId || createDeal.isPending}
            icon={createDeal.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : undefined}
          >
            Create deal
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
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
            <div className="relative">
              <select
                value={pipelineId}
                onChange={(e) => setPipelineId(e.target.value)}
                className="w-full h-[42px] px-3 pr-8 rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary appearance-none focus:outline-none focus:border-accent/50 transition-colors"
              >
                {pipelines.map((p) => (
                  <option key={p.pipeline_id} value={p.pipeline_id}>
                    {p.display_name}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none" />
            </div>
          </Field>
        </FormSection>

        <FormSection title="Value & timing">
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
        </FormSection>

        <FormSection title="Source">
          <Field label="Channel">
            <div className="relative">
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as DealChannel)}
                className="w-full h-[42px] px-3 pr-8 rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary appearance-none focus:outline-none focus:border-accent/50 transition-colors"
              >
                <option value="">— select channel —</option>
                {DEAL_CHANNELS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none" />
            </div>
          </Field>
        </FormSection>

        {createDeal.isError && (
          <p className="text-[12px] text-danger text-center">
            Failed to create deal. Please try again.
          </p>
        )}
      </div>
    </Modal>
  );
}
