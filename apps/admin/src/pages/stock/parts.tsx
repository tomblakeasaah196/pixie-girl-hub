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
  size = "md",
}: {
  tabs: TabDef[];
  active: string;
  onChange: (key: string) => void;
  /** "lg" gives a taller, roomier strip for a module's primary tab bar. */
  size?: "md" | "lg";
}) {
  const lg = size === "lg";
  return (
    <div
      className={cn(
        "flex gap-1 p-1 glass shadow-glass overflow-x-auto",
        lg ? "rounded-[15px] p-1.5" : "rounded-[13px]",
      )}
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
              "inline-flex items-center gap-2 rounded-[10px] font-semibold whitespace-nowrap transition-all",
              lg ? "px-4 h-11 text-[14px]" : "px-3.5 h-9 text-[13px]",
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
        autoComplete="off"
        data-lpignore="true"
        data-1p-ignore=""
        data-form-type="other"
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

interface ProductIdentity {
  product_name?: string | null;
  variant_name?: string | null;
  sku?: string | null;
}

/** Renders "Product Name" bold on top, "Variant · SKU" muted underneath —
 *  the one place a variant_id/UUID falls back into view, and only as a last
 *  resort when the backend has no name/SKU to show (e.g. a deleted product). */
export function ProductCell({
  line,
  variantId,
  className,
}: {
  line: ProductIdentity;
  variantId: string;
  className?: string;
}) {
  const product = line.product_name?.trim();
  const variant = line.variant_name?.trim();
  const sku = line.sku?.trim();
  const primary = product || variant || `Variant ${variantId.slice(0, 8)}`;
  const secondaryParts = [
    variant && variant !== primary ? variant : null,
    sku,
  ].filter(Boolean);

  return (
    <div className={cn("flex flex-col gap-0.5 min-w-0", className)}>
      <span className="text-[13px] text-text-primary font-medium truncate">
        {primary}
      </span>
      {secondaryParts.length > 0 && (
        <span className="text-[11px] text-text-faint font-mono truncate">
          {secondaryParts.join(" · ")}
        </span>
      )}
    </div>
  );
}

/** Compact "N product names" summary for register rows carrying multiple
 *  lines (a transfer, adjustment, or shipment) — never just an ID list. */
export function ProductsSummary({
  lines,
  emptyLabel = "—",
}: {
  lines: ProductIdentity[];
  emptyLabel?: string;
}) {
  if (lines.length === 0) {
    return <span className="text-[12px] text-text-faint">{emptyLabel}</span>;
  }
  const names = lines.map(
    (l) =>
      l.product_name?.trim() || l.variant_name?.trim() || "Unnamed product",
  );
  const unique = Array.from(new Set(names));
  const shown = unique.slice(0, 2).join(", ");
  const extra = unique.length - 2;
  return (
    <span className="text-[13px] text-text-primary truncate block max-w-[260px]">
      {shown}
      {extra > 0 && <span className="text-text-faint"> +{extra} more</span>}
    </span>
  );
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

/* ── SourceCell ────────────────────────────────────────────────────────
   A movement's source document in one cell: the document number on top
   (order / adjustment / transfer / shipment number, never a raw UUID), and
   the human context underneath — customer + channel for a sale, reason for
   an adjustment. "SALE −1" with no answer to "from which order?" is what
   made the ledger unreadable. */
const SOURCE_CHANNEL_LABEL: Record<string, string> = {
  pos: "POS",
  storefront: "Storefront",
  woocommerce: "WooCommerce",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  wholesale: "Wholesale",
  partner: "Partner",
  stylist_routed: "Stylist",
  public_form: "Order form",
  walk_in: "Walk-in",
};

interface MovementSource {
  reference_type?: string | null;
  reference_number?: string | null;
  customer_name?: string | null;
  sales_channel?: string | null;
  order_sales_channel?: string | null;
  adjustment_reason?: string | null;
  notes?: string | null;
}

export function SourceCell({ movement }: { movement: MovementSource }) {
  const rawChannel = movement.sales_channel || movement.order_sales_channel;
  const channel = rawChannel
    ? (SOURCE_CHANNEL_LABEL[rawChannel] ?? rawChannel.replace(/_/g, " "))
    : null;

  const primary = movement.reference_number;
  const secondary =
    [movement.customer_name, channel].filter(Boolean).join(" · ") ||
    movement.adjustment_reason ||
    movement.notes ||
    null;

  if (!primary) {
    return (
      <span className="text-[13px] text-text-muted truncate max-w-[180px] block">
        {secondary ?? "Logged manually"}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 min-w-0 max-w-[180px]">
      <span className="text-[12.5px] font-mono text-text-primary truncate">
        {primary}
      </span>
      {secondary && (
        <span className="text-[11px] text-text-faint truncate">
          {secondary}
        </span>
      )}
    </div>
  );
}
