import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Plus, CornerDownLeft } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUiStore } from "@/stores/ui";
import { MODULES } from "@/lib/modules";

/**
 * ⌘K command palette (canon §3.2/§3.4) — one of the most important elements:
 * fast navigation + find. Searches apps + quick actions (records would join
 * via the search API). Arrow/Enter nav; Esc/scrim close.
 */
const QUICK = [
  { label: "New order", to: "/sales", where: "Sales" },
  { label: "Create invoice", to: "/invoicing", where: "Invoicing" },
  { label: "Add contact", to: "/contacts", where: "Contacts" },
  { label: "Record payment", to: "/sales", where: "Sales" },
];

export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open]);

  const results = useMemo(() => {
    const t = q.toLowerCase().trim();
    const quick = QUICK.filter((a) => !t || a.label.toLowerCase().includes(t)).map((a) => ({ ...a, kind: "quick" as const }));
    const apps = MODULES.filter((m) => !t || m.label.toLowerCase().includes(t) || m.description.toLowerCase().includes(t))
      .slice(0, 7)
      .map((m) => ({ label: m.label, to: m.route, where: m.description, icon: m.icon, kind: "app" as const }));
    return [...quick, ...apps];
  }, [q]);

  function go(i: number) {
    const r = results[i];
    if (!r) return;
    setOpen(false);
    navigate(r.to);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
      if (e.key === "Enter") { e.preventDefault(); go(sel); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, results, sel]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[91] bg-black/50 backdrop-blur-[3px] animate-fade-in" onClick={() => setOpen(false)} />
      <div className="fixed top-[14vh] left-1/2 -translate-x-1/2 w-[min(560px,94vw)] max-h-[66vh] z-[92] rounded-[18px] overflow-hidden flex flex-col dropglass animate-fade-in">
        <div className="flex items-center gap-3 p-[16px_18px] border-b hairline">
          <Search className="w-[18px] text-text-faint" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            placeholder="Search apps, orders, customers, settings…"
            className="flex-1 bg-transparent border-0 outline-none text-base text-text-primary"
          />
          <kbd className="font-mono text-[10px] text-text-faint">esc</kbd>
        </div>
        <div className="overflow-y-auto p-2">
          {results.length === 0 && <div className="p-6 text-center text-text-faint">No matches for “{q}”.</div>}
          {results.map((r, i) => {
            const Icon = "icon" in r && r.icon ? r.icon : null;
            return (
              <div
                key={`${r.kind}-${r.label}-${i}`}
                onMouseEnter={() => setSel(i)}
                onClick={() => go(i)}
                className={cn("flex items-center gap-3 p-[10px_12px] rounded-[11px] cursor-pointer", sel === i && "bg-accent/10")}
              >
                <span className="w-8 h-8 rounded-[9px] grid place-items-center text-accent-glow bg-accent/10">
                  {Icon ? <Icon className="w-[17px] h-[17px]" /> : <Plus className="w-[17px] h-[17px]" />}
                </span>
                <span className="flex-1">
                  <span className="block font-semibold text-[13.5px]">{r.label}</span>
                  <span className="block text-[11px] text-text-faint">{r.kind === "quick" ? `in ${r.where}` : r.where}</span>
                </span>
                {sel === i && <CornerDownLeft className="w-3.5 h-3.5 text-text-faint" />}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
