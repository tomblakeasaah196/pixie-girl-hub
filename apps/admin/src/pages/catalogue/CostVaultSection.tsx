import { useState } from "react";
import { ShieldCheck, Eye, Save } from "lucide-react";
import { Button, Card, MoneyText } from "@/components/ui/primitives";
import { Field } from "@/components/ui/Form";
import { NumberField } from "@/components/ui/controls";
import {
  useVaultAccess,
  useVariantCost,
  useSetVariantCost,
  type Variant,
} from "@/lib/catalogue";

/**
 * Cost-vault section on a base variant (P0-1). Rendered ONLY when the server
 * confirms the viewer may see cost (owner or a live grant) — non-grantees
 * never even see the section, and the cost field is fetched on demand. The
 * operational wholesale price stays visible elsewhere; THIS is the secret.
 */
export function CostVaultSection({
  productId,
  variant,
}: {
  productId: string;
  variant: Variant;
}) {
  const access = useVaultAccess();
  const [revealed, setRevealed] = useState(false);
  const cost = useVariantCost(productId, variant.variant_id, revealed);
  const setCost = useSetVariantCost(productId);

  const [editing, setEditing] = useState(false);
  const [costNgn, setCostNgn] = useState("");

  // Hidden entirely for non-grantees (canon non-negotiable #2/#3).
  if (access.isLoading || !access.data?.can_see) return null;

  const startEdit = () => {
    setCostNgn(cost.data?.cost_ngn != null ? String(cost.data.cost_ngn) : "");
    setEditing(true);
  };
  const save = () =>
    setCost.mutate(
      {
        variantId: variant.variant_id,
        input: { cost_ngn: costNgn ? Number(costNgn) : undefined },
      },
      { onSuccess: () => setEditing(false) },
    );

  return (
    <Card className="p-4 border-l-[3px] border-l-warn/60">
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck className="w-4 h-4 text-warn" />
        <span className="micro !text-warn">Cost vault · confidential</span>
      </div>

      {!revealed ? (
        <Button
          size="sm"
          icon={<Eye className="w-3.5 h-3.5" />}
          onClick={() => setRevealed(true)}
        >
          Reveal cost
        </Button>
      ) : cost.isLoading ? (
        <div className="text-[12px] text-text-faint">Decrypting…</div>
      ) : editing ? (
        <div className="space-y-3">
          <Field label="True landed cost" hint="NGN · encrypted at rest">
            <NumberField value={costNgn} onChange={setCostNgn} suffix="₦" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Save className="w-3.5 h-3.5" />}
              disabled={setCost.isPending}
              onClick={save}
            >
              {setCost.isPending ? "Saving…" : "Save cost"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[12px] text-text-muted">Landed cost</span>
            {cost.data?.cost_ngn != null ? (
              <MoneyText ngn={cost.data.cost_ngn} className="text-[18px]" />
            ) : (
              <span className="text-[13px] text-text-faint">Not set</span>
            )}
          </div>
          {cost.data?.supplier_code && (
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12px] text-text-muted">Supplier</span>
              <span className="text-[13px] font-mono">
                {cost.data.supplier_code}
              </span>
            </div>
          )}
          <Button size="sm" className="mt-1" onClick={startEdit}>
            Edit cost
          </Button>
        </div>
      )}
    </Card>
  );
}
