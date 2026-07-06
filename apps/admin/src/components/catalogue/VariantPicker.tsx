import { useEffect, useRef, useState } from "react";
import { Search, Check, X, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/cn";
import { useBaseProducts, useVariants, type BaseProduct } from "@/lib/catalogue";

/**
 * Searchable variant picker — the same name-first search as BaseProductPicker
 * (Goods Reception), but resolved down to a specific sellable variant. Replaces
 * raw "Variant ID" UUID fields anywhere a stock form needs one: the operator
 * types the product name, picks the base product, then picks the size/variant.
 * Single-variant base products skip straight to selection.
 */
export function VariantPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (variantId: string, label: string) => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [pendingProduct, setPendingProduct] = useState<BaseProduct | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const results = useBaseProducts(q.trim() ? { q: q.trim() } : {});
  const variantsQ = useVariants(pendingProduct?.product_id ?? null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  // Once variants for the chosen product load, auto-pick if there's only one.
  useEffect(() => {
    if (!pendingProduct || !variantsQ.data) return;
    const active = variantsQ.data.filter((v) => v.is_active !== false);
    if (active.length === 1) {
      pickVariant(active[0].variant_id, active[0].variant_name, active[0].sku);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingProduct, variantsQ.data]);

  const pickVariant = (
    variantId: string,
    variantName: string | null,
    sku: string | null,
  ) => {
    // Variants are often named identically to the product they belong to
    // (a size-only variant) — only append the variant name when it actually
    // adds information, otherwise the chip reads as an odd duplicate.
    const distinctVariant =
      variantName && variantName.trim() !== pendingProduct?.name.trim()
        ? variantName
        : null;
    const full = pendingProduct
      ? `${pendingProduct.name}${distinctVariant ? ` — ${distinctVariant}` : ""}${sku ? ` (${sku})` : ""}`
      : (variantName ?? sku ?? variantId);
    onChange(variantId, full);
    setLabel(full);
    setPendingProduct(null);
    setOpen(false);
    setQ("");
  };

  const pickProduct = (b: BaseProduct) => {
    setPendingProduct(b);
  };

  const clear = () => {
    onChange("", "");
    setLabel("");
    setPendingProduct(null);
    setQ("");
  };

  const list = (results.data ?? []).slice(0, 30);

  // Selected, not actively searching → show a confirmation chip.
  if (value && label && !open) {
    return (
      <div className="flex items-center gap-2 h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line w-full min-w-0">
        <Check className="w-4 h-4 text-success shrink-0" />
        <span className="text-[13px] truncate flex-1 min-w-0">{label}</span>
        {!disabled && (
          <button
            onClick={() => setOpen(true)}
            className="text-[12px] font-semibold text-accent-glow hover:underline"
          >
            change
          </button>
        )}
        {!disabled && (
          <button
            onClick={clear}
            className="text-text-faint hover:text-danger"
            aria-label="Clear"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    );
  }

  // Step 2 — a product with multiple variants: pick the specific one.
  if (pendingProduct) {
    const variants = (variantsQ.data ?? []).filter((v) => v.is_active !== false);
    return (
      <div ref={ref} className="relative w-full min-w-0">
        <div className="flex items-center gap-2 h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line min-w-0">
          <button
            onClick={() => setPendingProduct(null)}
            className="text-text-faint hover:text-text-primary shrink-0"
            aria-label="Back"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-[13px] truncate flex-1 min-w-0">
            {pendingProduct.name}
          </span>
        </div>
        <div className="select-dropdown-list absolute z-50 top-[calc(100%+4px)] left-0 right-0 rounded-[11px] overflow-hidden py-1 max-h-[260px] overflow-y-auto">
          {variantsQ.isLoading ? (
            <div className="px-[13px] py-3 text-[12.5px] text-text-faint">
              Loading variants…
            </div>
          ) : variants.length === 0 ? (
            <div className="px-[13px] py-3 text-[12.5px] text-text-faint">
              No active variants on this product.
            </div>
          ) : (
            variants.map((v) => (
              <button
                key={v.variant_id}
                type="button"
                onClick={() => pickVariant(v.variant_id, v.variant_name, v.sku)}
                className="w-full px-[13px] py-2 text-left transition-colors hover:bg-text-primary/[0.06]"
              >
                <div className="text-[13px] text-text-primary truncate">
                  {v.variant_name ?? "Unnamed variant"}
                </div>
                {v.sku && (
                  <div className="text-[11px] text-text-faint font-mono text-accent-glow">
                    {v.sku}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    );
  }

  // Step 1 — search base products by name.
  return (
    <div ref={ref} className="relative w-full min-w-0">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint pointer-events-none" />
        <input
          disabled={disabled}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search products by name…"
          className="w-full h-[42px] pl-9 pr-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
        />
      </div>

      {open && (
        <div className="select-dropdown-list absolute z-50 top-[calc(100%+4px)] left-0 right-0 rounded-[11px] overflow-hidden py-1 max-h-[300px] overflow-y-auto">
          {q.trim().length === 0 ? (
            <div className="px-[13px] py-3 text-[12.5px] text-text-faint">
              Start typing to search…
            </div>
          ) : results.isLoading ? (
            <div className="px-[13px] py-3 text-[12.5px] text-text-faint">
              Searching…
            </div>
          ) : list.length === 0 ? (
            <div className="px-[13px] py-3 text-[12.5px] text-text-faint">
              No products match "{q.trim()}".
            </div>
          ) : (
            list.map((b) => (
              <button
                key={b.product_id}
                type="button"
                onClick={() => pickProduct(b)}
                className={cn(
                  "w-full px-[13px] py-2 text-left transition-colors hover:bg-text-primary/[0.06]",
                )}
              >
                <div className="text-[13px] text-text-primary truncate">
                  {b.name}
                </div>
                <div className="text-[11px] text-text-faint flex items-center gap-2">
                  <span className="font-mono text-accent-glow">
                    {b.product_code}
                  </span>
                  {b.lace_type && (
                    <span>· {b.lace_type.replace(/_/g, " ")}</span>
                  )}
                  {b.hair_length_inches != null && (
                    <span>· {b.hair_length_inches}"</span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
