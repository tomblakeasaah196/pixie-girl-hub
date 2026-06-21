import { useEffect, useRef, useState } from "react";
import { FolderPlus, Plus, Check, Search } from "lucide-react";
import {
  useCollections,
  useAddCollectionMember,
  useCreateCollection,
} from "@/lib/catalogue";

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Quick add-to-collection from a STYLED product. Collections curate finished,
 * sellable listings (styled products) — never base products. Search existing
 * collections and add in one click; if it doesn't exist yet, create it inline
 * and the styled product lands in it immediately.
 */
export function AddToCollection({ styledId }: { styledId: string }) {
  const collections = useCollections();
  const addMember = useAddCollectionMember();
  const createCollection = useCreateCollection();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

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
    <div ref={ref} className="relative">
      <div className="flex items-center gap-2 mb-2">
        <FolderPlus className="w-4 h-4 text-accent-glow" />
        <span className="micro">Add to collection</span>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint pointer-events-none" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setDone(null);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search or create a collection…"
          className="w-full h-[40px] pl-9 pr-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
        />
      </div>

      {done && (
        <p className="text-[11.5px] text-success mt-1.5 flex items-center gap-1">
          <Check className="w-3.5 h-3.5" /> Added to {done}
        </p>
      )}

      {open && (
        <div className="select-dropdown-list absolute z-50 top-[calc(100%+4px)] left-0 right-0 rounded-[11px] overflow-hidden py-1 max-h-[260px] overflow-y-auto">
          {matches.map((c) => (
            <button
              key={c.collection_id}
              type="button"
              disabled={busy}
              onClick={() => add(c.collection_id, c.name)}
              className="w-full px-[13px] py-2 text-left text-[13px] text-text-primary transition-colors hover:bg-text-primary/[0.06] disabled:opacity-50"
            >
              {c.name}
            </button>
          ))}
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
        </div>
      )}
    </div>
  );
}
