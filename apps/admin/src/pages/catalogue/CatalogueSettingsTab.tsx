import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Tags,
  Layers3,
  Save,
  ShieldCheck,
  DollarSign,
  CalendarClock,
  Trash2,
  Undo2,
  X,
  AlertTriangle,
  Scissors,
  Package,
} from "lucide-react";
import { Button, Card } from "@/components/ui/primitives";
import { Toggle, NumberField, ErrorState, Select } from "@/components/ui/controls";
import { Field } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Modal";
import { useAuthStore } from "@/stores/auth";
import { toastReport } from "@/lib/error-report";
import { toast } from "@/stores/toast";
import {
  useBrand,
  useSizeConfig,
  useSaveSizeConfig,
  useUsdPricing,
  useLaceUsage,
  useLaceTrash,
  useDeleteLaceType,
  useRestoreLaceType,
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
      {/* Care & Accessories on/off — Pixie Girl only */}
      <CareAccessoriesCard
        config={cfg.data?.config ?? null}
        loading={cfg.isLoading}
        canEdit={canEdit}
      />

      {/* Pre-orders */}
      <PreorderCard
        config={cfg.data?.config ?? null}
        loading={cfg.isLoading}
        canEdit={canEdit}
      />

      {/* Rewig adjacency */}
      <RewigCard
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

/** Care & Accessories — the on/off switch for the PXG retail line (combs,
 *  oils, brushes…). Lives here, not in a server setting, so the owner can
 *  flip it. OFF hides the Catalogue tab and stops new Care items and new Care
 *  sales; Care orders already placed keep their fee review and fulfilment,
 *  and nothing is deleted. Pixie Girl only — hidden on every other brand. */
function CareAccessoriesCard({
  config,
  loading,
  canEdit,
}: {
  config: CatalogueConfig | null;
  loading: boolean;
  canEdit: boolean;
}) {
  const brand = useBrand();
  const save = useSaveSizeConfig();
  if (brand !== "pixiegirl") return null;
  const enabled = config?.care_accessories_enabled ?? true;

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <div className="grid place-items-center w-10 h-10 rounded-[11px] bg-accent/10 text-accent-glow shrink-0">
          <Package className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-semibold">Care &amp; Accessories</h3>
          <p className="text-[12.5px] text-text-muted mt-0.5">
            {enabled
              ? "ON — the Care & Accessories tab shows in Catalogue, and live care items (combs, oils, brushes…) can be sold in Quick Sale, quotes, order links and the online shop."
              : "OFF — the Care & Accessories tab is hidden and no care items can be added or sold. Care orders already placed still go out, and nothing is deleted — turn it back on to carry on where you left off."}
          </p>
        </div>
        <Toggle
          checked={enabled}
          disabled={!canEdit || save.isPending || loading}
          onChange={(v) =>
            save.mutate(
              { care_accessories_enabled: v },
              {
                onSuccess: () =>
                  toast.success(
                    v
                      ? "Care & Accessories is on"
                      : "Care & Accessories is off",
                  ),
                onError: (err) =>
                  toastReport(
                    "Catalogue → Config",
                    "Switch Care & Accessories",
                    err,
                  ),
              },
            )
          }
          label={enabled ? "On" : "Off"}
        />
      </div>
    </Card>
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
          <div className="grid grid-cols-2 sm:grid-cols-[120px_120px_auto] gap-2.5 items-end">
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
              <div className="col-span-2 sm:col-span-1 pb-1.5">
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

/** Rewig adjacency — a base one size up/down may fill an order when its own
 *  size is short (e.g. a Medium base cut down for a Small, or built up for a
 *  Large — never further). Same styling job, no separate service or SKU.
 *  Master switch + mode (automatic for every listing vs. opt-in per listing)
 *  + which sibling to draw from first when more than one qualifies — all
 *  editable here so the behaviour can be retuned without a code change. */
function RewigCard({
  config,
  loading,
  canEdit,
}: {
  config: CatalogueConfig | null;
  loading: boolean;
  canEdit: boolean;
}) {
  const save = useSaveSizeConfig();
  const enabled = config?.rewig_enabled ?? true;
  const mode = config?.rewig_mode ?? "automatic";
  const direction = config?.rewig_direction ?? "down_first";

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <div className="grid place-items-center w-10 h-10 rounded-[11px] bg-accent/10 text-accent-glow shrink-0">
          <Scissors className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-semibold">Rewig adjacency</h3>
          <p className="text-[12.5px] text-text-muted mt-0.5">
            {enabled
              ? "ON — when a size's own base runs out, a base one size up or down (never further) can fill the order. It's the same styling job, no separate service."
              : "OFF — every variant reads only its own base's stock; a size with no direct stock shows made-to-order even if an adjacent size has units."}
          </p>
        </div>
        <Toggle
          checked={enabled}
          disabled={!canEdit || save.isPending || loading}
          onChange={(v) => save.mutate({ rewig_enabled: v })}
          label={enabled ? "On" : "Off"}
        />
      </div>

      {enabled && (
        <div className="mt-4 pt-4 border-t border-line grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Applies to">
            <Select
              value={mode}
              disabled={!canEdit || save.isPending}
              onChange={(v) =>
                save.mutate({ rewig_mode: v as "automatic" | "opt_in" })
              }
              options={[
                { value: "automatic", label: "Every listing (automatic)" },
                {
                  value: "opt_in",
                  label: "Only listings switched on (opt-in)",
                },
              ]}
            />
          </Field>
          <Field label="Draw from first">
            <Select
              value={direction}
              disabled={!canEdit || save.isPending}
              onChange={(v) =>
                save.mutate({
                  rewig_direction: v as
                    | "down_first"
                    | "up_first"
                    | "no_preference",
                })
              }
              options={[
                { value: "down_first", label: "The size above (cut down)" },
                { value: "up_first", label: "The size below (built up)" },
                { value: "no_preference", label: "Whichever has more stock" },
              ]}
            />
          </Field>
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
  const pending = status.data?.pending_request ?? null;

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
          {pending && (
            <p className="text-[12px] text-info mt-1">
              ₦{Number(pending.rate).toLocaleString()}/$1 is waiting for CEO
              approval.
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant="primary"
          icon={<DollarSign className="w-3.5 h-3.5" />}
          disabled={!canEdit}
          onClick={() => setOpen(true)}
        >
          {pending ? "Review request" : "Apply exchange rate"}
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
  // Which server-side lace the delete modal is targeting, and whether the
  // Trash bin is open.
  const [deleting, setDeleting] = useState<{ code: string; label: string } | null>(
    null,
  );
  const [trashOpen, setTrashOpen] = useState(false);
  const trash = useLaceTrash(trashOpen);
  const restore = useRestoreLaceType();

  // Codes that exist on the server (deletable → Trash). Locally-added, unsaved
  // rows aren't here; those get a plain "remove from list" instead.
  const serverCodes = useMemo(
    () => new Set(laceSizes.map((l) => l.lace_code)),
    [laceSizes],
  );

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

  // Drop an unsaved (not-yet-on-server) row from the local list.
  const removeRow = (i: number) =>
    setRows((prev) => prev.filter((_, idx) => idx !== i));

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
        The lace constructions a styled product can sell. Lace is a physical
        property of the base — a listing offers a construction by drawing from a
        base built that way (an HD6x6 base = a 6×6 option), so a base only
        exposes the lace it's actually made in. The premium is added to the
        styled anchor price for that construction; the USD premium is
        independent — set it for USD-priced products, or leave it blank to skip.
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
          {rows.map((r, i) => {
            const deleteBtn = canEdit ? (
              serverCodes.has(r.lace_code) ? (
                // Exists on the server → delete goes to Trash (with a
                // replacement pick if it's in use).
                <button
                  type="button"
                  title="Delete lace construction"
                  onClick={() =>
                    setDeleting({ code: r.lace_code, label: r.label })
                  }
                  className="text-text-faint hover:text-danger transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              ) : (
                // Unsaved local row → just drop it from the list.
                <button
                  type="button"
                  title="Remove"
                  onClick={() => removeRow(i)}
                  className="text-text-faint hover:text-text-primary transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )
            ) : null;

            return (
              <div
                key={i}
                className="rounded-[14px] border border-line bg-text-primary/[0.03] p-3.5 sm:border-0 sm:bg-transparent sm:p-0 sm:rounded-none grid grid-cols-2 sm:grid-cols-[88px_1fr_110px_110px_auto_28px] gap-2.5 sm:items-end"
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
                <div className="col-span-2 sm:col-span-1 flex items-center justify-between sm:block sm:pb-1.5">
                  <Toggle
                    checked={r.is_active}
                    disabled={!canEdit}
                    onChange={(v) => patch(i, { is_active: v })}
                    label="Active"
                  />
                  {deleteBtn && (
                    <div className="sm:hidden">{deleteBtn}</div>
                  )}
                </div>
                {deleteBtn && (
                  <div className="hidden sm:block pb-2.5">{deleteBtn}</div>
                )}
              </div>
            );
          })}

          {canEdit && (
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-1">
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
                  variant="ghost"
                  icon={<Trash2 className="w-3.5 h-3.5" />}
                  onClick={() => setTrashOpen(true)}
                >
                  Trash
                </Button>
              </div>
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

      {deleting && (
        <DeleteLaceModal
          code={deleting.code}
          label={deleting.label}
          options={laceSizes
            .filter((l) => l.lace_code !== deleting.code && l.is_active)
            .map((l) => ({ value: l.lace_code, label: `${l.label} (${l.lace_code})` }))}
          onClose={() => setDeleting(null)}
        />
      )}

      <Modal
        open={trashOpen}
        onClose={() => setTrashOpen(false)}
        title="Lace ladder — Trash"
        size="sm"
      >
        {trash.isLoading ? (
          <p className="text-[12.5px] text-text-muted py-4 text-center">Loading…</p>
        ) : !trash.data || trash.data.length === 0 ? (
          <p className="text-[12.5px] text-text-muted py-6 text-center">
            No lace constructions in the trash.
          </p>
        ) : (
          <div className="space-y-2">
            {trash.data.map((l) => (
              <div
                key={l.lace_code}
                className="flex items-center justify-between p-3 rounded-[11px] bg-text-primary/[0.03] border border-line"
              >
                <div>
                  <div className="text-[13px]">{l.label}</div>
                  <div className="text-[11px] font-mono text-text-faint">
                    {l.lace_code}
                    {l.purge_at && (
                      <span className="text-danger">
                        {" "}
                        · purges {new Date(l.purge_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Undo2 className="w-3.5 h-3.5" />}
                  disabled={restore.isPending}
                  onClick={() =>
                    restore.mutate(l.lace_code, {
                      onError: (err) =>
                        toastReport("Catalogue → Lace ladder", "Restore lace", err),
                    })
                  }
                >
                  Restore
                </Button>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </Card>
  );
}

/** Delete-a-lace-construction modal. Fetches usage on open; if any variant uses
 *  it, a replacement lace must be picked (its variants are repointed there
 *  before the original is trashed). Unused lace deletes straight to Trash. */
function DeleteLaceModal({
  code,
  label,
  options,
  onClose,
}: {
  code: string;
  label: string;
  options: { value: string; label: string }[];
  onClose: () => void;
}) {
  const usage = useLaceUsage(code);
  const del = useDeleteLaceType();
  const [replacement, setReplacement] = useState("");

  const inUse = (usage.data?.variant_count ?? 0) > 0;
  const needsReplacement = inUse && !replacement;

  const confirm = () => {
    del.mutate(
      { laceCode: code, replacementCode: inUse ? replacement : undefined },
      {
        onSuccess: onClose,
        onError: (err) =>
          toastReport("Catalogue → Lace ladder", "Delete lace", err),
      },
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Delete “${label}”`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={usage.isLoading || needsReplacement || del.isPending}
            onClick={confirm}
          >
            {del.isPending ? "Deleting…" : "Delete to Trash"}
          </Button>
        </>
      }
    >
      {usage.isLoading ? (
        <p className="text-[12.5px] text-text-muted py-4">Checking usage…</p>
      ) : inUse ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2 text-[12.5px] text-text-primary">
            <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
            <span>
              <strong>{usage.data!.variant_count}</strong> variant
              {usage.data!.variant_count === 1 ? "" : "s"} across{" "}
              <strong>{usage.data!.product_count}</strong> product
              {usage.data!.product_count === 1 ? "" : "s"} use “{label}”. Pick a
              replacement — those variants move to it, then “{label}” goes to
              Trash.
            </span>
          </div>
          <Field label="Replacement lace">
            {options.length === 0 ? (
              <p className="text-[12px] text-danger">
                No other active lace construction to move them to. Add one first.
              </p>
            ) : (
              <Select
                value={replacement}
                onChange={setReplacement}
                options={[{ value: "", label: "Select a replacement…" }, ...options]}
              />
            )}
          </Field>
        </div>
      ) : (
        <p className="text-[12.5px] text-text-muted py-1">
          Not used by any variant. It moves to Trash and can be restored within
          15 days before it's purged for good.
        </p>
      )}
    </Modal>
  );
}
