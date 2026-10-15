import { useRef, useState } from "react";
import { FolderPlus, Plus, Check, Search } from "lucide-react";
import {
  useCollections,
  useAddCollectionMember,
  useRemoveCollectionMember,
  useCreateCollection,
  type StyledCollectionMembership,
} from "@/lib/catalogue";
import { AnchoredDropdown } from "@/components/ui/AnchoredDropdown";
import { MembershipChip } from "./MembershipChip";

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** One removable "in this collection" pill. Each owns its own remove mutation
 *  (the hook is keyed by collection id), so mapping over memberships is safe. */
function CollectionChip({
  styledId,
  m,
}: {
  styledId: string;
  m: StyledCollectionMembership;
}) {
  const remove = useRemoveCollectionMember(m.collection_id);
  return (
    <MembershipChip
      label={m.name}
      hidden={!m.is_visible_storefront}
      busy={remove.isPending}
      onRemove={() => remove.mutate(styledId)}
      removeLabel="Remove from"
    />
  );
}

/**
 * Quick add-to-collection from a STYLED product. Collections curate finished,
 * sellable listings (styled products) — never base products. Search existing
 * collections and add in one click; if it doesn't exist yet, create it inline
 * and the styled product lands in it immediately.
 *
 * `current` is the collections this product already belongs to — shown as
 * removable chips (and flagged in the list) so the operator can see where it
 * lives and take it out without hunting through every collection.
 */
export function AddToCollection({
  styledId,
  current = [],
}: {
  styledId: string;
  current?: StyledCollectionMembership[];
}) {
  const collections = useCollections();
  const addMember = useAddCollectionMember();
  const createCollection = useCreateCollection();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  const memberIds = new Set(current.map((c) => c.collection_id));
  const all = (collections.data ?? []).filter((c) => c.is_active);
  const term = q.trim().toLowerCase();
  const matches = term
    ? all.filter((c) => c.name.toLowerCase().includes(term))
    : all;
  const exact = all.some((c) => c.name.toLowerCase() === term);
  const busy = addMember.isPending || createCollection.isPending;

  const add = (collectionId: string, name: string) => {
    addMember.mutate(
      { collectionId, styledId },
      {
        onSuccess: () => {
          setDone(name);
          setQ("");
          setOpen(false);
        },
      },
    );
  };

  const createAndAdd = () => {
    const name = q.trim();
    if (!name) return;
    createCollection.mutate(
      { name, slug: slugify(name) },
      { onSuccess: (c) => add(c.collection_id, c.name) },
    );
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2 mb-2">
        <FolderPlus className="w-4 h-4 text-accent-glow" />
        <span className="micro">Add to collection</span>
      </div>

      {current.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {current.map((m) => (
            <CollectionChip key={m.collection_id} styledId={styledId} m={m} />
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
          placeholder={
            current.length ? "Add to another collection…" : "Search or create a collection…"
          }
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
        mobileMinWidth={300}
      >
        {matches.map((c) => {
          const inIt = memberIds.has(c.collection_id);
          return (
            <button
              key={c.collection_id}
              type="button"
              disabled={busy || inIt}
              onClick={() => add(c.collection_id, c.name)}
              className="w-full min-h-11 px-[13px] py-2.5 text-left text-[13px] text-text-primary whitespace-normal transition-colors hover:bg-text-primary/[0.06] disabled:opacity-60 disabled:hover:bg-transparent flex items-center justify-between gap-2"
            >
              <span className="min-w-0 flex-1 whitespace-normal break-words">{c.name}</span>
              {inIt && (
                <span className="shrink-0 flex items-center gap-1 text-[10.5px] text-success">
                  <Check className="w-3.5 h-3.5" /> added
                </span>
              )}
            </button>
          );
        })}
        {term && !exact && (
          <button
            type="button"
            disabled={busy}
            onClick={createAndAdd}
            className="w-full px-[13px] py-2 text-left text-[13px] text-accent-glow font-semibold transition-colors hover:bg-text-primary/[0.06] disabled:opacity-50 flex items-center gap-1.5 border-t hairline"
          >
            <Plus className="w-3.5 h-3.5" /> Create “{q.trim()}” &amp; add
          </button>
        )}
        {!matches.length && !term && (
          <div className="px-[13px] py-3 text-[12.5px] text-text-faint">
            No collections yet — type a name to create one.
          </div>
        )}
      </AnchoredDropdown>
    </div>
  );
}
