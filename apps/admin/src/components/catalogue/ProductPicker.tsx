import { useEffect, useRef, useState } from "react";
import { Search, Package, Layers, Box, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  PRODUCT_KINDS,
  searchByKind,
  type ProductKind,
  type ProductHit,
} from "@/lib/product-search";

/**
 * The ERP-wide product picker. The operator FIRST picks the kind — Base,
 * Styled or Bundle — and only then does the autocomplete unlock and search the
 * matching catalogue. One component, used everywhere products are added
 * (orders, quotations, invoices, POS), so the behaviour is identical across the
 * system. On pick it hands back a normalised `ProductHit`; the caller resolves
 * it into order lines via `resolvePick` (lib/product-search).
 */

const KIND_ICON: Record<ProductKind, typeof Package> = {
  base: Package,
  styled: Layers,
  bundle: Box,
  service: Sparkles,
};
const KIND_NOUN: Record<ProductKind, string> = {
  base: "base products",
  styled: "styled products",
  bundle: "bundles",
  service: "services",
};

export function ProductPicker({
  onPick,
  autoFocus,
  className,
}: {
  onPick: (hit: ProductHit) => void;
  autoFocus?: boolean;
  className?: string;
}) {
  const [kind, setKind] = useState<ProductKind | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const runSearch = (term: string) => {
    setQ(term);
    clearTimeout(debounce.current);
    if (!kind || term.trim().length < 2) {
      setHits([]);
      return;
    }
    setLoading(true);
    setOpen(true);
    debounce.current = setTimeout(async () => {
      try {
        setHits(await searchByKind(kind, term));
      } catch {
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 250);
  };

  const choose = (k: ProductKind) => {
    setKind(k);
    setQ("");
    setHits([]);
    setOpen(false);
  };

  const pick = (h: ProductHit) => {
    onPick(h);
    setQ("");
    setHits([]);
    setOpen(false);
  };

  return (
    <div ref={ref} className={cn("space-y-2.5", className)}>
      {/* Step 1 — pick the product type */}
      <div className="flex flex-wrap gap-1.5">
        {PRODUCT_KINDS.map((k) => {
          const on = k.key === kind;
          const Icon = KIND_ICON[k.key];
          return (
            <button
              key={k.key}
              type="button"
              onClick={() => choose(k.key)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 h-8 rounded-[9px] text-[12px] font-semibold border transition-colors",
                on
                  ? "border-accent/50 text-accent-glow bg-accent/[0.1]"
                  : "border-line text-text-muted hover:text-text-primary",
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {k.label}
            </button>
          );
        })}
      </div>

      {/* Step 2 — search (locked until a type is chosen) */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none" />
        <input
          autoFocus={autoFocus}
          disabled={!kind}
          value={q}
          onChange={(e) => runSearch(e.target.value)}
          onFocus={() => kind && q.trim().length >= 2 && setOpen(true)}
          placeholder={
            kind ? `Search ${KIND_NOUN[kind]}…` : "Pick a product type first…"
          }
          className="w-full h-[42px] pl-9 pr-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        {open && kind && q.trim().length >= 2 && (
          <div className="absolute z-50 top-[calc(100%+4px)] left-0 right-0 rounded-[11px] dropglass overflow-hidden py-1 max-h-[260px] overflow-y-auto">
            {loading ? (
              <div className="px-4 py-2.5 text-[12px] text-text-faint">
                Searching…
              </div>
            ) : hits.length === 0 ? (
              <div className="px-4 py-2.5 text-[12px] text-text-faint">
                No {KIND_NOUN[kind]} match “{q.trim()}”.
              </div>
            ) : (
              hits.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => pick(h)}
                  className="w-full px-4 py-2.5 text-left hover:bg-text-primary/[0.06] transition-colors"
                >
                  <div className="text-[13px] font-semibold">{h.label}</div>
                  <div className="text-[11px] text-text-faint">{h.sub}</div>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {!kind && (
        <p className="text-[11px] text-text-faint">
          Choose Base, Styled or Bundle — then the search box unlocks.
        </p>
      )}
    </div>
  );
}
