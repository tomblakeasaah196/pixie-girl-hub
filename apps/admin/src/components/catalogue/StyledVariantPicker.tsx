import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Check } from "lucide-react";
import { useStyledVariants, type StyledVariant } from "@/lib/catalogue";
import { cn } from "@/lib/cn";

/**
 * Staff-facing chooser for a styled product's head size + lace type (+ colour).
 * A styled product prices as a colour × size × lace matrix (each combo is a
 * `styled_variant` with its own effective_price_ngn), so before a styled item
 * is shared or captured the operator picks the exact variant — otherwise the
 * customer would see the base anchor price, not the price for their size/lace.
 *
 * Rendered as its own portal overlay at z-[115] — one notch above the shared
 * Modal (z-[110]) it opens from — so it reliably sits on top without nesting
 * two focus-trapped <Modal>s. Only options that have a live, active variant are
 * offered (a size/lace with no active combo can't be picked into a doomed order).
 */

export interface StyledPick {
  /** Null when the styled product has no colour×size×lace matrix — it then
   *  ships at the anchor price exactly as before this feature. */
  styled_variant_id: string | null;
  size_code: string | null;
  size_label: string | null;
  lace_code: string | null;
  lace_label: string | null;
  colour_id: string | null;
  colour_name: string | null;
  price: number | null;
  /** The chosen variant's OWN base product — may differ from the styled
   *  product's seed base (each size/colour can be cut from its own SKU).
   *  Callers that resolve a stock variant for THIS pick (Quick Sale,
   *  Quotation) need this to sell through the right base. */
  base_product_id: string | null;
  /** The chosen variant's own SKU (falls back to the styled product's own
   *  code when there is no matrix). */
  sku: string | null;
  /** Human label for the chosen combo, e.g. "Medium · 6×6 Frontal · Spicy Copper". */
  spec: string;
}

const ngn = (v: number | null | undefined) =>
  v == null ? "—" : `₦${Number(v).toLocaleString()}`;

/** Build the "Size · Lace · Colour" label, skipping absent axes. */
function specLabel(parts: {
  size_label?: string | null;
  lace_label?: string | null;
  colour_name?: string | null;
}): string {
  return [parts.size_label, parts.lace_label, parts.colour_name]
    .filter(Boolean)
    .join(" · ");
}

