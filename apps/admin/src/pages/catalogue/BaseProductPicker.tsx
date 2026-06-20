import { useEffect, useRef, useState } from "react";
import { Search, Check, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useBaseProducts, type BaseProduct } from "@/lib/catalogue";

/**
 * Searchable base-product picker (catalogue PR). Replaces the old dropdown
 * that became unusable once ~100 base products were imported. Filters from the
 * first character and shows name · lace · length so the right base is obvious.
 */
export function BaseProductPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Filters from the first character; react-query caches per term.
  const results = useBaseProducts(q.trim() ? { q: q.trim() } : {});

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const pick = (b: BaseProduct) => {
    onChange(b.product_id);
    setLabel(`${b.name} · ${b.product_code}`);
    setOpen(false);
    setQ("");
  };

  const clear = () => {
    onChange("");
    setLabel("");
    setQ("");
  };

  const list = (results.data ?? []).slice(0, 30);

  // Selected, not actively searching → show a confirmation chip.
  if (value && label && !open) {
    return (
      <div className="flex items-center gap-2 h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line">
        <Check className="w-4 h-4 text-success shrink-0" />
        <span className="text-[13px] truncate flex-1">{label}</span>
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

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint pointer-events-none" />
        <input
          autoFocus={open}
          disabled={disabled}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search base products by name, lace, length…"
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
              No base products match “{q.trim()}”.
            </div>
          ) : (
            list.map((b) => (
              <button
                key={b.product_id}
                type="button"
                onClick={() => pick(b)}
                className={cn(
                  "w-full px-[13px] py-2 text-left transition-colors hover:bg-text-primary/[0.06]",
                  b.product_id === value && "bg-accent/[0.08]",
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
