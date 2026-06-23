import { useState, useCallback, useMemo, useEffect } from "react";
import {
  Package,
  PackagePlus,
  Plus,
  Trash2,
  Truck,
  Ship,
  Upload,
  CheckCircle2,
  Circle,
  Info,
} from "lucide-react";
import { Button, Card, Skeleton } from "@/components/ui/primitives";
import { ErrorState, NumberField, Select } from "@/components/ui/controls";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { Modal } from "@/components/ui/Modal";
import { useAuthStore } from "@/stores/auth";
import { BaseProductPicker } from "@/pages/catalogue/BaseProductPicker";
import {
  useInboundShipments,
  useInboundShipment,
  useStockLocations,
  useStockMutations,
} from "./hooks";
import {
  StatusPill,
  FieldLabel,
  TextInput,
  InfoBanner,
  Pagination,
} from "./parts";
import { GoodsReceptionImportModal } from "./GoodsReceptionImportModal";
import type { InboundShipment, ShipmentLine, StockLocation } from "./types";

/* ── Constants ── */
const SHIPMENT_STATUSES = [
  { value: "", label: "All statuses" },
  { value: "in_production", label: "In Production" },
  { value: "quality_check", label: "Quality Check" },
  { value: "ready_to_ship", label: "Ready to Ship" },
  { value: "in_transit", label: "In Transit" },
  { value: "arrived_lagos", label: "Arrived Lagos" },
  { value: "cleared_customs", label: "Cleared Customs" },
  { value: "received", label: "Received" },
] as const;

const SHIPPING_METHODS = [
  { value: "air", label: "Air" },
  { value: "sea", label: "Sea" },
  { value: "land", label: "Land" },
  { value: "courier", label: "Courier" },
  { value: "hand_carry", label: "Hand Carry" },
] as const;

const STATUS_STEPS = [
  "in_production",
  "quality_check",
  "ready_to_ship",
  "in_transit",
  "arrived_lagos",
  "cleared_customs",
  "received",
] as const;

const STATUS_LABELS: Record<string, string> = {
  in_production: "Production",
  quality_check: "QC",
  ready_to_ship: "Ready",
  in_transit: "In Transit",
  arrived_lagos: "Lagos",
  cleared_customs: "Customs",
  received: "Received",
};

const todayISO = () => new Date().toISOString().slice(0, 10);

