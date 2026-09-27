import { useEffect, useState } from "react";
import { CheckSquare, Image as ImageIcon, Search, Square } from "lucide-react";
import { Button, MoneyText } from "@/components/ui/primitives";
import { useCareProducts, type CareProduct } from "@/lib/care-accessories";

export function CareProductPicker({
  excludeIds = new Set(),
  onAdd,
  onClose,
}: {
  excludeIds?: Set<string>;
  onAdd: (items: CareProduct[]) => void | Promise<void>;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Map<string, CareProduct>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const productsQ = useCareProducts({
    q: q.trim() || undefined,
    status: "live",
    page: 1,
    page_size: 100,
  });
  const products = (productsQ.data?.data || []).filter(
    (p) => !excludeIds.has(p.product_id),
  );

  useEffect(() => setSelected(new Map()), [q]);

  async function confirm() {
    if (!selected.size || submitting) return;
    setSubmitting(true);
    try {
      await onAdd([...selected.values()]);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col h-full max-h-[80vh]">
      <div className="p-4 border-b border-line">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search Care & Accessories…"
            className="w-full h-[42px] pl-9 pr-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {productsQ.isLoading ? (
          <div className="py-8 text-center text-text-faint text-[13px]">Loading…</div>
        ) : products.length === 0 ? (
          <div className="py-8 text-center text-text-faint text-[13px]">
            {q.trim() ? "No live care products match this search" : "No live Care & Accessories products available"}
          </div>
        ) : (
          products.map((p) => {
            const checked = selected.has(p.product_id);
            // List rows carry the default SKU's price (the list endpoint does
            // not return variants).
            const price = p.default_storefront_price?.ngn ?? null;
            return (
              <button
                key={p.product_id}
                type="button"
                onClick={() => setSelected((old) => {
                  const next = new Map(old);
                  if (checked) next.delete(p.product_id);
                  else next.set(p.product_id, p);
                  return next;
                })}
                className={`w-full text-left flex items-center gap-3 p-2.5 rounded-[12px] border transition-colors ${checked ? "border-accent/50 bg-accent/[0.06]" : "border-transparent hover:bg-text-primary/[0.04]"}`}
              >
                {checked ? <CheckSquare className="w-4 h-4 text-accent-glow shrink-0" /> : <Square className="w-4 h-4 text-text-faint shrink-0" />}
                <div className="w-11 h-11 rounded-[10px] bg-text-primary/[0.06] flex-shrink-0 grid place-items-center overflow-hidden" style={p.primary_image_url ? { backgroundImage: `url(${p.primary_image_url})`, backgroundSize: "cover" } : undefined}>
                  {!p.primary_image_url && <ImageIcon className="w-4 h-4 text-text-faint" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium truncate">{p.name}</div>
                  <div className="text-[11px] text-text-faint font-mono">{p.product_code}</div>
                </div>
                {price != null && <MoneyText ngn={Number(price)} className="text-[12px] text-text-muted shrink-0" />}
              </button>
            );
          })
        )}
      </div>
      <div className="p-3 border-t border-line flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!selected.size || submitting} onClick={confirm}>
          Add {selected.size || ""} care {selected.size === 1 ? "product" : "products"}
        </Button>
      </div>
    </div>
  );
}
