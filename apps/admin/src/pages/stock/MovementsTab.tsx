import { useState, useMemo, useCallback } from "react";
import { ArrowUpDown, Download, Plus } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/primitives";
import { ErrorState, Select, NumberField } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { useAuthStore } from "@/stores/auth";
import {
  useStockMovements,
  useStockLocations,
  useStockMutations,
} from "./hooks";
import type { StockMovement, StockLocation } from "./types";
import {
  MovementTypePill,
  SearchBox,
  FieldLabel,
  TextInput,
  InfoBanner,
  Pagination,
} from "./parts";

/* ── movement type options for filter + form ───────────────────────── */
const MOVEMENT_TYPES = [
  { value: "receive", label: "Receive" },
  { value: "sale", label: "Sale" },
  { value: "reserve", label: "Reserve" },
  { value: "release_reserve", label: "Release reserve" },
  { value: "adjustment_in", label: "Adjustment in" },
  { value: "adjustment_out", label: "Adjustment out" },
  { value: "transfer_in", label: "Transfer in" },
  { value: "transfer_out", label: "Transfer out" },
  { value: "write_off", label: "Write off" },
  { value: "damage", label: "Damage" },
  { value: "production_in", label: "Production in" },
  { value: "production_out", label: "Production out" },
  { value: "return", label: "Return" },
  { value: "sample", label: "Sample" },
  { value: "theft_writeoff", label: "Theft writeoff" },
  { value: "consignment_out", label: "Consignment out" },
  { value: "consignment_return", label: "Consignment return" },
] as const;

const MANUAL_MOVEMENT_TYPES = [
  { value: "receive", label: "Receive" },
  { value: "adjustment_in", label: "Adjustment in" },
  { value: "adjustment_out", label: "Adjustment out" },
  { value: "write_off", label: "Write off" },
] as const;

const PAGE_SIZE = 25;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(iso);
}

