import { type ReactNode } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { Pill, type Tone } from "@/components/ui/primitives";

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

const MOVEMENT_TONE: Record<string, Tone> = {
  receive: "success",
  sale: "danger",
  reserve: "warn",
  release_reserve: "warn",
  adjustment_in: "info",
  adjustment_out: "warn",
  transfer_in: "info",
  transfer_out: "info",
  write_off: "danger",
  damage: "danger",
  production_in: "success",
  production_out: "warn",
  return: "accent",
  sample: "neutral",
  theft_writeoff: "danger",
  consignment_out: "info",
  consignment_return: "info",
};

export function MovementTypePill({ type }: { type: string }) {
  const tone = MOVEMENT_TONE[type] ?? "neutral";
  return <Pill tone={tone}>{type.replace(/_/g, " ")}</Pill>;
}

const STATUS_TONE: Record<string, Tone> = {
  draft: "neutral",
  submitted: "info",
  approved: "success",
  posted: "accent",
  rejected: "danger",
  cancelled: "danger",
  dispatched: "info",
  in_transit: "info",
  received: "success",
  pending: "neutral",
  open: "warn",
  acknowledged: "info",
  dismissed: "neutral",
  resolved: "success",
  in_production: "neutral",
  quality_check: "info",
  ready_to_ship: "info",
  arrived_lagos: "info",
  cleared_customs: "success",
};

export function StatusPill({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? "neutral";
  return <Pill tone={tone}>{status.replace(/_/g, " ")}</Pill>;
}

const LOCATION_TYPE_TONE: Record<string, Tone> = {
  warehouse: "info",
  amazon_fba: "accent",
  salon: "success",
  showroom: "info",
  retail_counter: "success",
  partner_consignment: "warn",
  in_transit: "neutral",
  production: "neutral",
  reserved_holding: "neutral",
};

export function LocationTypePill({ type }: { type: string }) {
  const tone = LOCATION_TYPE_TONE[type] ?? "neutral";
  return <Pill tone={tone}>{type.replace(/_/g, " ")}</Pill>;
}

const SEVERITY_TONE: Record<string, Tone> = {
  critical: "danger",
  high: "danger",
  medium: "warn",
  low: "info",
};

export function SeverityPill({ severity }: { severity: string }) {
  const tone = SEVERITY_TONE[severity] ?? "neutral";
  return <Pill tone={tone}>{severity}</Pill>;
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label className="block text-[12px] font-semibold text-text-muted uppercase tracking-wide mb-1.5">
      {children}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  required,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      disabled={disabled}
      className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50 disabled:opacity-50"
    />
  );
}

export function InfoBanner({ children }: { children: ReactNode }) {
  return (
    <div className="p-3 rounded-[11px] bg-info/10 border border-info/20 text-[12px] text-info leading-relaxed">
      {children}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-4 py-3 text-[12px] text-text-muted">
      <span>{total} total</span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          className="px-2.5 py-1 rounded-lg border border-line hover:bg-text-primary/[0.06] disabled:opacity-30"
        >
          Prev
        </button>
        <span className="px-2 tabular-nums">
          {page} / {totalPages}
        </span>
        <button
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
          className="px-2.5 py-1 rounded-lg border border-line hover:bg-text-primary/[0.06] disabled:opacity-30"
        >
          Next
        </button>
      </div>
    </div>
  );
}

export function TableSkeleton({
  cols = 5,
  rows = 6,
}: {
  cols?: number;
  rows?: number;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i}>
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} className="p-[0_18px] h-[54px] border-b hairline">
              <div
                className="h-3 w-3/4 rounded bg-text-primary/[0.08] animate-shimmer"
                style={{
                  backgroundSize: "400% 100%",
                  background:
                    "linear-gradient(90deg, rgb(var(--text)/.05) 25%, rgb(var(--text)/.1) 37%, rgb(var(--text)/.05) 63%)",
                }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
