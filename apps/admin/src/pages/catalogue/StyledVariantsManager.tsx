import { useRef, useState } from "react";
import { Plus, Trash2, ImagePlus, Wand2, Palette } from "lucide-react";
import { Button, Card, MoneyText, Pill } from "@/components/ui/primitives";
import {
  NumberField,
  Toggle,
  MultiSelect,
  ConfirmDialog,
} from "@/components/ui/controls";
import {
  useStyledColours,
  useCreateColour,
  useUpdateColour,
  useDeleteColour,
  useColourImages,
  useAddColourImage,
  useRemoveColourImage,
  useStyledVariants,
  useBulkCreateVariants,
  useUpdateStyledVariant,
  useDeleteStyledVariant,
  useSizeConfig,
  type StyledColour,
  type StyledVariant,
} from "@/lib/catalogue";

/**
 * Colour + size management for a styled product (catalogue PR).
 *
 * Colours each own their pictures (2–3) and an optional video / IG link, plus
 * an optional per-colour price bump. The colour × size matrix is generated in
 * bulk; each variant's retail = the styled anchor + colour premium + size
 * premium, unless hand-overridden.
 */
export function StyledVariantsManager({
  styledId,
  anchorPrice,
  canEdit,
}: {
  styledId: string;
  anchorPrice: number | null;
  canEdit: boolean;
}) {
  const colours = useStyledColours(styledId);
  const variants = useStyledVariants(styledId);

  return (
    <div className="space-y-4">
      <ColoursCard
        styledId={styledId}
        canEdit={canEdit}
        colours={colours.data ?? []}
      />
      <VariantsCard
        styledId={styledId}
        canEdit={canEdit}
        anchorPrice={anchorPrice}
        colours={colours.data ?? []}
        variants={variants.data ?? []}
      />
    </div>
  );
}

/* ── Colours ─────────────────────────────────────────────── */
function ColoursCard({
  styledId,
  canEdit,
  colours,
}: {
  styledId: string;
  canEdit: boolean;
  colours: StyledColour[];
}) {
  const create = useCreateColour(styledId);
  const [name, setName] = useState("");
  const [hex, setHex] = useState("#1B1B1B");
  const [premium, setPremium] = useState("");

  const add = () => {
    if (!name.trim()) return;
    create.mutate(
      {
        name: name.trim(),
        hex: hex || null,
        premium_ngn: premium ? Number(premium) : 0,
        is_default: colours.length === 0,
      },
      {
        onSuccess: () => {
          setName("");
          setPremium("");
        },
      },
    );
  };

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-1">
        <Palette className="w-4 h-4 text-accent-glow" />
        <h3 className="font-display text-[15px]">Colours</h3>
        <span className="text-[11.5px] text-text-faint">
          each colour carries its own pictures
        </span>
      </div>

      {colours.length === 0 && (
        <p className="text-[12.5px] text-text-muted my-3">
          No colours yet. Add the first colour (e.g. <em>Natural Black</em>),
          then upload 2–3 pictures for it.
        </p>
      )}

      <div className="space-y-3 mt-3">
        {colours.map((c) => (
          <ColourRow
            key={c.colour_id}
            styledId={styledId}
            colour={c}
            canEdit={canEdit}
          />
        ))}
      </div>

      {canEdit && (
        <div className="mt-4 pt-4 border-t hairline">
          <div className="flex flex-wrap items-end gap-2.5">
            <label className="flex items-center gap-2">
              <input
                type="color"
                value={hex}
                onChange={(e) => setHex(e.target.value)}
                className="w-9 h-9 rounded-[9px] border border-line bg-transparent cursor-pointer"
                aria-label="Colour swatch"
              />
            </label>
            <div className="flex-1 min-w-[160px]">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && add()}
                placeholder="Colour name (e.g. Dark Copper)"
                className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
              />
            </div>
            <div className="w-[150px]">
              <NumberField
                value={premium}
                onChange={setPremium}
                suffix="₦+"
                placeholder="Colour premium"
              />
            </div>
            <Button
              size="sm"
              variant="primary"
              icon={<Plus className="w-3.5 h-3.5" />}
              disabled={!name.trim() || create.isPending}
              onClick={add}
            >
              Add colour
            </Button>
          </div>
          <p className="text-[11px] text-text-faint mt-2">
            Leave the premium at 0 to price a colour the same as the rest. Set
            it (e.g. blonde, highlights) to charge more for that colour across
            every size.
          </p>
        </div>
      )}
    </Card>
  );
}

