import { useEffect, useState } from "react";
import { Plus, Tags, Layers3, Save } from "lucide-react";
import { Button, Card } from "@/components/ui/primitives";
import { Toggle, NumberField, ErrorState } from "@/components/ui/controls";
import { Field } from "@/components/ui/Form";
import { useAuthStore } from "@/stores/auth";
import {
  useSizeConfig,
  useSaveSizeConfig,
  type LaceSize,
} from "@/lib/catalogue";

/**
 * Catalogue → Config. Two owner controls that don't belong on a product:
 *   • Categories on/off — one click hides or restores Categories everywhere
 *     (the data is never dropped, so turning it back on is instant).
 *   • The brand-wide lace ladder (4×4 … 360) that powers the styled lace axis;
 *     premium_ngn is the absolute amount added to a styled product's anchor.
 */
export function CatalogueSettingsTab() {
  const { can } = useAuthStore();
  const canEdit = can("catalogue", "edit");
  const cfg = useSizeConfig();
  const save = useSaveSizeConfig();

  if (cfg.isError) return <ErrorState onRetry={() => cfg.refetch()} />;

  const categoriesOn = cfg.data?.config?.categories_enabled ?? false;

  return (
    <div className="space-y-5">
      {/* Categories toggle */}
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="grid place-items-center w-10 h-10 rounded-[11px] bg-accent/10 text-accent-glow shrink-0">
            <Tags className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[15px] font-semibold">Categories</h3>
            <p className="text-[12.5px] text-text-muted mt-0.5">
              {categoriesOn
                ? "Categories are ON — the Categories tab and category fields show across products."
                : "Categories are OFF. Turn this on to bring the Categories tab and all category fields back — nothing was deleted, so your previous categorisation returns instantly."}
            </p>
          </div>
          <Toggle
            checked={categoriesOn}
            disabled={!canEdit || save.isPending || cfg.isLoading}
            onChange={(v) => save.mutate({ categories_enabled: v })}
            label={categoriesOn ? "On" : "Off"}
          />
        </div>
      </Card>

      {/* Lace ladder */}
      <LaceLadderCard
        laceSizes={cfg.data?.lace_sizes ?? []}
        loading={cfg.isLoading}
        canEdit={canEdit}
      />
    </div>
  );
}

type LaceRow = Pick<
  LaceSize,
  "lace_code" | "label" | "premium_ngn" | "description" | "is_active"
> & { display_order?: number };

function LaceLadderCard({
  laceSizes,
  loading,
  canEdit,
}: {
  laceSizes: LaceSize[];
  loading: boolean;
  canEdit: boolean;
}) {
  const save = useSaveSizeConfig();
  const [rows, setRows] = useState<LaceRow[]>([]);

  // Seed the editable rows from the server whenever the config (re)loads.
  useEffect(() => {
    setRows(
      laceSizes.map((l) => ({
        lace_code: l.lace_code,
        label: l.label,
        premium_ngn: l.premium_ngn,
        description: l.description,
        is_active: l.is_active,
        display_order: l.display_order,
      })),
    );
  }, [laceSizes]);

  const patch = (i: number, p: Partial<LaceRow>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...p } : r)));

  const addRow = () =>
    setRows((prev) => [
      ...prev,
      {
        lace_code: "",
        label: "",
        premium_ngn: 0,
        description: null,
        is_active: true,
        display_order: prev.length + 1,
      },
    ]);

  const submit = () => {
    const clean = rows
      .map((r) => ({ ...r, lace_code: r.lace_code.trim().toUpperCase() }))
      .filter((r) => r.lace_code && r.label.trim());
    save.mutate({ lace_sizes: clean });
  };

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-1">
        <Layers3 className="w-4 h-4 text-accent-glow" />
        <h3 className="text-[15px] font-semibold">Lace ladder</h3>
      </div>
      <p className="text-[12.5px] text-text-muted mb-4">
        The lace constructions a styled product can sell. The premium is added
        to the styled anchor price for that construction.
      </p>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-12 rounded-[11px] bg-text-primary/[0.05] animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r, i) => (
            <div
              key={i}
              className="grid grid-cols-[88px_1fr_140px_auto] gap-2.5 items-end"
            >
              <Field label="Code">
                <input
                  value={r.lace_code}
                  disabled={!canEdit}
                  onChange={(e) => patch(i, { lace_code: e.target.value })}
                  placeholder="13X4"
                  className="w-full h-[40px] px-[11px] rounded-[10px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] uppercase outline-none focus:border-accent/50"
                />
              </Field>
              <Field label="Label">
                <input
                  value={r.label}
                  disabled={!canEdit}
                  onChange={(e) => patch(i, { label: e.target.value })}
                  placeholder="13×4 Frontal"
                  className="w-full h-[40px] px-[11px] rounded-[10px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
                />
              </Field>
              <Field label="Premium">
                <NumberField
                  value={String(r.premium_ngn ?? 0)}
                  onChange={(v) => patch(i, { premium_ngn: Number(v) || 0 })}
                  suffix="₦"
                />
              </Field>
              <div className="pb-1.5">
                <Toggle
                  checked={r.is_active}
                  disabled={!canEdit}
                  onChange={(v) => patch(i, { is_active: v })}
                  label="Active"
                />
              </div>
            </div>
          ))}

          {canEdit && (
            <div className="flex items-center justify-between pt-1">
              <Button
                size="sm"
                variant="ghost"
                icon={<Plus className="w-3.5 h-3.5" />}
                onClick={addRow}
              >
                Add lace size
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon={<Save className="w-3.5 h-3.5" />}
                disabled={save.isPending}
                onClick={submit}
              >
                {save.isPending ? "Saving…" : "Save lace ladder"}
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
