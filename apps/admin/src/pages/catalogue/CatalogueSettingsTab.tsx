import { useEffect, useState } from "react";
import {
  Plus,
  Tags,
  Layers3,
  Save,
  ShieldCheck,
  DollarSign,
  CalendarClock,
} from "lucide-react";
import { Button, Card } from "@/components/ui/primitives";
import { Toggle, NumberField, ErrorState } from "@/components/ui/controls";
import { Field } from "@/components/ui/Form";
import { useAuthStore } from "@/stores/auth";
import {
  useSizeConfig,
  useSaveSizeConfig,
  useUsdPricing,
  type LaceSize,
  type CatalogueConfig,
} from "@/lib/catalogue";
import { UsdRepriceModal } from "./UsdRepriceModal";

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
  const allowBase =
    cfg.data?.config?.allow_base_in_collections_bundles ?? false;

  return (
    <div className="space-y-5">
      {/* Pre-orders */}
      <PreorderCard
        config={cfg.data?.config ?? null}
        loading={cfg.isLoading}
        canEdit={canEdit}
      />

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

      {/* USD pricing — bulk apply exchange rate */}
      <UsdPricingCard canEdit={canEdit} />

      {/* Allow base products in collections/bundles */}
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="grid place-items-center w-10 h-10 rounded-[11px] bg-accent/10 text-accent-glow shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[15px] font-semibold">
              Base products in collections &amp; bundles
            </h3>
            <p className="text-[12.5px] text-text-muted mt-0.5">
              {allowBase
                ? "ON — base (stock-room) products can be added to collections and bundles alongside styled products."
                : "OFF — only styled products may be added to collections and bundles. Turn this on if you need to include raw base products."}
            </p>
          </div>
          <Toggle
            checked={allowBase}
            disabled={!canEdit || save.isPending || cfg.isLoading}
            onChange={(v) =>
              save.mutate({ allow_base_in_collections_bundles: v })
            }
            label={allowBase ? "On" : "Off"}
          />
        </div>
      </Card>
    </div>
  );
}

/** Pre-orders — master switch + the production delivery window shown to buyers
 *  when an item is out of stock. Universal: any out-of-stock item is offered as
 *  a pre-order (unless a product is opted out on its own page). */
