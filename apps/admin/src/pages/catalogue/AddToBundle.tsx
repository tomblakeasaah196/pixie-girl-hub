import { useEffect, useRef, useState } from "react";
import { Gift, Plus, Check, Search } from "lucide-react";
import { useBundles, useAddStyledToBundle } from "@/lib/catalogue";

export function AddToBundle({ styledId }: { styledId: string }) {
  const bundles = useBundles();
  const addStyled = useAddStyledToBundle();
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
    <div ref={ref} className="relative">
      <div className="flex items-center gap-2 mb-2">
        <Gift className="w-4 h-4 text-accent-glow" />
        <span className="micro">Add to bundle</span>
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
          placeholder="Search bundles…"
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
          {matches.map((b) => (
            <button
              key={b.bundle_id}
              type="button"
              disabled={busy}
              onClick={() => add(b.bundle_id, b.display_name)}
              className="w-full px-[13px] py-2 text-left text-[13px] text-text-primary transition-colors hover:bg-text-primary/[0.06] disabled:opacity-50"
            >
              {b.display_name}
            </button>
          ))}
          {!matches.length && (
            <div className="px-[13px] py-3 text-[12.5px] text-text-faint">
              {term ? "No matching bundles." : "No active bundles yet."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