function ColourRow({
  styledId,
  colour,
  canEdit,
}: {
  styledId: string;
  colour: StyledColour;
  canEdit: boolean;
}) {
  const images = useColourImages(styledId, colour.colour_id);
  const addImage = useAddColourImage(styledId, colour.colour_id);
  const removeImage = useRemoveColourImage(styledId, colour.colour_id);
  const update = useUpdateColour(styledId);
  const del = useDeleteColour(styledId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [igUrl, setIgUrl] = useState(colour.external_video_url ?? "");

  const imgs = images.data ?? [];

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.forEach((f) => addImage.mutate(f));
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="rounded-[12px] border border-line p-3">
      <div className="flex items-center gap-2.5">
        <span
          className="w-6 h-6 rounded-full border border-line shrink-0"
          style={{ background: colour.hex ?? "transparent" }}
        />
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-semibold truncate flex items-center gap-2">
            {colour.name}
            {colour.is_default && <Pill tone="neutral">default</Pill>}
            {Number(colour.premium_ngn) > 0 && (
              <span className="text-[11px] text-accent-glow">
                +₦{Number(colour.premium_ngn).toLocaleString()}
              </span>
            )}
          </div>
          <div className="text-[11px] text-text-faint">
            {imgs.length} picture{imgs.length === 1 ? "" : "s"}
            {imgs.length < 2 && <span className="text-warn"> · add 2–3</span>}
          </div>
        </div>
        {canEdit && (
          <>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-[12px] font-semibold text-text-muted hover:text-text-primary px-2 h-8 rounded-[9px] hover:bg-text-primary/[0.06]"
            >
              {expanded ? "Done" : "Edit"}
            </button>
            <button
              onClick={() => setConfirmDel(true)}
              className="text-text-faint hover:text-danger p-1.5 rounded-[9px] hover:bg-danger/10"
              aria-label="Delete colour"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      {/* Thumbnails */}
      <div className="flex flex-wrap gap-2 mt-3">
        {imgs.map((im) => (
          <div key={im.image_id} className="relative group">
            <img
              src={im.cdn_url ?? ""}
              alt={im.alt_text ?? colour.name}
              className="w-16 h-16 rounded-[10px] object-cover border border-line"
            />
            {canEdit && (
              <button
                onClick={() => removeImage.mutate(im.image_id)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 grid place-items-center rounded-full bg-danger text-white opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Remove picture"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
        {canEdit && (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={addImage.isPending}
            className="w-16 h-16 rounded-[10px] border border-dashed border-line grid place-items-center text-text-faint hover:text-accent-glow hover:border-accent/40 transition-colors"
            aria-label="Add picture"
          >
            {addImage.isPending ? (
              <span className="text-[10px]">…</span>
            ) : (
              <ImagePlus className="w-5 h-5" />
            )}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={onPick}
        />
      </div>

      {/* Expanded editor: premium toggle default + video/IG link */}
      {expanded && canEdit && (
        <div className="mt-3 pt-3 border-t hairline space-y-3">
          <div className="flex flex-wrap items-center gap-4">
            <Toggle
              checked={colour.is_default}
              onChange={(v) =>
                update.mutate({
                  colourId: colour.colour_id,
                  patch: { is_default: v },
                })
              }
              label="Default colour"
            />
            <Toggle
              checked={colour.is_active}
              onChange={(v) =>
                update.mutate({
                  colourId: colour.colour_id,
                  patch: { is_active: v },
                })
              }
              label="Active"
            />
          </div>
          <div>
            <label className="micro block mb-1">
              Video / Instagram link (optional)
            </label>
            <div className="flex gap-2">
              <input
                value={igUrl}
                onChange={(e) => setIgUrl(e.target.value)}
                placeholder="Paste an Instagram / TikTok / video URL…"
                className="flex-1 h-[40px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
              />
              <Button
                size="sm"
                disabled={igUrl === (colour.external_video_url ?? "")}
                onClick={() =>
                  update.mutate({
                    colourId: colour.colour_id,
                    patch: { external_video_url: igUrl.trim() || null },
                  })
                }
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        onConfirm={() =>
          del.mutate(colour.colour_id, {
            onSuccess: () => setConfirmDel(false),
          })
        }
        title={`Delete "${colour.name}"?`}
        message="This removes the colour, its pictures, and any size variants generated for it."
        confirmLabel="Delete colour"
        busy={del.isPending}
      />
    </div>
  );
}

/* ── Variants (colour × size matrix) ─────────────────────── */
function VariantsCard({
  styledId,
  canEdit,
  anchorPrice,
  colours,
  variants,
}: {
  styledId: string;
  canEdit: boolean;
  anchorPrice: number | null;
  colours: StyledColour[];
  variants: StyledVariant[];
}) {
  const sizeCfg = useSizeConfig();
  const bulk = useBulkCreateVariants(styledId);
  const tiers = (sizeCfg.data?.tiers ?? []).filter((t) => t.is_active);

  const [allSizes, setAllSizes] = useState(true);
  const [pickedSizes, setPickedSizes] = useState<string[]>([]);

  const prices = variants
    .filter((v) => v.is_active && v.effective_price_ngn != null)
    .map((v) => Number(v.effective_price_ngn));
  const range = prices.length
    ? { min: Math.min(...prices), max: Math.max(...prices) }
    : null;

  const generate = () => {
    if (!colours.length) return;
    bulk.mutate({
      all_sizes: allSizes,
      size_codes: allSizes ? undefined : pickedSizes,
    });
  };

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <h3 className="font-display text-[15px]">Sizes &amp; variants</h3>
        {range && (
          <span className="ml-auto text-[12px] text-text-muted">
            {range.min === range.max ? (
              <MoneyText ngn={range.min} className="text-[14px]" />
            ) : (
              <span className="inline-flex items-center gap-1">
                <MoneyText ngn={range.min} className="text-[14px]" /> –{" "}
                <MoneyText ngn={range.max} className="text-[14px]" />
              </span>
            )}
          </span>
        )}
      </div>

      {anchorPrice == null && (
        <p className="text-[12.5px] text-warn my-2">
          Set the styled <strong>retail price</strong> above first — variant
          prices are built from it plus the size premium.
        </p>
      )}

      {/* Generator */}
      {canEdit && (
        <div className="rounded-[12px] border border-line p-3 my-3">
          <div className="flex flex-wrap items-center gap-3">
            <Toggle
              checked={allSizes}
              onChange={setAllSizes}
              label="All sizes"
            />
            {!allSizes && (
              <MultiSelect
                values={pickedSizes}
                onChange={setPickedSizes}
                options={tiers.map((t) => ({
                  value: t.size_code,
                  label: t.size_code,
                }))}
              />
            )}
            <Button
              size="sm"
              variant="primary"
              icon={<Wand2 className="w-3.5 h-3.5" />}
              disabled={
                !colours.length ||
                bulk.isPending ||
                (!allSizes && !pickedSizes.length)
              }
              onClick={generate}
              className="ml-auto"
            >
              {bulk.isPending ? "Generating…" : "Generate variants"}
            </Button>
          </div>
          <p className="text-[11px] text-text-faint mt-2">
            Creates a SKU for every colour × size. Existing combinations are
            skipped, so it's safe to run again after adding a colour or size.
          </p>
          {!colours.length && (
            <p className="text-[11.5px] text-warn mt-1">
              Add at least one colour first.
            </p>
          )}
        </div>
      )}

      {/* Variant table */}
      {variants.length === 0 ? (
        <p className="text-[12.5px] text-text-muted">No variants yet.</p>
      ) : (
        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-text-faint text-left border-b hairline">
                <th className="py-2 font-semibold">Colour</th>
                <th className="py-2 font-semibold">Size</th>
                <th className="py-2 font-semibold">SKU</th>
                <th className="py-2 font-semibold text-right">Retail</th>
                <th className="py-2 font-semibold text-right">Override</th>
                <th className="py-2 font-semibold text-center">Active</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {variants.map((v) => (
                <VariantRow
                  key={v.styled_variant_id}
                  styledId={styledId}
                  v={v}
                  canEdit={canEdit}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function VariantRow({
  styledId,
  v,
  canEdit,
}: {
  styledId: string;
  v: StyledVariant;
  canEdit: boolean;
}) {
  const update = useUpdateStyledVariant(styledId);
  const del = useDeleteStyledVariant(styledId);
  const [override, setOverride] = useState(
    v.price_override_ngn != null ? String(v.price_override_ngn) : "",
  );

  const saveOverride = () => {
    const next = override.trim() === "" ? null : Number(override);
    if (next === (v.price_override_ngn ?? null)) return;
    update.mutate({
      variantId: v.styled_variant_id,
      patch: { price_override_ngn: next },
    });
  };

  return (
    <tr className="border-b hairline last:border-0">
      <td className="py-2">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="w-3 h-3 rounded-full border border-line"
            style={{ background: v.colour_hex ?? "transparent" }}
          />
          {v.colour_name}
        </span>
      </td>
      <td className="py-2">{v.size_code}</td>
      <td className="py-2 font-mono text-[10.5px] text-text-faint">{v.sku}</td>
      <td className="py-2 text-right">
        {v.effective_price_ngn != null ? (
          <MoneyText
            ngn={Number(v.effective_price_ngn)}
            className="text-[12.5px]"
          />
        ) : (
          <span className="text-text-faint">—</span>
        )}
      </td>
      <td className="py-2 text-right">
        {canEdit ? (
          <div className="w-[120px] ml-auto">
            <NumberField
              value={override}
              onChange={setOverride}
              placeholder="auto"
              suffix="₦"
              className="[&_input]:h-[34px]"
            />
            {override !==
              (v.price_override_ngn != null
                ? String(v.price_override_ngn)
                : "") && (
              <button
                onClick={saveOverride}
                className="text-[10.5px] text-accent-glow font-semibold mt-0.5"
              >
                save
              </button>
            )}
          </div>
        ) : v.price_override_ngn != null ? (
          <MoneyText
            ngn={Number(v.price_override_ngn)}
            className="text-[12.5px]"
          />
        ) : (
          <span className="text-text-faint">—</span>
        )}
      </td>
      <td className="py-2 text-center">
        <Toggle
          checked={v.is_active}
          disabled={!canEdit}
          onChange={(val) =>
            update.mutate({
              variantId: v.styled_variant_id,
              patch: { is_active: val },
            })
          }
        />
      </td>
      <td className="py-2 text-right">
        {canEdit && (
          <button
            onClick={() => del.mutate(v.styled_variant_id)}
            className="text-text-faint hover:text-danger p-1 rounded-[8px] hover:bg-danger/10"
            aria-label="Delete variant"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </td>
    </tr>
  );
}
