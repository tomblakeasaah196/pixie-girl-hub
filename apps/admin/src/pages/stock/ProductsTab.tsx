import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Boxes, PackageOpen } from "lucide-react";
import { Button, KpiTile, Pill, Skeleton } from "@/components/ui/primitives";
import { ErrorState, Select } from "@/components/ui/controls";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ExpandableText } from "@/components/ui/ExpandableText";
import { CardImage } from "@/pages/catalogue/parts";
import { formatDateTime } from "@/lib/format";
import { useAuthStore } from "@/stores/auth";
import { cn } from "@/lib/cn";
import { useProductStock, useStockLocations } from "./hooks";
import { SearchBox, Pagination } from "./parts";
import type { ProductStockRow, ProductStockSummary } from "./types";

const PAGE_SIZE = 25;

/* ── Stock state → pill ─────────────────────────────────────────────── */
const STATE_LABEL: Record<ProductStockRow["stock_state"], string> = {
  in_stock: "In stock",
  low_stock: "Low",
  out_of_stock: "Out of stock",
};

function StockStatePill({ state }: { state: ProductStockRow["stock_state"] }) {
  const tone =
    state === "in_stock" ? "success" : state === "low_stock" ? "warn" : "danger";
  return <Pill tone={tone}>{STATE_LABEL[state]}</Pill>;
}

const SORTS = [
  { value: "stock", label: "Most stock first" },
  { value: "name", label: "Name (A–Z)" },
  { value: "low", label: "Lowest stock first" },
  { value: "recent", label: "Recently moved" },
] as const;

/** "3d ago" / a full timestamp on hover — the same reading the Movements tab
 *  gives, so "when did this last move?" is answered the same way everywhere. */
function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDateTime(iso);
}

function KpiSkeleton() {
  return (
    <div className="glass rounded-[var(--radius)] shadow-glass p-[17px_18px] max-md:p-[12px_14px] border-l-[3px] border-l-accent/30">
      <Skeleton className="w-24 mb-3" />
      <Skeleton className="w-28" style={{ height: 28 }} />
    </div>
  );
}

/* ── Product identity cell — thumb + name + code · SKU ──────────────── */
function ProductIdentity({
  row,
  size = "row",
}: {
  row: ProductStockRow;
  size?: "row" | "card";
}) {
  const meta = [row.product_code, row.sku].filter(Boolean).join(" · ");
  return (
    <div className="flex items-center gap-3 min-w-0">
      <CardImage
        url={row.primary_image_url}
        name={row.name}
        variant="thumb"
        className={size === "row" ? "w-10 h-10 rounded-[9px]" : "w-12 h-12"}
      />
      <div className="flex flex-col gap-0.5 min-w-0">
        <ExpandableText
          text={row.name}
          className="text-[13px] text-text-primary font-medium"
        />
        <span className="text-[11px] text-text-faint font-mono truncate">
          {meta || "No SKU"}
          {row.variant_count > 1 && (
            <span className="font-sans"> · {row.variant_count} variants</span>
          )}
        </span>
      </div>
    </div>
  );
}

