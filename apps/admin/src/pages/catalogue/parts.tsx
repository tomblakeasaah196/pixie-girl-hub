import { useState, type ReactNode } from "react";
import { Search, Maximize2, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Pill, type Tone } from "@/components/ui/primitives";
import { Lightbox } from "@/components/ui/Lightbox";
import type { Availability, StyledStatus } from "@/lib/catalogue";

/**
 * Shared Catalogue UI atoms: a glass segmented tab bar, the production-framed
 * availability pill (P0-7), the styled lifecycle badge, and a search box —
 * all built from the locked primitives (tokens only, no literal colours).
 */

/* ── Segmented tabs ─────────────────────────────────────── */
export interface TabDef {
  key: string;
  label: string;
  count?: number;
}
export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div
      className="flex gap-1 p-1 rounded-[13px] glass shadow-glass overflow-x-auto"
      role="tablist"
    >
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={cn(
              "inline-flex items-center gap-2 px-3.5 h-9 rounded-[10px] text-[13px] font-semibold whitespace-nowrap transition-all",
              on
                ? "bg-accent-deep text-[#F4E9D9] shadow-[0_6px_18px_rgb(var(--accent-deep)/0.4)]"
                : "text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05]",
            )}
          >
            {t.label}
            {t.count != null && (
              <span
                className={cn(
                  "text-[10.5px] tabular-nums px-1.5 py-0.5 rounded-full",
                  on
                    ? "bg-black/20 text-[#F4E9D9]"
                    : "bg-text-primary/[0.08] text-text-faint",
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── Availability pill (production-framed pre-order, P0-7) ── */
export function AvailabilityPill({
  availability,
}: {
  availability?: Availability;
}) {
  if (!availability) return <Pill tone="neutral">—</Pill>;
  if (availability.state === "in_stock") {
    return <Pill tone="success">In stock · {availability.available}</Pill>;
  }
  if (availability.state === "preorder") {
    // Production-framed copy from the server (China factory wording).
    return <Pill tone="info">{availability.message ?? "In production"}</Pill>;
  }
  return <Pill tone="danger">Out of stock</Pill>;
}

/* ── Styled lifecycle badge ─────────────────────────────── */
const STATUS_TONE: Record<StyledStatus, Tone> = {
  draft: "warn",
  live: "success",
  archived: "neutral",
};
const STATUS_LABEL: Record<StyledStatus, string> = {
  draft: "Draft",
  live: "Live",
  archived: "Archived",
};
export function StyledStatusBadge({ status }: { status: StyledStatus }) {
  return <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>;
}

/* ── Search box ─────────────────────────────────────────── */
export function SearchBox({
  value,
  onChange,
  placeholder = "Search…",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative min-w-0 w-full sm:flex-1 sm:min-w-[180px] max-w-[340px]">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint pointer-events-none" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-10 pl-9 pr-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
      />
    </div>
  );
}

/* ── Clickable card shell ───────────────────────────────── */
/**
 * The card/row surface for the catalogue grids. A `div role="button"` rather
 * than a real `<button>` so the image's "view full screen" control can live
 * inside it — nesting one button in another is invalid HTML, and the expand
 * control has to sit over the picture to be discoverable.
 */
export function CardShell({
  onOpen,
  className,
  elRef,
  children,
}: {
  onOpen: () => void;
  className?: string;
  elRef?: (el: HTMLDivElement | null) => void;
  children: ReactNode;
}) {
  return (
    <div
      ref={elRef}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn("cursor-pointer", className)}
    >
      {children}
    </div>
  );
}

/* ── Card image + full-screen viewer ────────────────────── */
/**
 * Product picture with an expand control so staff (and customers over their
 * shoulder) can see the hair properly. The control stops propagation so
 * opening the image never navigates to the product page.
 */
export function CardImage({
  url,
  name,
  variant = "card",
  className,
}: {
  url?: string | null;
  name?: string | null;
  /** `card` = 4:3 bleed header in the grid; `thumb` = list-row square. */
  variant?: "card" | "thumb";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const isCard = variant === "card";
  return (
    <div
      className={cn(
        "relative overflow-hidden bg-text-primary/[0.04]",
        isCard
          ? "aspect-[4/3] -mx-4 -mt-4 mb-3 rounded-t-[var(--radius)]"
          : "w-16 h-16 shrink-0 rounded-[10px]",
        className,
      )}
    >
      {url ? (
        <>
          <img
            src={url}
            alt={name ?? "Product image"}
            loading="lazy"
            className="w-full h-full object-cover"
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") e.stopPropagation();
            }}
            aria-label={`View ${name ?? "product image"} full screen`}
            title="View full screen"
            className={cn(
              // Heavy glass, not `glass` — this chip sits over photography and
              // has to stay legible against a bright frame.
              "absolute grid place-items-center rounded-full dropglass text-text-primary transition-all",
              "hover:bg-accent-deep hover:text-[#F4E9D9] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              isCard ? "top-2 right-2 w-8 h-8" : "bottom-0.5 right-0.5 w-5 h-5",
            )}
          >
            <Maximize2 className={isCard ? "w-4 h-4" : "w-3 h-3"} />
          </button>
        </>
      ) : (
        <div className="w-full h-full grid place-items-center text-text-faint">
          <ImageIcon className={isCard ? "w-7 h-7" : "w-5 h-5"} />
        </div>
      )}
      {/* The lightbox portals to <body>, but React still bubbles its events up
          this tree — without the guard, clicking the backdrop to close would
          also fire the card's navigate. The wrapper renders no DOM of its own
          beyond an empty div, so it costs nothing in layout. */}
      {open && url && (
        <div
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Lightbox url={url} name={name} onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

/* ── Card grid wrapper ──────────────────────────────────── */
export function CardGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {children}
    </div>
  );
}

/* ── Card skeletons (loading state matches the grid) ─────── */
export function CardGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <CardGrid>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="glass rounded-[var(--radius)] shadow-glass p-4 h-[148px] animate-pulse"
        >
          <div className="h-3 w-16 rounded bg-text-primary/[0.08] mb-3" />
          <div className="h-4 w-3/4 rounded bg-text-primary/[0.1] mb-2" />
          <div className="h-3 w-1/2 rounded bg-text-primary/[0.07]" />
        </div>
      ))}
    </CardGrid>
  );
}
