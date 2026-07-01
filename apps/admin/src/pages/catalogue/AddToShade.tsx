import { useEffect, useRef, useState } from "react";
import { Palette, Plus, Check, Search } from "lucide-react";
import {
  useShades,
  useAssignShadeMembers,
  useCreateShade,
} from "@/lib/catalogue";

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Quick add-to-shade from a STYLED product — the reverse of the Shades tab's
 * bulk picker. A styled product carries exactly one shade (its shade_id), so
 * this *re-homes* it: search an existing shade and assign in one click, or
 * create one inline. Together with the Shades tab this is what lets the
 * storefront "shop by shade" — every styled product can be placed in its colour
 * from either side.
 */
export function AddToShade({
  styledId,
  currentShadeId,
}: {
  styledId: string;
  currentShadeId?: string | null;
}) {
  const shades = useShades();
  const assign = useAssignShadeMembers();
  const createShade = useCreateShade();
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

  const all = (shades.data ?? []).filter((s) => s.is_active);
  const current =
    (shades.data ?? []).find((s) => s.shade_id === currentShadeId) ?? null;
  const term = q.trim().toLowerCase();
  const matches = term
    ? all.filter((s) => s.name.toLowerCase().includes(term))
    : all;
  const exact = all.some((s) => s.name.toLowerCase() === term);
  const busy = assign.isPending || createShade.isPending;

  const add = (shadeId: string, name: string) => {
    // One styled product → one shade. The bulk endpoint re-homes it for us.
    assign.mutate(
      { shadeId, styledIds: [styledId] },
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
    createShade.mutate(
      { name, slug: slugify(name) },
      { onSuccess: (sh) => add(sh.shade_id, sh.name) },
    );
  };

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-2 mb-2">
        <Palette className="w-4 h-4 text-accent-glow" />
        <span className="micro">Shop by shade</span>
      </div>

      {current && !done && (
        <p className="text-[11.5px] text-text-faint mb-1.5">
          Currently in{" "}
          <span className="text-text-primary font-semibold">
            {current.name}
          </span>
        </p>
      )}

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
          placeholder={
            current ? "Move to another shade…" : "Search or create a shade…"
          }
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
          {matches.map((s) => {
            const isCurrent = s.shade_id === currentShadeId;
            return (
              <button
                key={s.shade_id}
                type="button"
                disabled={busy || isCurrent}
                onClick={() => add(s.shade_id, s.name)}
                className="w-full px-[13px] py-2 text-left text-[13px] text-text-primary transition-colors hover:bg-text-primary/[0.06] disabled:opacity-50 flex items-center justify-between gap-2"
              >
                <span className="truncate">{s.name}</span>
                {isCurrent && (
                  <span className="text-[10.5px] text-text-faint shrink-0">
                    current
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
              No shades yet — type a name to create one.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