function PreorderCard({
  config,
  loading,
  canEdit,
}: {
  config: CatalogueConfig | null;
  loading: boolean;
  canEdit: boolean;
}) {
  const save = useSaveSizeConfig();
  const enabled = config?.preorder_enabled ?? true;
  const [minW, setMinW] = useState<string>("");
  const [maxW, setMaxW] = useState<string>("");

  // Seed the week inputs from the server whenever config (re)loads.
  useEffect(() => {
    setMinW(String(config?.preorder_min_weeks ?? 4));
    setMaxW(String(config?.preorder_max_weeks ?? 8));
  }, [config?.preorder_min_weeks, config?.preorder_max_weeks]);

  const dirty =
    minW !== String(config?.preorder_min_weeks ?? 4) ||
    maxW !== String(config?.preorder_max_weeks ?? 8);
  const invalid =
    minW === "" ||
    maxW === "" ||
    Number(minW) < 0 ||
    Number(maxW) < Number(minW);

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <div className="grid place-items-center w-10 h-10 rounded-[11px] bg-accent/10 text-accent-glow shrink-0">
          <CalendarClock className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-semibold">Pre-orders</h3>
          <p className="text-[12.5px] text-text-muted mt-0.5">
            {enabled
              ? "ON — when an item is out of stock the buyer is told it's made to order and can pre-order on the window below. Turn off on a single product from its page."
              : "OFF — out-of-stock items read as “Sold out” and can’t be bought until restocked."}
          </p>
        </div>
        <Toggle
          checked={enabled}
          disabled={!canEdit || save.isPending || loading}
          onChange={(v) => save.mutate({ preorder_enabled: v })}
          label={enabled ? "On" : "Off"}
        />
      </div>

      {enabled && (
        <div className="mt-4 pt-4 border-t border-line">
          <p className="text-[12.5px] text-text-muted mb-3">
            Production window shown to buyers — e.g. “ships in ~
            {minW || 4}–{maxW || 8} weeks”.
          </p>
          <div className="grid grid-cols-[120px_120px_auto] gap-2.5 items-end">
            <Field label="Min weeks">
              <NumberField
                value={minW}
                onChange={setMinW}
                suffix="wks"
              />
            </Field>
            <Field label="Max weeks">
              <NumberField
                value={maxW}
                onChange={setMaxW}
                suffix="wks"
              />
            </Field>
            {canEdit && (
              <div className="pb-1.5">
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Save className="w-3.5 h-3.5" />}
                  disabled={save.isPending || !dirty || invalid}
                  onClick={() =>
                    save.mutate({
                      preorder_min_weeks: Number(minW),
                      preorder_max_weeks: Number(maxW),
                    })
                  }
                >
                  {save.isPending ? "Saving…" : "Save window"}
                </Button>
              </div>
            )}
          </div>
          {invalid && (
            <p className="text-[12px] text-danger mt-2">
              Max weeks must be at least the min.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

/** USD pricing card — open the "Apply exchange rate" tool. Shows the last rate
 *  applied (if any) so the owner knows the catalogue's current USD basis. */
function UsdPricingCard({ canEdit }: { canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const status = useUsdPricing();
  const lastRun =
    status.data?.last_run && !status.data.last_run.is_undone
      ? status.data.last_run
      : null;

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <div className="grid place-items-center w-10 h-10 rounded-[11px] bg-accent/10 text-accent-glow shrink-0">
          <DollarSign className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-semibold">USD pricing</h3>
          <p className="text-[12.5px] text-text-muted mt-0.5">
            {lastRun
              ? `Last applied ₦${Number(lastRun.rate).toLocaleString()}/$1 across the catalogue.`
              : "Set every USD price from one exchange rate. Recomputes USD from each item’s Naira price — base variants, styled products, the ladders, bundles and services."}
          </p>
        </div>
        <Button
          size="sm"
          variant="primary"
          icon={<DollarSign className="w-3.5 h-3.5" />}
          disabled={!canEdit}
          onClick={() => setOpen(true)}
        >
          Apply exchange rate
        </Button>
      </div>
      <UsdRepriceModal open={open} onClose={() => setOpen(false)} />
    </Card>
  );
}

type LaceRow = Pick<
  LaceSize,
  "lace_code" | "label" | "premium_ngn" | "premium_usd" | "description" | "is_active"
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
        premium_usd: l.premium_usd,
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
        premium_usd: null,
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
        to the styled anchor price for that construction. The USD premium is
        independent — set it for USD-priced products; leave it blank to skip.
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
              className="grid grid-cols-[88px_1fr_120px_120px_auto] gap-2.5 items-end"
            >
              <Field label="Code">
                <input
                  value={r.lace_code}
                  disabled={!canEdit}
                  onChange={(e) => patch(i, { lace_code: e.target.value })}
                  placeholder="13X4"
                  className="w-full h-[40px] px-[11px] rounded-[10px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] uppercase outline-none focus:border-accent/50" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
                />
              </Field>
              <Field label="Label">
                <input
                  value={r.label}
                  disabled={!canEdit}
                  onChange={(e) => patch(i, { label: e.target.value })}
                  placeholder="13×4 Frontal"
                  className="w-full h-[40px] px-[11px] rounded-[10px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
                />
              </Field>
              <Field label="Premium (₦)">
                <NumberField
                  value={String(r.premium_ngn ?? 0)}
                  onChange={(v) => patch(i, { premium_ngn: Number(v) || 0 })}
                  suffix="₦"
                />
              </Field>
              <Field label="Premium ($)">
                <NumberField
                  value={r.premium_usd != null ? String(r.premium_usd) : ""}
                  onChange={(v) =>
                    patch(i, {
                      premium_usd: v.trim() === "" ? null : Number(v) || 0,
                    })
                  }
                  suffix="$"
                  placeholder="—"
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