/* ── ProductsTab ────────────────────────────────────────────────────── */
export default function ProductsTab() {
  const navigate = useNavigate();
  const can = useAuthStore((s) => s.can);
  // Rows deep-link into the base product — only offered when the user may
  // actually open it (the API enforces regardless).
  const canOpenProduct = can("catalogue", "view");

  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [locationId, setLocationId] = useState("");
  const [state, setState] = useState("");
  const [sort, setSort] = useState<string>("stock");
  const [page, setPage] = useState(1);

  // Debounce the search so a filter across the whole catalogue isn't one
  // request per keystroke.
  useEffect(() => {
    const id = setTimeout(() => {
      setTerm(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const { data, isLoading, isFetching, isError, error, refetch } =
    useProductStock({
      q: term || undefined,
      location_id: locationId || undefined,
      stock_state: state || undefined,
      sort,
      page,
      page_size: PAGE_SIZE,
    });

  const { data: locations = [] } = useStockLocations();

  const locationOpts = useMemo(
    () => [
      { value: "", label: "All locations" },
      ...locations.map((l) => ({
        value: l.location_id,
        label: l.display_name,
      })),
    ],
    [locations],
  );

  const rows = data?.data ?? [];
  const meta = data?.meta;
  const summary: ProductStockSummary | undefined = data?.summary;

  const stateChips = useMemo(
    () => [
      { value: "", label: "All", count: summary?.products },
      { value: "in_stock", label: "In stock", count: summary?.in_stock },
      { value: "low_stock", label: "Low", count: summary?.low_stock },
      {
        value: "out_of_stock",
        label: "Out of stock",
        count: summary?.out_of_stock,
      },
    ],
    [summary],
  );

  const columns: Column<ProductStockRow>[] = useMemo(
    () => [
      {
        key: "product",
        header: "Base product",
        render: (r) => <ProductIdentity row={r} />,
      },
      {
        key: "state",
        header: "Status",
        width: "130px",
        render: (r) => <StockStatePill state={r.stock_state} />,
      },
      {
        key: "locations",
        header: "Locations",
        width: "100px",
        align: "right",
        render: (r) => (
          <span className="tabular-nums text-[13px] text-text-muted">
            {r.locations_stocked}
          </span>
        ),
      },
      {
        key: "on_hand",
        header: "On hand",
        width: "100px",
        align: "right",
        render: (r) => (
          <span className="tabular-nums font-mono text-[13px] text-text-primary">
            {r.on_hand.toLocaleString()}
          </span>
        ),
      },
      {
        key: "reserved",
        header: "Reserved",
        width: "100px",
        align: "right",
        render: (r) => (
          <span
            className={cn(
              "tabular-nums font-mono text-[13px]",
              r.reserved > 0 ? "text-warn" : "text-text-faint",
            )}
          >
            {r.reserved.toLocaleString()}
          </span>
        ),
      },
      {
        key: "available",
        header: "Available",
        width: "110px",
        align: "right",
        render: (r) => (
          <span
            className={cn(
              "tabular-nums font-mono text-[14px] font-semibold",
              r.available > 0 ? "text-text-primary" : "text-danger",
            )}
          >
            {r.available.toLocaleString()}
          </span>
        ),
      },
      {
        key: "moved",
        header: "Last moved",
        width: "130px",
        align: "right",
        render: (r) => (
          <span
            title={r.last_movement_at ? formatDateTime(r.last_movement_at) : ""}
            className="text-[12px] text-text-muted tabular-nums"
          >
            {relativeTime(r.last_movement_at)}
          </span>
        ),
      },
    ],
    [],
  );

  /* Phone: a stacked card per product — the table would slide off the side. */
  const mobileCard = (r: ProductStockRow) => (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-2">
        <ProductIdentity row={r} size="card" />
        <StockStatePill state={r.stock_state} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "On hand", value: r.on_hand, tone: "text-text-primary" },
          {
            label: "Reserved",
            value: r.reserved,
            tone: r.reserved > 0 ? "text-warn" : "text-text-faint",
          },
          {
            label: "Available",
            value: r.available,
            tone: r.available > 0 ? "text-text-primary" : "text-danger",
          },
        ].map((c) => (
          <div
            key={c.label}
            className="rounded-[10px] bg-text-primary/[0.03] border border-line p-2"
          >
            <div className="text-[10px] uppercase tracking-wide text-text-faint">
              {c.label}
            </div>
            <div
              className={cn(
                "text-[15px] font-mono font-semibold tabular-nums mt-0.5",
                c.tone,
              )}
            >
              {c.value.toLocaleString()}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between text-[11px] text-text-faint">
        <span>
          {r.locations_stocked} location
          {r.locations_stocked === 1 ? "" : "s"}
        </span>
        <span>{relativeTime(r.last_movement_at)}</span>
      </div>
    </div>
  );

  if (isError) {
    return (
      <ErrorState
        message={(error as Error)?.message}
        onRetry={() => refetch()}
      />
    );
  }

  const filtered = Boolean(term || locationId || state);

  return (
    <div className="flex flex-col gap-4">
      {/* ── KPIs: what we hold right now, across the current filters.
             Three across even on a phone — stacking them would push the list
             itself below the fold, and this tab exists for the list. ── */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        {isLoading || !summary ? (
          <>
            <KpiSkeleton />
            <KpiSkeleton />
            <KpiSkeleton />
          </>
        ) : (
          <>
            <KpiTile
              label="Base products"
              value={summary.products.toLocaleString()}
              tone="accent"
            />
            <KpiTile
              label="Units on hand"
              value={summary.total_on_hand.toLocaleString()}
              tone="accent"
            />
            <KpiTile
              label="Units available"
              value={summary.total_available.toLocaleString()}
              tone={summary.total_available > 0 ? "accent" : "warn"}
            />
          </>
        )}
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          {stateChips.map((c) => {
            const on = state === c.value;
            return (
              <button
                key={c.value || "all"}
                type="button"
                onClick={() => {
                  setState(c.value);
                  setPage(1);
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[9px] text-[12px] font-semibold border transition-colors",
                  on
                    ? "border-accent/45 text-accent-glow bg-accent/[0.1]"
                    : "border-line text-text-muted hover:text-text-primary",
                )}
              >
                {c.label}
                {c.count != null && (
                  <span className="tabular-nums text-[10.5px] text-text-faint">
                    {c.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search by product, code or SKU…"
          />
          <Select
            value={locationId}
            onChange={(v) => {
              setLocationId(v);
              setPage(1);
            }}
            options={locationOpts}
            ariaLabel="Filter by location"
            className="w-full sm:w-[200px]"
          />
          <Select
            value={sort}
            onChange={(v) => {
              setSort(v);
              setPage(1);
            }}
            options={[...SORTS]}
            ariaLabel="Sort products"
            className="w-full sm:w-[190px]"
          />
        </div>
      </div>

      {/* ── The register ── */}
      <DataTable<ProductStockRow>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.product_id}
        loading={isLoading || (isFetching && rows.length === 0)}
        mobileCard={mobileCard}
        onRowClick={
          canOpenProduct
            ? (r) => navigate(`/catalogue/base/${r.product_id}`)
            : undefined
        }
        toolbar={
          <div className="flex items-center gap-2 w-full">
            <Boxes className="w-4 h-4 text-text-muted" />
            <span className="text-[13px] font-semibold">Available products</span>
            {meta && (
              <span className="text-[11px] tabular-nums text-text-faint ml-auto">
                {meta.total.toLocaleString()}
                {filtered ? " matching" : ""}
              </span>
            )}
          </div>
        }
        empty={{
          icon: <PackageOpen className="w-6 h-6" />,
          title: filtered ? "No products match" : "Nothing in stock yet",
          message: filtered
            ? "Try a different search term, location, or stock filter."
            : "Receive goods to put base products on the shelf — they show up here with their quantities.",
          action: filtered ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSearch("");
                setLocationId("");
                setState("");
                setPage(1);
              }}
            >
              Clear filters
            </Button>
          ) : undefined,
        }}
      />

      {meta && (
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={meta.total}
          onChange={setPage}
        />
      )}
    </div>
  );
}
