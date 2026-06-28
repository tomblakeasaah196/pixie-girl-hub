import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Megaphone } from "lucide-react";
import { useCampaignList, type Campaign } from "@/lib/campaigns";
import { Button } from "@/components/ui/primitives";

/** Desktop panel width (w-72). Phones clamp to the viewport. */
const PANEL_W = 288;

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
 *
 * The panel is portalled to <body> with fixed positioning so it is never
 * clipped by an ancestor's `overflow-hidden` — the case that hid it on mobile
 * when this lived in the bundle editor modal's footer. It flips above the
 * trigger when there isn't room below and clamps to the viewport on phones.
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
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const campaigns = useCampaignList({ q: q || undefined });

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
  }, []);

  const reposition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const m = 8; // viewport margin
    const width = Math.min(PANEL_W, vw - m * 2);
    // Right-align to the trigger, then clamp inside the viewport.
    const left = Math.min(Math.max(r.right - width, m), vw - width - m);
    const below = vh - r.bottom - m;
    const above = r.top - m;
    // Flip above only when below is genuinely tight and above has more room.
    const up = below < 240 && above > below;
    const maxHeight = Math.max(180, Math.min(420, (up ? above : below) - 6));
    setStyle({
      position: "fixed",
      left,
      width,
      maxHeight,
      ...(up ? { bottom: vh - r.top + 6 } : { top: r.bottom + 6 }),
    });
  }, []);

  // Position before paint so the panel never flashes in the wrong spot.
  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => reposition();
    // capture:true so scrolling an inner container (e.g. a modal body) counts.
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        !triggerRef.current?.contains(t) &&
        !panelRef.current?.contains(t)
      ) {
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, reposition, close]);

  const items = campaigns.data?.data ?? [];

  return (
    <div ref={triggerRef} className="relative">
      <Button
        size="sm"
        icon={<Megaphone className="w-3.5 h-3.5" />}
        disabled={disabled || busy}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <ChevronDown className="w-3 h-3 ml-0.5 opacity-70" />
      </Button>

      {open &&
        style &&
        createPortal(
          <div
            ref={panelRef}
            style={style}
            className="z-[120] dropglass rounded-[var(--radius)] p-2 flex flex-col"
          >
            <input
              autoFocus
              placeholder="Search campaigns…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full h-9 px-3 mb-2 rounded-[9px] bg-text-primary/[0.06] border border-line text-[13px] text-text-primary outline-none focus:border-accent/50 shrink-0"
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
              <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5 -mr-1 pr-1">
                {items.map((c) => (
                  <button
                    key={c.campaign_id}
                    onClick={() => {
                      onSelect(c);
                      close();
                    }}
                    className="w-full text-left px-3 py-2.5 rounded-[9px] hover:bg-text-primary/[0.07] active:bg-text-primary/[0.07] transition-colors group"
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
          </div>,
          document.body,
        )}
    </div>
  );
}
