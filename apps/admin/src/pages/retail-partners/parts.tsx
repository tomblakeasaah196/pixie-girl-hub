import { useEffect, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { Card, Pill, Skeleton, EmptyState, type Tone } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ErrorState } from "@/components/ui/controls";
import type { MovementType, PartnerStatus, SettlementStatus } from "./types";
import {
  MOVEMENT_TYPE_LABEL,
  PARTNER_STATUS_LABEL,
  SETTLEMENT_STATUS_LABEL,
} from "./types";

/* ── Tabs (module-local, mirrors the Stock module's) ──────────────── */
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

/* ── SearchBox ─────────────────────────────────────────────────────── */
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

/* ── Form bits ─────────────────────────────────────────────────────── */
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

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full px-[13px] py-2.5 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50 resize-y"
    />
  );
}

export function InfoBanner({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "p-3 rounded-[11px] text-[12px] leading-relaxed border",
        tone === "info" && "bg-info/10 border-info/20 text-info",
        tone === "warn" && "bg-warn/10 border-warn/25 text-warn",
      )}
    >
      {children}
    </div>
  );
}

/* ── Status pills ──────────────────────────────────────────────────── */
const PARTNER_TONE: Record<PartnerStatus, Tone> = {
  pending_approval: "warn",
  active: "success",
  suspended: "danger",
  terminated: "neutral",
};

export function PartnerStatusPill({ status }: { status: PartnerStatus }) {
  return (
    <Pill tone={PARTNER_TONE[status] ?? "neutral"}>
      {PARTNER_STATUS_LABEL[status] ?? status}
    </Pill>
  );
}

const SETTLEMENT_TONE: Record<SettlementStatus, Tone> = {
  draft: "neutral",
  reviewed: "info",
  approved: "success",
  invoiced: "info",
  paid: "accent",
  disputed: "danger",
  closed: "neutral",
};

export function SettlementStatusPill({ status }: { status: SettlementStatus }) {
  return (
    <Pill tone={SETTLEMENT_TONE[status] ?? "neutral"}>
      {SETTLEMENT_STATUS_LABEL[status] ?? status}
    </Pill>
  );
}

const MOVEMENT_TONE: Record<MovementType, Tone> = {
  dispatch_to_partner: "info",
  partner_sale: "success",
  partner_return: "warn",
  partner_damage: "danger",
  partner_count_adjustment: "neutral",
  recall_to_warehouse: "accent",
};

export function MovementTypePill({ type }: { type: MovementType }) {
  return (
    <Pill tone={MOVEMENT_TONE[type] ?? "neutral"}>
      {MOVEMENT_TYPE_LABEL[type] ?? type}
    </Pill>
  );
}

/* ── Pagination (client-side — the module's endpoints don't paginate) ── */
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
    <div className="flex items-center justify-between px-4 py-1 text-[12px] text-text-muted">
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

/* ── ResponsiveTable ───────────────────────────────────────────────────
   Canon: tables collapse to stacked cards on mobile (question-gate Q13).
   Desktop (sm+) renders the shared DataTable; mobile renders `card(row)`
   stacked in a glass Card. Client-side pagination + the four states
   (loading / empty / error handled here; permission-denied at page level). */
export function ResponsiveTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  loading,
  error,
  onRetry,
  empty,
  card,
  pageSize = 25,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  loading: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty: { icon: ReactNode; title: string; message?: string; action?: ReactNode };
  card: (row: T) => ReactNode;
  pageSize?: number;
}) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);

  if (error) {
    return (
      <ErrorState message={(error as Error)?.message} onRetry={onRetry} />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Desktop / tablet */}
      <div className="hidden sm:block">
        <DataTable<T>
          columns={columns}
          rows={pageRows}
          rowKey={rowKey}
          onRowClick={onRowClick}
          loading={loading}
          empty={empty}
        />
      </div>

      {/* Mobile — stacked cards */}
      <div className="sm:hidden">
        <Card className="overflow-hidden">
          {loading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-2 py-2">
                  <Skeleton className="w-2/3" />
                  <Skeleton className="w-1/2" />
                </div>
              ))}
            </div>
          ) : pageRows.length === 0 ? (
            <EmptyState
              icon={empty.icon}
              title={empty.title}
              message={empty.message}
              action={empty.action}
            />
          ) : (
            <div className="divide-y divide-[rgb(var(--text)/0.06)]">
              {pageRows.map((row) =>
                onRowClick ? (
                  <button
                    key={rowKey(row)}
                    onClick={() => onRowClick(row)}
                    className="block w-full text-left p-4 min-h-[44px] hover:bg-text-primary/[0.035] transition-colors"
                  >
                    {card(row)}
                  </button>
                ) : (
                  <div key={rowKey(row)} className="p-4">
                    {card(row)}
                  </div>
                ),
              )}
            </div>
          )}
        </Card>
      </div>

      {!loading && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={rows.length}
          onChange={setPage}
        />
      )}
    </div>
  );
}

/* ── Small display helpers ─────────────────────────────────────────── */
export function MicroLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-text-faint">
      {children}
    </div>
  );
}

export function VariantCell({
  sku,
  name,
  fallbackId,
}: {
  sku: string | null;
  name: string | null;
  fallbackId: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[13px] text-text-primary font-medium truncate max-w-[220px]">
        {name || sku || `${fallbackId.slice(0, 8)}…`}
      </span>
      {sku && (
        <span className="text-[11px] text-text-faint font-mono">{sku}</span>
      )}
    </div>
  );
}
