import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { Field } from "@/components/ui/Form";
import { Select } from "@/components/ui/controls";
import {
  useBaseProducts,
  useAiDraftStyled,
  type StyledProduct,
} from "@/lib/catalogue";

/**
 * AI drafts a STYLED listing over a chosen base (P0-8-safe). The result is
 * always a DRAFT for human review — the AI never publishes. Gated server-side
 * by the products_ai_drafting feature; failures surface inline.
 */
export function AiDraftModal({
  open,
  onClose,
  onDrafted,
  presetBaseId,
}: {
  open: boolean;
  onClose: () => void;
  onDrafted: (draft: StyledProduct) => void;
  presetBaseId?: string;
}) {
  const bases = useBaseProducts();
  const draft = useAiDraftStyled();
  const [baseId, setBaseId] = useState(presetBaseId ?? "");
  const [instructions, setInstructions] = useState("");
  const [tone, setTone] = useState("");

  const baseOptions = [
    { value: "", label: "Select a base product…" },
    ...(bases.data ?? []).map((b) => ({
      value: b.product_id,
      label: `${b.name} · ${b.product_code}`,
    })),
  ];

  const submit = () => {
    if (!baseId) return;
    draft.mutate(
      {
        base_product_id: baseId,
        instructions: instructions || undefined,
        tone: tone || undefined,
      },
      {
        onSuccess: (res) => {
          onDrafted(res.draft);
          setInstructions("");
          setTone("");
        },
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent-glow" /> Draft with AI
        </span>
      }
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!baseId || draft.isPending}
            onClick={submit}
            icon={<Sparkles className="w-3.5 h-3.5" />}
          >
            {draft.isPending ? "Drafting…" : "Generate draft"}
          </Button>
        </>
      }
    >
      <p className="text-[12.5px] text-text-muted mb-4 leading-relaxed">
        Pick a base product and the AI will draft a storefront listing — name,
        copy, SEO and a styling add-on price. It's saved as a{" "}
        <span className="text-text-primary font-semibold">
          draft for your review
        </span>
        ; nothing goes live until someone publishes it.
      </p>
      <div className="space-y-4">
        <Field label="Base product">
          <Select value={baseId} onChange={setBaseId} options={baseOptions} />
        </Field>
        <Field label="Styling brief" hint="optional">
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={3}
            placeholder="e.g. A glamorous bardot bob aimed at brides; emphasise the HD lace."
            className="w-full px-[13px] py-2.5 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50 resize-y"
          />
        </Field>
        <Field label="Tone" hint="optional">
          <input
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            placeholder="e.g. luxurious, playful, editorial"
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
          />
        </Field>
        {draft.isError && (
          <p className="text-[12px] text-danger">
            {draft.error instanceof Error
              ? draft.error.message
              : "AI drafting failed. Please try again."}
          </p>
        )}
      </div>
    </Modal>
  );
}
