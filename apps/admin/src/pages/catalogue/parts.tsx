import { type ReactNode } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { Pill, type Tone } from "@/components/ui/primitives";
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
    <div className="relative flex-1 min-w-[180px] max-w-[340px]">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint pointer-events-none" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-10 pl-9 pr-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
      />
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
