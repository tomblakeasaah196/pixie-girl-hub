import { type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Card, Skeleton, EmptyState } from "./primitives";

/**
 * The workhorse list surface (canon §5). Server-driven in real use
 * (pagination/sort/filter/search sent to the API); here it renders a column
 * config + rows and the four states.
 *
 * Responsive behaviour (canon: "responsive→cards"):
 *  • ≥ `sm` (640px) the column table renders as usual — rows tighten up on the
 *    desktop tier (≥1024px) for more density.
 *  • On phones, render a stacked card per row instead of making the table
 *    the only way to reach columns off-screen. Callers may provide `mobileCard`
 *    for a bespoke layout; otherwise every column is shown with its header as
 *    a label. The dense table remains available from the small/tablet tier up.
 */
export interface Column<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  width?: string;
  render: (row: T) => ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  loading,
  empty,
  toolbar,
  activeKey,
  mobileCard,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  empty?: {
    icon: ReactNode;
    title: string;
    message?: string;
    action?: ReactNode;
  };
  toolbar?: ReactNode;
  /** Row to visually highlight — for keyboard focus + return-from-detail. */
  activeKey?: string | null;
  /**
   * Optional phone renderer. Phones (< `sm`) always show stacked cards;
   * provide this to customize a row, otherwise columns render with labels.
   * The card sits inside a tap target that fires `onRowClick`.
   */
  mobileCard?: (row: T) => ReactNode;
}) {
  return (
    <Card className="min-w-0 max-w-full overflow-hidden">
      {toolbar && (
        <div className="flex items-center gap-2 p-[14px_18px] border-b hairline flex-wrap">
          {toolbar}
        </div>
      )}

      {/* Desktop / tablet — the column table. Hidden on phones when a card
          renderer is available so the layout never scrolls sideways. */}
      <div className="hidden min-w-0 overflow-x-auto sm:block">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={{ width: c.width, textAlign: c.align ?? "left" }}
                  className="micro p-[12px_18px] lg:p-[9px_16px] border-b hairline bg-text-primary/[0.02]"
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className="p-[0_18px] lg:px-4 h-[54px] lg:h-[44px] border-b hairline"
                    >
                      <Skeleton className="w-3/4" />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading &&
              rows.map((row) => {
                const k = rowKey(row);
                const isActive = activeKey === k;
                return (
                <tr
                  key={k}
                  data-row-key={k}
                  onClick={() => onRowClick?.(row)}
                  className={cn(
                    "border-b hairline last:border-0 transition-colors",
                    onRowClick &&
                      "cursor-pointer hover:bg-text-primary/[0.035]",
                    isActive && "bg-accent/[0.10] ring-1 ring-inset ring-accent/40",
                  )}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      style={{ textAlign: c.align ?? "left" }}
                      className="p-[0_18px] lg:px-4 h-[54px] lg:h-[44px] text-[13px] align-middle"
                    >
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* Phone — a stacked list of tap-friendly cards. The default renderer
          keeps every value reachable; column renderers can still use compact
          chips, actions or ExpandableText without being forced into a table. */}
      <div className="min-w-0 sm:hidden">
        {loading &&
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="p-4 border-b hairline last:border-0">
              <Skeleton className="w-2/3 mb-2" />
              <Skeleton className="w-1/3" />
            </div>
          ))}
        {!loading &&
          rows.map((row) => {
            const k = rowKey(row);
            const isActive = activeKey === k;
            return (
              <div
                key={k}
                data-row-key={k}
                role={onRowClick ? "button" : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={(event) => {
                  const target = event.target as HTMLElement;
                  const interactive = target.closest(
                    "button, a, input, select, textarea, [role='button']",
                  );
                  if (interactive && interactive !== event.currentTarget) return;
                  onRowClick?.(row);
                }}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (onRowClick && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    onRowClick(row);
                  }
                }}
                className={cn(
                  "min-w-0 p-4 border-b hairline last:border-0 transition-colors",
                  onRowClick && "cursor-pointer active:bg-text-primary/[0.05]",
                  isActive && "bg-accent/[0.10]",
                )}
              >
                {mobileCard ? (
                  mobileCard(row)
                ) : (
                  <dl className="min-w-0 space-y-2.5">
                    {columns.map((column, index) => (
                      <div key={column.key} className="grid min-w-0 grid-cols-[minmax(5rem,0.8fr)_minmax(0,1.6fr)] items-start gap-3">
                        <dt className="min-w-0 text-[11px] leading-snug text-text-faint whitespace-normal break-words">
                          {column.header}
                        </dt>
                        <dd className={cn("data-table-mobile-value min-w-0 text-[13px] leading-snug whitespace-normal break-words", index === 0 && "font-medium text-text-primary")}>
                          {column.render(row)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            );
          })}
      </div>

      {!loading && rows.length === 0 && empty && (
        <EmptyState
          icon={empty.icon}
          title={empty.title}
          message={empty.message}
          action={empty.action}
        />
      )}
    </Card>
  );
}
