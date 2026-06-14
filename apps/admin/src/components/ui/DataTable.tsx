import { type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Card, Skeleton, EmptyState } from "./primitives";

/**
 * The workhorse list surface (canon §5). Server-driven in real use
 * (pagination/sort/filter/search sent to the API); here it renders a column
 * config + rows and the four states. Collapses to stacked cards on mobile.
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
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  empty?: { icon: ReactNode; title: string; message?: string; action?: ReactNode };
  toolbar?: ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      {toolbar && <div className="flex items-center gap-2 p-[14px_18px] border-b hairline flex-wrap">{toolbar}</div>}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={{ width: c.width, textAlign: c.align ?? "left" }}
                  className="micro p-[12px_18px] border-b hairline bg-text-primary/[0.02]"
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
                    <td key={c.key} className="p-[0_18px] h-[54px] border-b hairline">
                      <Skeleton className="w-3/4" />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading &&
              rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={() => onRowClick?.(row)}
                  className={cn(
                    "border-b hairline last:border-0 transition-colors",
                    onRowClick && "cursor-pointer hover:bg-text-primary/[0.035]",
                  )}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      style={{ textAlign: c.align ?? "left" }}
                      className="p-[0_18px] h-[54px] text-[13px] align-middle"
                    >
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!loading && rows.length === 0 && empty && (
        <EmptyState icon={empty.icon} title={empty.title} message={empty.message} action={empty.action} />
      )}
    </Card>
  );
}
