import { useEffect, useRef, useState } from "react";
import { ChevronDown, Megaphone } from "lucide-react";
import { useCampaignList, type Campaign } from "@/lib/campaigns";
import { Button } from "@/components/ui/primitives";

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Dropdown trigger that fetches the campaign list and lets the user pick one.
 * Renders as a secondary Button with a trailing chevron; on open, shows a
 * glass panel with search + scrollable list (name · id · start date).
 */
export function CampaignPickerDropdown({
  label = "Add to campaign",
  busy,
  disabled,
  onSelect,
}: {
  label?: string;
  busy?: boolean;
  disabled?: boolean;
  onSelect: (campaign: Campaign) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const campaigns = useCampaignList({ q: q || undefined });

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQ("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const items = campaigns.data?.data ?? [];

  return (
    <div ref={ref} className="relative">
      <Button
        size="sm"
        icon={<Megaphone className="w-3.5 h-3.5" />}
        disabled={disabled || busy}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <ChevronDown className="w-3 h-3 ml-0.5 opacity-70" />
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-72 dropglass rounded-[var(--radius)] p-2">
          <input
            autoFocus
            placeholder="Search campaigns…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full h-8 px-3 mb-2 rounded-[9px] bg-text-primary/[0.06] border border-line text-[12px] text-text-primary outline-none focus:border-accent/50"
          />

          {campaigns.isLoading ? (
            <p className="py-3 text-center text-[12px] text-text-faint">
              Loading…
            </p>
          ) : items.length === 0 ? (
            <p className="py-3 text-center text-[12px] text-text-faint">
              {q ? "No campaigns match." : "No campaigns yet."}
            </p>
          ) : (
            <div className="max-h-60 overflow-y-auto space-y-0.5">
              {items.map((c) => (
                <button
                  key={c.campaign_id}
                  onClick={() => {
                    onSelect(c);
                    setOpen(false);
                    setQ("");
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-[9px] hover:bg-text-primary/[0.07] transition-colors group"
                >
                  <div className="text-[13px] font-semibold text-text-primary truncate group-hover:text-accent-glow transition-colors">
                    {c.name}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="font-mono text-[10px] text-accent-glow leading-none">
                      {c.campaign_id.slice(0, 8)}
                    </span>
                    <span className="text-[10px] text-text-faint leading-none">
                      starts {fmtDate(c.starts_at)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