export function StyledVariantPicker({
  styledId,
  productName,
  imageUrl = null,
  anchorPrice = null,
  onCancel,
  onConfirm,
}: {
  styledId: string;
  productName: string;
  /** The styled product's own picture — shown in the header so reps unsure
   *  of the name can confirm by sight before picking size/lace. */
  imageUrl?: string | null;
  /** Fallback price when the product has no variant matrix. */
  anchorPrice?: number | null;
  onCancel: () => void;
  onConfirm: (pick: StyledPick) => void;
}) {
  const { data: variants = [], isLoading } = useStyledVariants(styledId);
  const active = useMemo(() => variants.filter((v) => v.is_active), [variants]);

  // A styled product with no colour×size×lace matrix has nothing to choose —
  // add it at its anchor price immediately rather than dead-ending on an empty
  // chooser (preserves the pre-feature behaviour for matrix-less products).
  useEffect(() => {
    if (isLoading || active.length > 0) return;
    onConfirm({
      styled_variant_id: null,
      size_code: null,
      size_label: null,
      lace_code: null,
      lace_label: null,
      colour_id: null,
      colour_name: null,
      base_product_id: null,
      sku: null,
      price: anchorPrice,
      spec: "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, active.length]);

  const [colourId, setColourId] = useState<string | null>(null);
  const [sizeCode, setSizeCode] = useState<string | null>(null);
  const [laceCode, setLaceCode] = useState<string | null>(null);

  // Distinct axis options, preserving the API's display order.
  const colours = useMemo(() => dedup(active, "colour_id", "colour_name"), [active]);
  const sizes = useMemo(() => dedup(active, "size_code", "size_label"), [active]);
  const laces = useMemo(
    () => dedup(active.filter((v) => v.lace_code), "lace_code", "lace_label"),
    [active],
  );

  // Seed each axis with the first available value once variants load.
  useEffect(() => {
    if (!active.length) return;
    setColourId((c) => c ?? colours[0]?.code ?? null);
    setSizeCode((s) => s ?? sizes[0]?.code ?? null);
    setLaceCode((l) => l ?? laces[0]?.code ?? null);
  }, [active, colours, sizes, laces]);

  // The single variant matching the current colour/size/lace selection.
  const match: StyledVariant | undefined = useMemo(
    () =>
      active.find(
        (v) =>
          (colourId == null || v.colour_id === colourId) &&
          (sizeCode == null || v.size_code === sizeCode) &&
          ((laces.length === 0 && !v.lace_code) || v.lace_code === laceCode),
      ),
    [active, colourId, sizeCode, laceCode, laces.length],
  );

  function confirm() {
    if (!match) return;
    onConfirm({
      styled_variant_id: match.styled_variant_id,
      size_code: match.size_code ?? null,
      size_label: match.size_label ?? null,
      lace_code: match.lace_code ?? null,
      lace_label: match.lace_label ?? null,
      colour_id: match.colour_id ?? null,
      colour_name: match.colour_name ?? null,
      base_product_id: match.base_product_id ?? null,
      sku: match.sku ?? null,
      price: match.effective_price_ngn ?? null,
      spec: specLabel(match),
    });
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[115] flex items-end justify-center bg-black/50 backdrop-blur-[3px] md:items-center md:p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-h-[88dvh] flex-col overflow-hidden rounded-t-[22px] dropglass md:w-[min(92vw,440px)] md:rounded-[18px]"
      >
        <div className="flex items-center gap-3 border-b hairline p-4 shrink-0">
          <div className="w-11 h-11 shrink-0 rounded-[10px] overflow-hidden bg-text-primary/[0.06]">
            {imageUrl && (
              <img
                src={imageUrl}
                alt=""
                className="w-full h-full object-cover"
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] uppercase tracking-widest text-text-faint">
              Choose size &amp; lace
            </div>
            <div className="truncate text-[14px] font-medium">{productName}</div>
          </div>
          <button
            onClick={onCancel}
            aria-label="Cancel"
            className="grid h-8 w-8 place-items-center rounded-full text-text-faint hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-4">
          {isLoading ? (
            <div className="grid place-items-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-accent-glow" />
            </div>
          ) : active.length === 0 ? (
            <p className="py-6 text-center text-[12.5px] text-text-faint">
              This styled product has no purchasable variants configured.
            </p>
          ) : (
            <>
              {sizes.length > 0 && (
                <Axis
                  label="Head size"
                  options={sizes}
                  value={sizeCode}
                  onPick={setSizeCode}
                />
              )}
              {laces.length > 0 && (
                <Axis
                  label="Lace"
                  options={laces}
                  value={laceCode}
                  onPick={setLaceCode}
                />
              )}
              {colours.length > 1 && (
                <Axis
                  label="Colour"
                  options={colours}
                  value={colourId}
                  onPick={setColourId}
                />
              )}
              {!match && (
                <p className="text-[11.5px] text-amber-300">
                  That size / lace combination isn&rsquo;t available — try another.
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t hairline p-4 pb-[max(env(safe-area-inset-bottom,0px),14px)] md:pb-4 shrink-0">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-text-faint">
              Price
            </div>
            <div className="font-mono text-[15px] text-accent-glow">
              {ngn(match?.effective_price_ngn ?? null)}
            </div>
          </div>
          <button
            onClick={confirm}
            disabled={!match}
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
          >
            <Check className="h-4 w-4" />
            Add
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Axis({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: { code: string; label: string }[];
  value: string | null;
  onPick: (code: string) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] uppercase tracking-widest text-text-faint">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.code}
            onClick={() => onPick(o.code)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[12px] transition-colors",
              value === o.code
                ? "border-accent bg-accent/15 text-accent-glow"
                : "hairline text-text-muted hover:text-text-primary",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Distinct {code,label} pairs for an axis, preserving first-seen order. */
function dedup(
  variants: StyledVariant[],
  codeKey: "colour_id" | "size_code" | "lace_code",
  labelKey: "colour_name" | "size_label" | "lace_label",
): { code: string; label: string }[] {
  const seen = new Set<string>();
  const out: { code: string; label: string }[] = [];
  for (const v of variants) {
    const code = v[codeKey] as string | null;
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, label: (v[labelKey] as string | null) || code });
  }
  return out;
}
