import { useEffect, useRef, useState } from "react";
import { AnchoredDropdown } from "@/components/ui/AnchoredDropdown";
import type { GeoOption } from "@/lib/order-checkout-geo";

/**
 * Searchable country/state/LGA autocomplete for admin address pickers whose
 * fee must resolve to the EXACT same delivery zone the storefront checkout
 * prices against (see `@/lib/order-checkout-geo`). A picked item's `code` is
 * only committed via `onSelect` (a dropdown pick) — a typed-but-unselected
 * value never resolves a zone, matching the storefront checkout's own
 * ComboBox so a half-typed location can't silently price ₦0 delivery.
 */
export function GeoComboBox({
  options,
  value,
  onChange,
  onSelect,
  placeholder,
}: {
  options: GeoOption[];
  value: string;
  onChange: (name: string) => void;
  onSelect: (item: GeoOption) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const q = query.trim().toLowerCase();
  const filtered =
    q.length === 0
      ? options.slice(0, 8)
      : options.filter((o) => o.name.toLowerCase().includes(q)).slice(0, 30);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={query}
        autoComplete="off"
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className="w-full h-[42px] px-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
      />
      <AnchoredDropdown
        anchorRef={inputRef}
        open={open}
        onClose={() => setOpen(false)}
        maxHeight={240}
        className="dropglass"
      >
        {filtered.length > 0 ? (
          filtered.map((item) => (
            <button
              key={item.code}
              type="button"
              onClick={() => {
                setQuery(item.name);
                onSelect(item);
                setOpen(false);
              }}
              className="w-full px-4 py-2.5 text-left text-[13px] hover:bg-text-primary/[0.06] transition-colors"
            >
              {item.name}
            </button>
          ))
        ) : (
          <div className="px-4 py-2.5 text-[12px] text-text-faint">
            No matches — check the spelling.
          </div>
        )}
      </AnchoredDropdown>
    </div>
  );
}
