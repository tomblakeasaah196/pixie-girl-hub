import { useRef, useState } from "react";
import { Gift, Check, Search } from "lucide-react";
import {
  useBundles,
  useAddStyledToBundle,
  useRemoveBundleComponent,
  type StyledBundleMembership,
} from "@/lib/catalogue";
import { AnchoredDropdown } from "@/components/ui/AnchoredDropdown";
import { MembershipChip } from "./MembershipChip";

/** One removable "in this bundle" pill. Removal is by component id
 *  (bundle_product_id), so each chip carries its own remove mutation. */
function BundleChip({ m }: { m: StyledBundleMembership }) {
  const remove = useRemoveBundleComponent(m.bundle_id);
  return (
    <MembershipChip
      label={m.display_name}
      hidden={!m.is_visible_storefront}
      busy={remove.isPending}
      onRemove={() => remove.mutate(m.bundle_product_id)}
      removeLabel="Remove from"
    />
  );
}

/**
 * Quick add-to-bundle from a STYLED product. `current` is the bundles this
 * product is already a component of — shown as removable chips (and flagged in
 * the list) so the operator can see and undo membership in place.
 */
export function AddToBundle({
  styledId,
  current = [],
}: {
  styledId: string;
  current?: StyledBundleMembership[];
}) {
  const bundles = useBundles();
  const addStyled = useAddStyledToBundle();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  const memberIds = new Set(current.map((b) => b.bundle_id));
  const all = (bundles.data ?? []).filter((b) => b.is_active);
  const term = q.trim().toLowerCase();
  const matches = term
    ? all.filter((b) => b.display_name.toLowerCase().includes(term))
    : all;
  const busy = addStyled.isPending;

  const add = (bundleId: string, name: string) => {
    addStyled.mutate(
      { bundleId, styledId },
      {
        onSuccess: () => {
          setDone(name);
          setQ("");
          setOpen(false);
        },
      },
    );
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2 mb-2">
        <Gift className="w-4 h-4 text-accent-glow" />
        <span className="micro">Add to bundle</span>
      </div>

      {current.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {current.map((m) => (
            <BundleChip key={m.bundle_product_id} m={m} />
          ))}
        </div>
      )}

      <div className="relative" ref={anchorRef}>
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint pointer-events-none" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setDone(null);
          }}
          onFocus={() => setOpen(true)}
          placeholder={current.length ? "Add to another bundle…" : "Search bundles…"}
          className="w-full h-[40px] pl-9 pr-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
        />
      </div>

      {done && (
        <p className="text-[11.5px] text-success mt-1.5 flex items-center gap-1">
          <Check className="w-3.5 h-3.5" /> Added to {done}
        </p>
      )}

      <AnchoredDropdown
        anchorRef={anchorRef}
        open={open}
        onClose={() => setOpen(false)}
        maxHeight={260}
      >
        {matches.map((b) => {
          const inIt = memberIds.has(b.bundle_id);
          return (
            <button
              key={b.bundle_id}
              type="button"
              disabled={busy || inIt}
              onClick={() => add(b.bundle_id, b.display_name)}
              className="w-full px-[13px] py-2 text-left text-[13px] text-text-primary transition-colors hover:bg-text-primary/[0.06] disabled:opacity-60 disabled:hover:bg-transparent flex items-center justify-between gap-2"
            >
              <span className="truncate">{b.display_name}</span>
              {inIt && (
                <span className="shrink-0 flex items-center gap-1 text-[10.5px] text-success">
                  <Check className="w-3.5 h-3.5" /> added
                </span>
              )}
            </button>
          );
        })}
        {!matches.length && (
          <div className="px-[13px] py-3 text-[12.5px] text-text-faint">
            {term ? "No matching bundles." : "No active bundles yet."}
          </div>
        )}
      </AnchoredDropdown>
    </div>
  );
}
