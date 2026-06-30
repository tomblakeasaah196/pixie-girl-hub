import { useMemo, useState } from "react";
import { Search, Check, Plus, Layers, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/primitives";
import {
  useStyledProducts,
  useSizeConfig,
  type StyledProduct,
} from "@/lib/catalogue";

/**
 * Bundle product picker — the fast path for "add styled products to a bundle".
 *
 * Replaces the old one-at-a-time dropdowns. The flow is: pick a lace closure
 * (the bundle's variant axis) → the grid filters to products that offer it →
 * tick many with checkboxes (or "Select all") → one batch Add. Three taps to
 * load six wigs instead of six search-select-wait cycles.
 *
 * Lace resolution per product: the styled product's own `lace_size_codes` when
 * set, else the base's `base_lace_size_codes` (inherited). A product whose lace
 * set is unknown/empty is never hidden by a lace filter — we can't disprove the
 * match, so we keep it visible rather than silently dropping it.
 *
 * The picker owns only its selection; the parent decides what an "add" does
 * (append to a draft list when creating, fire mutations when editing).
 */

function resolveLace(p: StyledProduct): string[] {
  const own = p.lace_size_codes;
  if (own && own.length) return own;
  return p.base_lace_size_codes ?? [];
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-8 px-3 rounded-full text-[12px] font-semibold transition-colors border",
        active
          ? "bg-accent-deep border-accent-deep text-[#F4E9D9]"
          : "bg-text-primary/[0.04] border-line text-text-muted hover:text-text-primary hover:bg-text-primary/[0.07]",
      )}
    >
      {children}
    </button>
  );
}

export function BundleProductPicker({
  existingStyledIds,
  onAdd,
  busy = false,
  initialQuery = "",
}: {
  existingStyledIds: Set<string>;
  onAdd: (items: { styled_id: string; name: string }[]) => void | Promise<void>;
  busy?: boolean;
  // Optional seed for the search box (the Shades tab pre-fills the shade name so
  // the colour's products surface first). Defaults to empty — the bundle path is
  // unchanged. Re-seeding on reuse is the caller's job via a `key` remount.
  initialQuery?: string;
}) {
  const styled = useStyledProducts();
  const sizeConfig = useSizeConfig();
  const [q, setQ] = useState(initialQuery);
  const [lace, setLace] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const laceOptions = useMemo(
    () =>
      (sizeConfig.data?.lace_sizes ?? [])
        .filter((l) => l.is_active)
        .sort((a, b) => a.display_order - b.display_order),
    [sizeConfig.data],
  );

  const term = q.trim().toLowerCase();
  const visible = useMemo(() => {
    return (styled.data ?? []).filter((p) => {
      if (term && !`${p.name} ${p.styled_code}`.toLowerCase().includes(term))
        return false;
      if (lace) {
        const set = resolveLace(p);
        if (set.length && !set.includes(lace)) return false;
      }
      return true;
    });
  }, [styled.data, term, lace]);

  const selectableIds = useMemo(
    () =>
      visible
        .filter((p) => !existingStyledIds.has(p.styled_id))
        .map((p) => p.styled_id),
    [visible, existingStyledIds],
  );
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) selectableIds.forEach((id) => next.delete(id));
      else selectableIds.forEach((id) => next.add(id));
      return next;
    });

  const commit = async () => {
    const byId = new Map((styled.data ?? []).map((p) => [p.styled_id, p]));
    const items = [...selected]
      .map((id) => byId.get(id))
      .filter((p): p is StyledProduct => !!p)
      .map((p) => ({ styled_id: p.styled_id, name: p.name }));
    if (!items.length) return;
    await onAdd(items);
    setSelected(new Set());
  };

  return (
    <div className="space-y-3">
      {laceOptions.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1 text-text-faint text-[11px] mr-0.5">
            <Layers className="w-3.5 h-3.5" /> Lace
          </span>
          <Chip active={lace === null} onClick={() => setLace(null)}>
            All
          </Chip>
          {laceOptions.map((l) => (
            <Chip
              key={l.lace_code}
              active={lace === l.lace_code}
              onClick={() => setLace(lace === l.lace_code ? null : l.lace_code)}
            >
              {l.label || l.lace_code}
            </Chip>
          ))}
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint pointer-events-none" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search styled products…"
          className="w-full h-[42px] pl-9 pr-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11.5px] text-text-faint">
          {selectableIds.length} product{selectableIds.length === 1 ? "" : "s"}
          {selected.size > 0 ? ` · ${selected.size} selected` : ""}
        </span>
        {selectableIds.length > 0 && (
          <button
            type="button"
            onClick={toggleAll}
            className="text-[11.5px] font-semibold text-accent-glow"
          >
            {allSelected ? "Clear all" : `Select all (${selectableIds.length})`}
          </button>
        )}
      </div>

      <div className="max-h-[42vh] overflow-y-auto -mx-1 px-1 space-y-1.5">
        {styled.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-[58px] rounded-[12px] bg-text-primary/[0.05] animate-pulse"
            />
          ))
        ) : visible.length === 0 ? (
          <p className="px-1 py-6 text-center text-[12.5px] text-text-faint">
            {term || lace
              ? "No styled products match this filter."
              : "No styled products yet."}
          </p>
        ) : (
          visible.map((p) => {
            const added = existingStyledIds.has(p.styled_id);
            const checked = selected.has(p.styled_id);
            const laceSet = resolveLace(p);
            return (
              <button
                key={p.styled_id}
                type="button"
                disabled={added}
                onClick={() => toggle(p.styled_id)}
                className={cn(
                  "w-full flex items-center gap-3 rounded-[12px] border px-2.5 py-2 text-left transition-colors",
                  added
                    ? "border-line bg-text-primary/[0.02] opacity-60 cursor-default"
                    : checked
                      ? "border-accent/60 bg-accent/[0.08]"
                      : "border-line bg-text-primary/[0.03] hover:bg-text-primary/[0.06]",
                )}
              >
                <span
                  className={cn(
                    "grid place-items-center w-5 h-5 rounded-[6px] border shrink-0 transition-colors",
                    checked
                      ? "bg-accent-deep border-accent-deep text-[#F4E9D9]"
                      : "border-line",
                  )}
                >
                  {checked && <Check className="w-3.5 h-3.5" />}
                </span>
                <span className="w-9 h-9 rounded-[8px] overflow-hidden bg-text-primary/[0.06] grid place-items-center shrink-0">
                  {p.primary_image_url ? (
                    <img
                      src={p.primary_image_url}
                      alt=""
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="w-4 h-4 text-text-faint" />
                  )}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-[13px] text-text-primary">
                    {p.name}
                  </span>
                  <span className="block text-[10.5px] text-text-faint truncate">
                    {laceSet.length ? laceSet.join(" · ") : "all lace"}
                  </span>
                </span>
                {added && (
                  <span className="text-[10.5px] font-semibold text-success shrink-0">
                    Added
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>

      <Button
        variant="primary"
        size="sm"
        className="w-full"
        disabled={selected.size === 0 || busy}
        onClick={commit}
        icon={<Plus className="w-3.5 h-3.5" />}
      >
        {busy
          ? "Adding…"
          : selected.size > 0
            ? `Add ${selected.size} product${selected.size === 1 ? "" : "s"}`
            : "Select products to add"}
      </Button>
    </div>
  );
}
