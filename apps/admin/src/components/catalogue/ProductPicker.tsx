import { useMemo, useRef, useState } from "react";
import { Search, Package, Layers, Box, Sparkles, Droplets, Check, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { AnchoredDropdown } from "@/components/ui/AnchoredDropdown";
import { ExpandableText } from "@/components/ui/ExpandableText";
import {
  PRODUCT_KINDS,
  searchByKind,
  type ProductKind,
  type ProductHit,
} from "@/lib/product-search";
import { useCareAvailability } from "@/lib/care-accessories";

/**
 * The ERP-wide product picker. The operator FIRST picks the kind — Base,
 * Styled or Bundle — and only then does the autocomplete unlock and search the
 * matching catalogue. One component, used everywhere products are added
 * (orders, quotations, invoices, POS), so the behaviour is identical across the
 * system. On pick it hands back a normalised `ProductHit`; the caller resolves
 * it into order lines via `resolvePick` (lib/product-search).
 *
 * In `multi` mode the rows become checkboxes: the dropdown stays open while the
 * operator ticks several hits (across as many searches and kinds as they like),
 * the picks collect in a chip tray, and one "Add N" press hands the whole batch
 * to `onPickMany`. Restocking a factory order means twenty near-identical wigs —
 * pick → add → reopen → pick, twenty times, is the wrong shape for that job.
 */

const KIND_ICON: Record<ProductKind, typeof Package> = {
  base: Package,
  styled: Layers,
  bundle: Box,
  service: Sparkles,
  care: Droplets,
};
const KIND_NOUN: Record<ProductKind, string> = {
  base: "base products",
  styled: "styled products",
  bundle: "bundles",
  service: "services",
  care: "care & accessories",
};

/** Fallback glyph shown in the result thumbnail when a hit has no image. */
function KIND_ICON_EL({ kind }: { kind: ProductKind }) {
  const Icon = KIND_ICON[kind];
  return <Icon className="w-4 h-4 text-text-faint" />;
}

export function ProductPicker({
  onPick,
  onPickMany,
  multi,
  addLabel = "Add",
  autoFocus,
  className,
  allowCare = false,
}: {
  onPick?: (hit: ProductHit) => void;
  /** Batch handler — required when `multi` is set. */
  onPickMany?: (hits: ProductHit[]) => void;
  multi?: boolean;
  /** Verb on the batch button, e.g. "Add 3 lines". */
  addLabel?: string;
  autoFocus?: boolean;
  className?: string;
  /** Offer the Care & Accessories kind. SELLING screens only (Quick Sale,
   *  quotes, Change Order): a care hit's id is a variant, and hair-only
   *  contexts (production runs, styled BOM, consignment, purchasing) would
   *  misread it as a product or feed a bottle into a wig workflow. */
  allowCare?: boolean;
}) {
  const [kind, setKind] = useState<ProductKind | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ProductHit[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  // The Care & Accessories kind exists only on selling screens that opt in,
  // and only behind the PXG gate + flag. The server re-checks both on every
  // sellable call; hiding the chip here is about not offering a dead button.
  const careAvail = useCareAvailability();
  const kinds = useMemo(
    () =>
      PRODUCT_KINDS.filter(
        (k) =>
          k.key !== "care" || (allowCare && careAvail.data?.enabled === true),
      ),
    [allowCare, careAvail.data?.enabled],
  );

  const isSelected = (h: ProductHit) =>
    selected.some((s) => s.kind === h.kind && s.id === h.id);
  const toggle = (h: ProductHit) =>
    setSelected((prev) =>
      prev.some((s) => s.kind === h.kind && s.id === h.id)
        ? prev.filter((s) => !(s.kind === h.kind && s.id === h.id))
        : [...prev, h],
    );
  const commit = () => {
    if (!selected.length) return;
    onPickMany?.(selected);
    setSelected([]);
    setQ("");
    setHits([]);
    setOpen(false);
  };

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
    if (multi) {
      toggle(h);
      // Deliberately leave the panel open and the query intact — ticking the
      // next of five near-identical wigs shouldn't cost a re-search.
      return;
    }
    onPick?.(h);
    setQ("");
    setHits([]);
    setOpen(false);
  };

  return (
    <div className={cn("space-y-2.5", className)}>
      {/* Step 1 — pick the product type */}
      <div className="flex flex-wrap gap-1.5">
        {kinds.map((k) => {
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
          ref={inputRef}
          autoFocus={autoFocus}
          disabled={!kind}
          value={q}
          onChange={(e) => runSearch(e.target.value)}
          onFocus={() => kind && q.trim().length >= 2 && setOpen(true)}
          placeholder={
            kind ? `Search ${KIND_NOUN[kind]}…` : "Pick a product type first…"
          }
          className="w-full h-[42px] pl-9 pr-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50 disabled:opacity-50 disabled:cursor-not-allowed" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
        />
        <AnchoredDropdown
          anchorRef={inputRef}
          open={open && !!kind && q.trim().length >= 2}
          onClose={() => setOpen(false)}
          maxHeight={260}
          mobileMinWidth={360}
          className="dropglass"
        >
          {loading ? (
            <div className="px-4 py-2.5 text-[12px] text-text-faint">
              Searching…
            </div>
          ) : hits.length === 0 ? (
            <div className="px-4 py-2.5 text-[12px] text-text-faint">
              No {kind ? KIND_NOUN[kind] : "products"} match “{q.trim()}”.
            </div>
          ) : (
            hits.map((h) => {
              const on = multi && isSelected(h);
              return (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => pick(h)}
                  aria-pressed={multi ? on : undefined}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-text-primary/[0.06] transition-colors",
                    on && "bg-accent/[0.08]",
                  )}
                >
                  {multi && (
                    <span
                      className={cn(
                        "w-[18px] h-[18px] shrink-0 rounded-[5px] border grid place-items-center transition-colors",
                        on
                          ? "border-accent/60 bg-accent/80 text-white"
                          : "border-line",
                      )}
                    >
                      {on && <Check className="w-3 h-3" strokeWidth={3} />}
                    </span>
                  )}
                  <div className="w-9 h-9 shrink-0 rounded-[8px] overflow-hidden bg-text-primary/[0.06] grid place-items-center">
                    {h.image_url ? (
                      <img
                        src={h.image_url}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <KIND_ICON_EL kind={h.kind} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold whitespace-normal break-words leading-snug">
                      {h.label}
                    </div>
                    <div className="text-[11px] text-text-faint whitespace-normal break-words">
                      {h.sub}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </AnchoredDropdown>
      </div>

      {/* Step 3 (multi only) — the batch tray. Selections survive changing the
          search term and the kind, so one basket can mix bases and bundles. */}
      {multi && selected.length > 0 && (
        <div className="glass rounded-[11px] border border-accent/25 p-2.5 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {selected.map((h) => (
              <div
                key={`${h.kind}:${h.id}`}
                className="inline-flex items-start gap-1.5 max-w-full min-h-7 py-1 pl-2.5 pr-1.5 rounded-[8px] bg-accent/[0.1] border border-accent/30 text-[12px] text-text-primary"
              >
                <ExpandableText
                  text={h.label}
                  className="min-w-0 w-auto flex-1 text-[12px]"
                />
                <button
                  type="button"
                  aria-label={`Remove ${h.label}`}
                  onClick={() => toggle(h)}
                  className="shrink-0 text-text-muted hover:text-danger"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setSelected([])}
              className="text-[11px] text-text-muted hover:text-text-primary"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={commit}
              className="inline-flex items-center gap-1.5 px-3 h-8 rounded-[9px] text-[12px] font-semibold bg-accent/80 text-white hover:bg-accent transition-colors"
            >
              {addLabel} {selected.length}
            </button>
          </div>
        </div>
      )}

      {!kind && (
        <p className="text-[11px] text-text-faint">
          Choose Base, Styled or Bundle — then the search box unlocks.
          {multi && " Tick as many as you need, then add them all at once."}
        </p>
      )}
    </div>
  );
}
