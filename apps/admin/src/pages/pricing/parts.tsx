import { useEffect, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { Field } from "@/components/ui/Form";
import { Select } from "@/components/ui/controls";
import { useBaseProducts, useVariants, type BaseProduct, type Variant } from "@/lib/catalogue";

/** Debounce a changing value (default 300ms) — used to throttle search + advisor calls. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Compact glass search input (label-less inline variant). */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search products…",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint pointer-events-none" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-[42px] pl-9 pr-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
      />
    </div>
  );
}

export function variantLabel(v: Variant): string {
  const parts = [v.variant_name, v.sku].filter(Boolean);
  return parts.length ? parts.join(" · ") : (v.variant_id.slice(0, 8) ?? "Variant");
}

/**
 * Product → variant picker. Searches base products (debounced) and lists matches;
 * selecting a product loads its variants into a Select. Calls `onChange` with the
 * chosen variant_id (or null) and surfaces the picked product/variant for context.
 */
export function ProductVariantPicker({
  productId,
  variantId,
  onProduct,
  onVariant,
  label = "Product",
}: {
  productId: string | null;
  variantId: string | null;
  onProduct: (p: BaseProduct | null) => void;
  onVariant: (variantId: string | null, variant: Variant | null) => void;
  label?: string;
}) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 300);
  const products = useBaseProducts({ q: dq || undefined });
  const variants = useVariants(productId);

  const list = products.data ?? [];
  const vList = variants.data ?? [];

  return (
    <div className="space-y-3">
      <Field label={label}>
        <SearchInput value={q} onChange={setQ} />
      </Field>

      {!productId && (
        <div className="rounded-[12px] border border-line max-h-[220px] overflow-y-auto">
          {products.isLoading ? (
            <div className="p-3 text-[12px] text-text-faint">Searching…</div>
          ) : list.length === 0 ? (
            <div className="p-3 text-[12px] text-text-faint">
              {dq ? "No products match." : "Type to search products."}
            </div>
          ) : (
            list.slice(0, 25).map((p) => (
              <button
                key={p.product_id}
                type="button"
                onClick={() => {
                  onProduct(p);
                  onVariant(null, null);
                }}
                className="w-full px-3 py-2.5 text-left border-b hairline last:border-0 hover:bg-text-primary/[0.04] transition-colors flex items-center gap-2"
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-semibold truncate">{p.name}</span>
                  <span className="block font-mono text-[10.5px] text-text-faint">{p.product_code}</span>
                </span>
              </button>
            ))
          )}
        </div>
      )}

      {productId && (
        <div className="rounded-[12px] border border-line p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] text-text-muted">
              {list.find((p) => p.product_id === productId)?.name ?? "Selected product"}
            </span>
            <button
              type="button"
              onClick={() => {
                onProduct(null);
                onVariant(null, null);
                setQ("");
              }}
              className="text-[11px] font-semibold text-accent-glow hover:underline"
            >
              Change
            </button>
          </div>

          <Field label="Variant">
            {variants.isLoading ? (
              <div className="h-[42px] rounded-[11px] bg-text-primary/[0.04] animate-pulse" />
            ) : vList.length === 0 ? (
              <div className="text-[12px] text-text-faint">No variants on this product.</div>
            ) : (
              <Select
                value={variantId ?? ""}
                onChange={(id) =>
                  onVariant(id || null, vList.find((v) => v.variant_id === id) ?? null)
                }
                options={[
                  { value: "", label: "Select a variant…" },
                  ...vList.map((v) => ({ value: v.variant_id, label: variantLabel(v) })),
                ]}
              />
            )}
          </Field>
        </div>
      )}
    </div>
  );
}

/** A labelled stat used in result/detail cards. */
export function Stat({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="micro mb-1">{label}</div>
      <div className="font-mono text-[15px]">{children}</div>
    </div>
  );
}

/** Thin tinted info/warn banner. */
export function Banner({
  tone = "warn",
  icon,
  children,
}: {
  tone?: "warn" | "danger" | "info" | "accent";
  icon?: ReactNode;
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    warn: "text-warn bg-warn/10 border-warn/25",
    danger: "text-danger bg-danger/10 border-danger/25",
    info: "text-info bg-info/10 border-info/25",
    accent: "text-accent-glow bg-accent/10 border-accent/25",
  };
  return (
    <div className={cn("flex items-start gap-2 text-[13px] rounded-xl p-3 border", tones[tone])}>
      {icon && <span className="shrink-0 mt-0.5">{icon}</span>}
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}

/** A small labelled slider bound to a NumberField pattern (used by Advisor). */
export function LabeledSlider({
  value,
  onChange,
  min,
  max,
  step,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="flex-1 accent-[rgb(var(--accent-deep))] h-2 rounded-full cursor-pointer"
    />
  );
}