/* ── CSV export ────────────────────────────────────────────────────── */
function exportCsv(rows: StockMovement[], locationMap: Map<string, string>) {
  const header = [
    "Date",
    "Type",
    "SKU",
    "Variant",
    "Location",
    "Qty",
    "Reference",
    "Performed By",
  ];
  const lines = rows.map((r) => [
    fmtDate(r.performed_at),
    r.movement_type,
    r.sku ?? "",
    r.variant_name ?? "",
    locationMap.get(r.location_id) ?? r.location_id,
    String(r.quantity),
    r.notes ?? r.reference_id ?? "",
    r.performed_by ?? "",
  ]);
  const csv = [header, ...lines]
    .map((row) =>
      row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `stock-movements-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Log Movement Modal ────────────────────────────────────────────── */
function LogMovementModal({
  open,
  onClose,
  locations,
}: {
  open: boolean;
  onClose: () => void;
  locations: StockLocation[];
}) {
  const [type, setType] = useState<string>("receive");
  const [variantId, setVariantId] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.location_id ?? "");
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [notes, setNotes] = useState("");

  const { recordMovement } = useStockMutations();

  const locationOpts = useMemo(
    () =>
      locations.map((l) => ({ value: l.location_id, label: l.display_name })),
    [locations],
  );

  const handleSubmit = () => {
    if (!variantId || !locationId || !qty) return;
    recordMovement.mutate(
      {
        variant_id: variantId,
        location_id: locationId,
        quantity: Number(qty),
        movement_type: type,
        unit_cost_ngn: unitCost || undefined,
        notes: notes || undefined,
      },
      {
        onSuccess: () => {
          onClose();
          setType("receive");
          setVariantId("");
          setLocationId(locations[0]?.location_id ?? "");
          setQty("");
          setUnitCost("");
          setNotes("");
        },
      },
    );
  };

  return (
    <Modal open={open} onClose={onClose} title="Log Stock Movement">
      <div className="flex flex-col gap-4">
        <div>
          <FieldLabel>Type</FieldLabel>
          <Select
            value={type}
            onChange={setType}
            options={[...MANUAL_MOVEMENT_TYPES]}
          />
        </div>
        <div>
          <FieldLabel>Variant ID</FieldLabel>
          <TextInput
            value={variantId}
            onChange={setVariantId}
            placeholder="UUID of the variant"
            required
          />
        </div>
        <div>
          <FieldLabel>Location</FieldLabel>
          <Select
            value={locationId}
            onChange={setLocationId}
            options={locationOpts}
          />
        </div>
        <div>
          <FieldLabel>Quantity</FieldLabel>
          <NumberField
            value={qty}
            onChange={setQty}
            allowDecimal={false}
            allowNegative={false}
            placeholder="0"
          />
        </div>
        <div>
          <FieldLabel>Unit cost NGN (optional)</FieldLabel>
          <NumberField
            value={unitCost}
            onChange={setUnitCost}
            allowDecimal
            allowNegative={false}
            placeholder="0.00"
            suffix="NGN"
          />
        </div>
        <div>
          <FieldLabel>Reference / Notes</FieldLabel>
          <TextInput
            value={notes}
            onChange={setNotes}
            placeholder="Reason or reference number"
          />
        </div>

        {type === "write_off" && (
          <InfoBanner>
            Write-off requires CEO approval after submission.
          </InfoBanner>
        )}
      </div>

      <div className="flex justify-end gap-2 mt-6">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleSubmit}
          disabled={
            !variantId || !locationId || !qty || recordMovement.isPending
          }
        >
          {recordMovement.isPending ? "Saving..." : "Save Movement"}
        </Button>
      </div>
    </Modal>
  );
}

/* ── MovementsTab ──────────────────────────────────────────────────── */
export default function MovementsTab() {
  const can = useAuthStore((s) => s.can);
  const isCeo = useAuthStore((s) => s.user?.isCeo ?? false);

  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [locationFilter, setLocationFilter] = useState("");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  // Single movement-type filter ("" = all); passed straight to the API.
  const apiMovementType = typeFilter || undefined;

  const {
    data: movementsData,
    isLoading,
    isError,
    error,
    refetch,
  } = useStockMovements({
    movement_type: apiMovementType,
    page,
    page_size: PAGE_SIZE,
  });

  const { data: locations = [] } = useStockLocations();

  const locationMap = useMemo(
    () => new Map(locations.map((l) => [l.location_id, l.display_name])),
    [locations],
  );

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

  /* Client-side filtering for multi-type, location, and search */
  const filteredRows = useMemo(() => {
    let rows = movementsData?.data ?? [];

    if (locationFilter) {
      rows = rows.filter((r) => r.location_id === locationFilter);
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) => {
        const sku = r.sku ?? "";
        const variantName = r.variant_name ?? "";
        const ref = r.notes ?? r.reference_id ?? "";
        return (
          sku.toLowerCase().includes(q) ||
          variantName.toLowerCase().includes(q) ||
          ref.toLowerCase().includes(q)
        );
      });
    }

    return rows;
  }, [movementsData?.data, locationFilter, search]);

  const handleExport = useCallback(() => {
    exportCsv(filteredRows, locationMap);
  }, [filteredRows, locationMap]);

  /* ── Columns ──────────────────────────────────────────────────────── */
  const columns: Column<StockMovement>[] = useMemo(
    () => [
      {
        key: "date",
        header: "Date / Time",
        width: "140px",
        render: (r) => (
          <span
            title={fmtDate(r.performed_at)}
            className="text-[13px] text-text-primary"
          >
            {relativeTime(r.performed_at)}
          </span>
        ),
      },
      {
        key: "type",
        header: "Type",
        width: "130px",
        render: (r) => <MovementTypePill type={r.movement_type} />,
      },
      {
        key: "product",
        header: "Product / Variant",
        render: (r) => {
          const sku = r.sku ?? "";
          const variantName = r.variant_name ?? "";
          return (
            <div className="flex flex-col gap-0.5">
              <span className="text-[13px] text-text-primary font-medium truncate max-w-[220px]">
                {variantName || r.variant_id.slice(0, 8)}
              </span>
              {sku && (
                <span className="text-[11px] text-text-faint font-mono">
                  {sku}
                </span>
              )}
            </div>
          );
        },
      },
      {
        key: "location",
        header: "Location",
        width: "140px",
        render: (r) => (
          <span className="text-[13px] text-text-muted">
            {locationMap.get(r.location_id) ?? r.location_id.slice(0, 8)}
          </span>
        ),
      },
      {
        key: "qty",
        header: "Qty",
        width: "80px",
        align: "right",
        render: (r) => (
          <span
            className={`text-[13px] font-mono tabular-nums font-semibold ${
              r.quantity > 0
                ? "text-success"
                : r.quantity < 0
                  ? "text-danger"
                  : "text-text-muted"
            }`}
          >
            {r.quantity > 0 ? `+${r.quantity}` : r.quantity}
          </span>
        ),
      },
      {
        key: "reference",
        header: "Reference",
        width: "160px",
        render: (r) => (
          <span className="text-[13px] text-text-muted truncate max-w-[150px] block">
            {r.notes ?? r.reference_id ?? "—"}
          </span>
        ),
      },
      {
        key: "who",
        header: "Who",
        width: "120px",
        render: (r) => (
          <span className="text-[13px] text-text-muted truncate max-w-[110px] block">
            {r.performed_by ?? "—"}
          </span>
        ),
      },
    ],
    [locationMap],
  );

  /* ── Error state ─────────────────────────────────────────────────── */
  if (isError) {
    return (
      <ErrorState
        message={(error as Error)?.message}
        onRetry={() => refetch()}
      />
    );
  }

  const meta = movementsData?.meta;

  return (
    <div className="flex flex-col gap-4">
      {/* Filters bar */}
      <div className="flex flex-col gap-3">
        <Select
          value={typeFilter}
          onChange={(v) => {
            setTypeFilter(v);
            setPage(1);
          }}
          options={[{ value: "", label: "All types" }, ...MOVEMENT_TYPES]}
          className="w-[220px]"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            value={locationFilter}
            onChange={(v) => {
              setLocationFilter(v);
              setPage(1);
            }}
            options={locationOpts}
            className="w-[220px]"
          />
          <SearchBox
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Search variant / reference..."
          />
          <div className="flex-1" />
          {can("stock", "view") && (
            <Button
              variant="secondary"
              size="sm"
              icon={<Download className="w-4 h-4" />}
              onClick={handleExport}
            >
              Export CSV
            </Button>
          )}
          {isCeo && (
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="w-4 h-4" />}
              onClick={() => setModalOpen(true)}
            >
              Log Movement
            </Button>
          )}
        </div>
      </div>

      {/* Data table */}
      <DataTable<StockMovement>
        columns={columns}
        rows={filteredRows}
        rowKey={(r) => r.movement_id}
        loading={isLoading}
        empty={{
          icon: <ArrowUpDown className="w-6 h-6" />,
          title: "No stock movements",
          message:
            "Movements will appear here as stock is received, sold, transferred, or adjusted.",
        }}
      />

      {/* Pagination */}
      {meta && (
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={meta.total}
          onChange={setPage}
        />
      )}

      {/* Log Movement modal */}
      <LogMovementModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        locations={locations}
      />
    </div>
  );
}
