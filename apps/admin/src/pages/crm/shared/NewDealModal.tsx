import { useState } from "react";
import { Loader2, Search, Check } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { Field, TextInput, FormSection, FormGrid } from "@/components/ui/Form";
import { Select } from "@/components/ui/controls";
import {
  usePipelines,
  usePipelineStages,
  useCreateDeal,
  useContacts,
} from "../hooks";
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
  /** Preset contact. When empty, the modal shows a contact picker first. */
  contactId?: string;
  contactName?: string;
  onClose: () => void;
  onCreated?: (dealId: string) => void;
}

export function NewDealModal({
  contactId,
  contactName,
  onClose,
  onCreated,
}: Props) {
  // When opened from a contact we already have one. When opened from the
  // pipeline "New deal" button there's no context, so let the user pick.
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(
    contactId ? { id: contactId, name: contactName ?? "Contact" } : null,
  );

  const { data: pipelines = [] } = usePipelines();
  const defaultPipeline = pipelines.find((p) => p.is_default) ?? pipelines[0];
  const [pipelineId, setPipelineId] = useState(
    defaultPipeline?.pipeline_id ?? "",
  );
  const { data: _stages = [] } = usePipelineStages(pipelineId || null);

  const [title, setTitle] = useState(
    contactName ? `${contactName} — Deal` : "",
  );
  const [description, setDescription] = useState("");
  const [value, setValue] = useState("");
  const [channel, setChannel] = useState<DealChannel | "">("");
  const [closeDate, setCloseDate] = useState("");

  const createDeal = useCreateDeal();

  const pickContact = (c: { contact_id: string; display_name: string }) => {
    setPicked({ id: c.contact_id, name: c.display_name });
    setTitle((t) => t.trim() || `${c.display_name} — Deal`);
  };

  const handleSubmit = () => {
    if (!picked || !title.trim() || !pipelineId) return;
    const input: DealCreateInput = {
      contact_id: picked.id,
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
      title={picked ? `New Deal · ${picked.name}` : "New Deal"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={
              !picked || !title.trim() || !pipelineId || createDeal.isPending
            }
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
      {!picked ? (
        <ContactPicker onPick={pickContact} />
      ) : (
        <>
          {!contactId && (
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="mb-3 text-[12px] text-accent hover:underline"
            >
              ← Choose a different contact
            </button>
          )}
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
        </>
      )}
    </Modal>
  );
}

/** Inline contact search + pick, shown when the modal has no contact context. */
function ContactPicker({
  onPick,
}: {
  onPick: (c: { contact_id: string; display_name: string }) => void;
}) {
  const [search, setSearch] = useState("");
  const { data, isFetching } = useContacts({
    q: search.trim() || undefined,
    page_size: 8,
  });
  const contacts = data?.data ?? [];

  return (
    <div>
      <Field label="Contact">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none" />
          <TextInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone or email…"
            className="pl-9"
            autoFocus
          />
        </div>
      </Field>

      <div className="mt-2 max-h-[280px] overflow-y-auto rounded-[11px] border border-line divide-y divide-line">
        {isFetching && contacts.length === 0 && (
          <div className="flex items-center justify-center py-6 text-text-faint">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        )}
        {!isFetching && contacts.length === 0 && (
          <div className="py-6 text-center text-[12px] text-text-faint">
            No contacts found.
          </div>
        )}
        {contacts.map((c) => (
          <button
            key={c.contact_id}
            type="button"
            onClick={() => onPick(c)}
            className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-text-primary/[0.04] transition-colors group"
          >
            <div className="min-w-0">
              <div className="text-[13px] text-text-primary truncate">
                {c.display_name}
              </div>
              <div className="text-[11px] text-text-faint truncate">
                {c.primary_phone || c.email || "—"}
              </div>
            </div>
            <Check className="w-3.5 h-3.5 text-accent opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}