/* ── Stepper ── */
function ShipmentStepper({ status }: { status: string }) {
  const currentIdx = STATUS_STEPS.indexOf(
    status as (typeof STATUS_STEPS)[number],
  );
  return (
    <div className="flex items-center gap-1 overflow-x-auto py-2">
      {STATUS_STEPS.map((step, i) => {
        const done = i <= currentIdx;
        const active = i === currentIdx;
        return (
          <div key={step} className="flex items-center gap-1">
            {i > 0 && (
              <div
                className={`w-4 sm:w-6 h-[2px] rounded-full transition-colors ${
                  i <= currentIdx ? "bg-accent-deep" : "bg-text-primary/10"
                }`}
              />
            )}
            <div className="flex flex-col items-center gap-1 min-w-[40px]">
              {done ? (
                <CheckCircle2
                  className={`w-5 h-5 shrink-0 ${
                    active ? "text-accent-deep" : "text-success"
                  }`}
                />
              ) : (
                <Circle className="w-5 h-5 shrink-0 text-text-faint/40" />
              )}
              <span
                className={`text-[9px] sm:text-[10px] font-semibold whitespace-nowrap ${
                  active
                    ? "text-accent-glow"
                    : done
                      ? "text-text-primary"
                      : "text-text-faint"
                }`}
              >
                {STATUS_LABELS[step]}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Goods Reception draft line: a BASE product + quantity (no cost) ── */
interface ReceiptLine {
  id: string;
  product_id: string;
  quantity: string;
}
const emptyReceiptLine = (): ReceiptLine => ({
  id: crypto.randomUUID(),
  product_id: "",
  quantity: "",
});

/* ── Advanced shipment draft line ── */
interface DraftLine {
  id: string;
  variant_id: string;
  qty_expected: string;
  unit_cost_ngn: string;
}
function emptyLine(): DraftLine {
  return {
    id: crypto.randomUUID(),
    variant_id: "",
    qty_expected: "",
    unit_cost_ngn: "",
  };
}

/* ── Receive line shape (advanced shipment receipt) ── */
interface ReceiveLine {
  line_id: string;
  variant_id: string;
  qty_expected: number;
  qty_received: string;
  qty_rejected: string;
}

/* ── Component ── */
export default function ReceiveTab() {
  const can = useAuthStore((s) => s.can);
  const userName = useAuthStore((s) => s.user?.name ?? "");
  const canCreate = can("stock", "create");

  /* Filters */
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  /* Queries */
  const shipmentsQuery = useInboundShipments({
    status: statusFilter || undefined,
    page,
    page_size: pageSize,
  });
  const locationsQuery = useStockLocations();
  const mutations = useStockMutations();

  const locations = useMemo(
    () => (locationsQuery.data as StockLocation[]) ?? [],
    [locationsQuery.data],
  );
  const defaultLocationId = useMemo(
    () => locations.find((l) => l.is_default)?.location_id ?? "",
    [locations],
  );

  /* Drawer + modal state */
  const [receptionOpen, setReceptionOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [receiveId, setReceiveId] = useState<string | null>(null);
  const receiveShipmentQuery = useInboundShipment(receiveId);

  /* ══════════════ Goods Reception form state ══════════════ */
  const [recLocationId, setRecLocationId] = useState("");
  const [recDate, setRecDate] = useState(todayISO());
  const [recReceiver, setRecReceiver] = useState("");
  const [recLines, setRecLines] = useState<ReceiptLine[]>([emptyReceiptLine()]);

  const openReception = useCallback(() => {
    setRecLocationId(defaultLocationId);
    setRecDate(todayISO());
    setRecReceiver(userName);
    setRecLines([emptyReceiptLine()]);
    setReceptionOpen(true);
  }, [defaultLocationId, userName]);

  const addRecLine = () =>
    setRecLines((prev) => [...prev, emptyReceiptLine()]);
  const removeRecLine = (id: string) =>
    setRecLines((prev) =>
      prev.length <= 1 ? prev : prev.filter((l) => l.id !== id),
    );
  const updateRecLine = (id: string, field: keyof ReceiptLine, value: string) =>
    setRecLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)),
    );

  const recValidLines = recLines.filter(
    (l) => l.product_id && Number(l.quantity) > 0,
  );
  const recCanSubmit = !!recLocationId && recValidLines.length > 0;

  const handleCreateReception = useCallback(() => {
    if (!recCanSubmit) return;
    mutations.createGoodsReceipt.mutate(
      {
        destination_location_id: recLocationId,
        received_at: recDate || undefined,
        received_by_name: recReceiver || undefined,
        lines: recValidLines.map((l) => ({
          product_id: l.product_id,
          quantity: Number(l.quantity),
        })),
      },
      { onSuccess: () => setReceptionOpen(false) },
    );
  }, [
    recCanSubmit,
    recLocationId,
    recDate,
    recReceiver,
    recValidLines,
    mutations.createGoodsReceipt,
  ]);

  /* ══════════════ Advanced shipment form state ══════════════ */
  const [originCountry, setOriginCountry] = useState("");
  const [originPort, setOriginPort] = useState("");
  const [carrierName, setCarrierName] = useState("");
  const [trackingRef, setTrackingRef] = useState("");
  const [shippingMethod, setShippingMethod] = useState<string>("air");
  const [destLocationId, setDestLocationId] = useState("");
  const [draftLines, setDraftLines] = useState<DraftLine[]>([emptyLine()]);

  const openAdvanced = useCallback(() => {
    setOriginCountry("");
    setOriginPort("");
    setCarrierName("");
    setTrackingRef("");
    setShippingMethod("air");
    setDestLocationId("");
    setDraftLines([emptyLine()]);
    setAdvancedOpen(true);
  }, []);

  const addLine = () => setDraftLines((prev) => [...prev, emptyLine()]);
  const removeLine = (id: string) =>
    setDraftLines((prev) =>
      prev.length <= 1 ? prev : prev.filter((l) => l.id !== id),
    );
  const updateLine = (id: string, field: keyof DraftLine, value: string) =>
    setDraftLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)),
    );

  const handleCreateShipment = useCallback(() => {
    const validLines = draftLines
      .filter((l) => l.variant_id && l.qty_expected)
      .map((l) => ({
        variant_id: l.variant_id,
        qty_expected: Number(l.qty_expected),
        unit_cost_ngn: l.unit_cost_ngn ? Number(l.unit_cost_ngn) : undefined,
      }));
    if (validLines.length === 0) return;

    mutations.createShipment.mutate(
      {
        origin_country: originCountry || undefined,
        origin_port: originPort || undefined,
        carrier_name: carrierName || undefined,
        tracking_reference: trackingRef || undefined,
        shipping_method: shippingMethod,
        destination_location_id: destLocationId || undefined,
        lines: validLines,
      },
      { onSuccess: () => setAdvancedOpen(false) },
    );
  }, [
    draftLines,
    originCountry,
    originPort,
    carrierName,
    trackingRef,
    shippingMethod,
    destLocationId,
    mutations.createShipment,
  ]);

  /* ══════════════ Receive (advanced shipment) modal state ══════════════ */
  const [receiveLines, setReceiveLines] = useState<ReceiveLine[]>([]);

  const openReceiveModal = useCallback((shipment: InboundShipment) => {
    setReceiveId(shipment.shipment_id);
    setReceiveLines(
      (shipment.lines ?? []).map((l: ShipmentLine) => ({
        line_id: l.line_id,
        variant_id: l.variant_id,
        qty_expected: l.qty_expected,
        qty_received: String(l.qty_expected),
        qty_rejected: "0",
      })),
    );
  }, []);

  /* Keep receive lines in sync when shipment detail loads */
  useEffect(() => {
    if (receiveShipmentQuery.data && receiveLines.length === 0) {
      const ship = receiveShipmentQuery.data as InboundShipment;
      setReceiveLines(
        (ship.lines ?? []).map((l: ShipmentLine) => ({
          line_id: l.line_id,
          variant_id: l.variant_id,
          qty_expected: l.qty_expected,
          qty_received: String(l.qty_expected),
          qty_rejected: "0",
        })),
      );
    }
  }, [receiveShipmentQuery.data, receiveLines.length]);

  const updateReceiveLine = (
    lineId: string,
    field: "qty_received" | "qty_rejected",
    value: string,
  ) =>
    setReceiveLines((prev) =>
      prev.map((l) => (l.line_id === lineId ? { ...l, [field]: value } : l)),
    );

  const handleConfirmReceipt = useCallback(() => {
    if (!receiveId) return;
    mutations.receiveShipment.mutate(
      {
        id: receiveId,
        input: {
          lines: receiveLines.map((l) => ({
            line_id: l.line_id,
            qty_received: Number(l.qty_received),
            qty_rejected: Number(l.qty_rejected) || undefined,
          })),
        },
      },
      {
        onSuccess: () => {
          setReceiveId(null);
          setReceiveLines([]);
        },
      },
    );
  }, [receiveId, receiveLines, mutations.receiveShipment]);

  /* ── Detect Amazon FBA destination (advanced) ── */
  const destLocation = useMemo(() => {
    if (!destLocationId) return null;
    return locations.find((l) => l.location_id === destLocationId) ?? null;
  }, [destLocationId, locations]);
  const isAmazonFba = destLocation?.location_type === "amazon_fba";

  /* Location options for selects */
  const locationOptions = useMemo(
    () =>
      locations.map((l) => ({
        value: l.location_id,
        label: `${l.display_name} (${l.location_type.replace(/_/g, " ")})`,
      })),
    [locations],
  );

  /* ── Table columns (receiving register) ── */
  const columns: Column<InboundShipment>[] = [
    {
      key: "ref",
      header: "Reception #",
      width: "140px",
      render: (r) => (
        <span className="font-mono text-[12px] font-semibold">
          {r.shipment_number}
        </span>
      ),
    },
    {
      key: "date",
      header: "Date",
      render: (r) => (
        <span className="text-[12px] text-text-muted tabular-nums">
          {new Date(r.received_at || r.created_at).toLocaleDateString("en-NG", {
            day: "2-digit",
            month: "short",
            year: "2-digit",
          })}
        </span>
      ),
    },
    {
      key: "location",
      header: "Location",
      render: (r) => (
        <span className="text-[13px]">
          {r.destination_location_name || "--"}
        </span>
      ),
    },
    {
      key: "received_by",
      header: "Received by",
      render: (r) => (
        <div className="flex flex-col leading-tight">
          <span className="text-[13px]">{r.received_by_name || "--"}</span>
          {r.created_by && (
            <span
              className="font-mono text-[10px] text-text-faint truncate max-w-[120px]"
              title={r.created_by}
            >
              ID {r.created_by.slice(0, 8)}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "items",
      header: "Items",
      align: "right",
      width: "70px",
      render: (r) => (
        <span className="tabular-nums">
          {r.line_count ?? r.lines?.length ?? 0}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <StatusPill status={r.status} />,
    },
    {
      key: "actions",
      header: "",
      width: "90px",
      align: "right",
      render: (r) =>
        r.status !== "received" && canCreate ? (
          <Button size="sm" variant="ghost" onClick={() => openReceiveModal(r)}>
            Receive
          </Button>
        ) : null,
    },
  ];

  /* ── Error state ── */
  if (shipmentsQuery.error) {
    return (
      <ErrorState
        message={(shipmentsQuery.error as Error).message}
        onRetry={() => shipmentsQuery.refetch()}
      />
    );
  }

  /* ── Register data ── */
  const shipments = (shipmentsQuery.data?.data as InboundShipment[]) ?? [];
  const meta = shipmentsQuery.data?.meta;
  const pendingPreview = shipments.find((s) => s.status !== "received");

  return (
    <div className="flex flex-col gap-4">
      {/* ── Register table ── */}
      <DataTable
        columns={columns}
        rows={shipments}
        rowKey={(r) => r.shipment_id}
        loading={shipmentsQuery.isLoading}
        empty={{
          icon: <Package className="w-8 h-8" />,
          title: "Nothing received yet",
          message:
            "Receive goods to add stock. Pick a location, the base products and quantities — stock updates at once.",
          action: canCreate ? (
            <Button
              variant="primary"
              icon={<PackagePlus className="w-4 h-4" />}
              onClick={openReception}
            >
              Receive Goods
            </Button>
          ) : undefined,
        }}
        toolbar={
          <div className="flex items-center gap-3 flex-wrap w-full">
            <Truck className="w-4 h-4 text-text-muted" />
            <span className="text-[13px] font-semibold">
              Receiving Register
            </span>
            {canCreate && (
              <button
                type="button"
                onClick={openAdvanced}
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-text-faint hover:text-accent-glow transition-colors"
                title="Log a detailed inbound shipment (origin, carrier, freight, customs)"
              >
                <Ship className="w-3.5 h-3.5" />
                Advanced
              </button>
            )}
            <Select
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
              options={
                SHIPMENT_STATUSES as unknown as {
                  value: string;
                  label: string;
                }[]
              }
              className="w-[170px] ml-auto"
            />
            {canCreate && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Upload className="w-4 h-4" />}
                  onClick={() => setImportOpen(true)}
                >
                  Import
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  icon={<PackagePlus className="w-4 h-4" />}
                  onClick={openReception}
                >
                  Receive Goods
                </Button>
              </>
            )}
          </div>
        }
      />

      {/* ── Pagination ── */}
      {meta && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={meta.total}
          onChange={setPage}
        />
      )}

      {/* ── Stepper preview for the first pending advanced shipment ── */}
      {pendingPreview && (
        <Card className="p-4">
          <div className="text-[12px] text-text-muted mb-1 font-semibold">
            {pendingPreview.shipment_number} progress
          </div>
          <ShipmentStepper status={pendingPreview.status} />
        </Card>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          GOODS RECEPTION DRAWER (simple — base products + qty)
         ══════════════════════════════════════════════════════════════════════ */}
      <Drawer
        open={receptionOpen}
        onClose={() => setReceptionOpen(false)}
        title="Goods Reception"
        subtitle="Receive base products into a location — stock updates at once"
        wide
        footer={
          <div className="flex justify-end gap-2 p-4 border-t hairline">
            <Button variant="secondary" onClick={() => setReceptionOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleCreateReception}
              disabled={!recCanSubmit || mutations.createGoodsReceipt.isPending}
            >
              {mutations.createGoodsReceipt.isPending
                ? "Receiving..."
                : "Receive Goods"}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-5 p-5">
          {/* Header: location / date / receiver */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <FieldLabel>Destination Location</FieldLabel>
              {locationsQuery.isLoading ? (
                <Skeleton className="w-full" style={{ height: 42 }} />
              ) : (
                <Select
                  value={recLocationId}
                  onChange={setRecLocationId}
                  options={[
                    { value: "", label: "Select location" },
                    ...locationOptions,
                  ]}
                />
              )}
            </div>
            <div>
              <FieldLabel>Date Received</FieldLabel>
              <TextInput type="date" value={recDate} onChange={setRecDate} />
            </div>
            <div>
              <FieldLabel>Received By</FieldLabel>
              <TextInput
                value={recReceiver}
                onChange={setRecReceiver}
                placeholder="Receiver name"
              />
            </div>
          </div>

          <InfoBanner>
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Receive <strong>base products</strong> only — no cost is entered
                here. Unit cost lives in the base-product Cost Vault.
              </span>
            </div>
          </InfoBanner>

          {/* Line items: base product + quantity */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <FieldLabel>Products</FieldLabel>
              <Button
                size="sm"
                variant="ghost"
                icon={<Plus className="w-3.5 h-3.5" />}
                onClick={addRecLine}
              >
                Add line
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              {recLines.map((line, idx) => (
                <div
                  key={line.id}
                  className="grid grid-cols-[1fr_110px_36px] gap-2 items-end"
                >
                  <div>
                    {idx === 0 && (
                      <span className="text-[10px] text-text-faint uppercase">
                        Base Product
                      </span>
                    )}
                    <BaseProductPicker
                      value={line.product_id}
                      onChange={(id) =>
                        updateRecLine(line.id, "product_id", id)
                      }
                    />
                  </div>
                  <div>
                    {idx === 0 && (
                      <span className="text-[10px] text-text-faint uppercase">
                        Quantity
                      </span>
                    )}
                    <NumberField
                      value={line.quantity}
                      onChange={(v) => updateRecLine(line.id, "quantity", v)}
                      allowDecimal={false}
                      placeholder="0"
                    />
                  </div>
                  <div className={idx === 0 ? "mt-3" : ""}>
                    <button
                      type="button"
                      onClick={() => removeRecLine(line.id)}
                      disabled={recLines.length <= 1}
                      className="grid place-items-center w-[36px] h-[42px] rounded-[11px] text-text-faint hover:text-danger hover:bg-danger/10 transition-colors disabled:opacity-30"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Drawer>

      {/* ══════════════════════════════════════════════════════════════════════
          ADVANCED SHIPMENT DRAWER (detailed inbound — origin/carrier/freight)
         ══════════════════════════════════════════════════════════════════════ */}
      <Drawer
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        title="Log Inbound Shipment (Advanced)"
        subtitle="Detailed factory shipment — origin, carrier, freight & customs"
        wide
        footer={
          <div className="flex justify-end gap-2 p-4 border-t hairline">
            <Button variant="secondary" onClick={() => setAdvancedOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleCreateShipment}
              disabled={
                mutations.createShipment.isPending ||
                draftLines.every((l) => !l.variant_id || !l.qty_expected)
              }
            >
              {mutations.createShipment.isPending
                ? "Saving..."
                : "Save Shipment"}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-5 p-5">
          {/* Origin fields */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel>Origin Country</FieldLabel>
              <TextInput
                value={originCountry}
                onChange={setOriginCountry}
                placeholder="e.g. China"
              />
            </div>
            <div>
              <FieldLabel>Origin Port</FieldLabel>
              <TextInput
                value={originPort}
                onChange={setOriginPort}
                placeholder="e.g. Guangzhou"
              />
            </div>
          </div>

          {/* Carrier + tracking */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel>Carrier Name</FieldLabel>
              <TextInput
                value={carrierName}
                onChange={setCarrierName}
                placeholder="e.g. DHL"
              />
            </div>
            <div>
              <FieldLabel>Tracking Reference</FieldLabel>
              <TextInput
                value={trackingRef}
                onChange={setTrackingRef}
                placeholder="Tracking #"
              />
            </div>
          </div>

          {/* Shipping method + destination */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel>Shipping Method</FieldLabel>
              <Select
                value={shippingMethod}
                onChange={setShippingMethod}
                options={
                  SHIPPING_METHODS as unknown as {
                    value: string;
                    label: string;
                  }[]
                }
              />
            </div>
            <div>
              <FieldLabel>Destination Location</FieldLabel>
              {locationsQuery.isLoading ? (
                <Skeleton className="w-full" style={{ height: 42 }} />
              ) : (
                <Select
                  value={destLocationId}
                  onChange={setDestLocationId}
                  options={[
                    { value: "", label: "Select location" },
                    ...locationOptions,
                  ]}
                />
              )}
            </div>
          </div>

          {/* Amazon FBA banner */}
          {isAmazonFba && (
            <InfoBanner>
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  This shipment targets an <strong>Amazon FBA</strong> location.
                  Ensure carton labels, FNSKU barcodes, and packing lists comply
                  with Amazon's inbound requirements. Shipments may be rejected
                  at the fulfilment centre if prep requirements are not met.
                </span>
              </div>
            </InfoBanner>
          )}

          {/* Line items (variant-level, with cost — advanced only) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <FieldLabel>Line Items</FieldLabel>
              <Button
                size="sm"
                variant="ghost"
                icon={<Plus className="w-3.5 h-3.5" />}
                onClick={addLine}
              >
                Add line
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              {draftLines.map((line, idx) => (
                <div
                  key={line.id}
                  className="grid grid-cols-[1fr_100px_120px_36px] gap-2 items-end"
                >
                  <div>
                    {idx === 0 && (
                      <span className="text-[10px] text-text-faint uppercase">
                        Variant ID
                      </span>
                    )}
                    <TextInput
                      value={line.variant_id}
                      onChange={(v) => updateLine(line.id, "variant_id", v)}
                      placeholder="variant UUID"
                    />
                  </div>
                  <div>
                    {idx === 0 && (
                      <span className="text-[10px] text-text-faint uppercase">
                        Qty Expected
                      </span>
                    )}
                    <NumberField
                      value={line.qty_expected}
                      onChange={(v) => updateLine(line.id, "qty_expected", v)}
                      allowDecimal={false}
                      placeholder="0"
                    />
                  </div>
                  <div>
                    {idx === 0 && (
                      <span className="text-[10px] text-text-faint uppercase">
                        Unit Cost (NGN)
                      </span>
                    )}
                    <NumberField
                      value={line.unit_cost_ngn}
                      onChange={(v) => updateLine(line.id, "unit_cost_ngn", v)}
                      placeholder="0.00"
                      suffix="NGN"
                    />
                  </div>
                  <div className={idx === 0 ? "mt-3" : ""}>
                    <button
                      type="button"
                      onClick={() => removeLine(line.id)}
                      disabled={draftLines.length <= 1}
                      className="grid place-items-center w-[36px] h-[42px] rounded-[11px] text-text-faint hover:text-danger hover:bg-danger/10 transition-colors disabled:opacity-30"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Drawer>

      {/* ══════════════════════════════════════════════════════════════════════
          RECEIVE SHIPMENT MODAL (advanced shipments awaiting receipt)
         ══════════════════════════════════════════════════════════════════════ */}
      <Modal
        open={receiveId !== null}
        onClose={() => {
          setReceiveId(null);
          setReceiveLines([]);
        }}
        title="Receive Shipment"
        footer={
          <div className="flex justify-end gap-2 p-5 border-t hairline">
            <Button
              variant="secondary"
              onClick={() => {
                setReceiveId(null);
                setReceiveLines([]);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleConfirmReceipt}
              disabled={mutations.receiveShipment.isPending}
            >
              {mutations.receiveShipment.isPending
                ? "Processing..."
                : "Confirm Receipt"}
            </Button>
          </div>
        }
      >
        <div className="p-5 flex flex-col gap-4">
          {receiveShipmentQuery.data && (
            <ShipmentStepper
              status={(receiveShipmentQuery.data as InboundShipment).status}
            />
          )}

          {receiveShipmentQuery.isLoading && (
            <div className="flex flex-col gap-3 py-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="w-full" style={{ height: 42 }} />
              ))}
            </div>
          )}

          {receiveLines.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-[1fr_90px_90px_90px] gap-2 text-[10px] text-text-faint uppercase font-semibold">
                <span>Variant</span>
                <span className="text-right">Expected</span>
                <span className="text-right">Received</span>
                <span className="text-right">Rejected</span>
              </div>

              {receiveLines.map((line) => (
                <div
                  key={line.line_id}
                  className="grid grid-cols-[1fr_90px_90px_90px] gap-2 items-center"
                >
                  <span className="font-mono text-[12px] text-text-muted truncate">
                    {line.variant_id.slice(0, 12)}...
                  </span>
                  <span className="text-right tabular-nums text-[13px] font-semibold">
                    {line.qty_expected}
                  </span>
                  <NumberField
                    value={line.qty_received}
                    onChange={(v) =>
                      updateReceiveLine(line.line_id, "qty_received", v)
                    }
                    allowDecimal={false}
                    className="[&_input]:text-right"
                  />
                  <NumberField
                    value={line.qty_rejected}
                    onChange={(v) =>
                      updateReceiveLine(line.line_id, "qty_rejected", v)
                    }
                    allowDecimal={false}
                    placeholder="0"
                    className="[&_input]:text-right"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* ══════════════ Import (Excel/CSV) ══════════════ */}
      <GoodsReceptionImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        locations={locations}
        defaultReceiver={userName}
      />
    </div>
  );
}
