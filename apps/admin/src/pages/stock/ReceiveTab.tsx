import { useState, useCallback, useMemo } from "react";
import {
  Package,
  Plus,
  Trash2,
  Truck,
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

/* ── Draft line item shape for the create form ── */
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

/* ── Receive line shape ── */
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

  /* Drawer + modal state */
  const [createOpen, setCreateOpen] = useState(false);
  const [receiveId, setReceiveId] = useState<string | null>(null);
  const receiveShipmentQuery = useInboundShipment(receiveId);

  /* ── Create form state ── */
  const [originCountry, setOriginCountry] = useState("");
  const [originPort, setOriginPort] = useState("");
  const [carrierName, setCarrierName] = useState("");
  const [trackingRef, setTrackingRef] = useState("");
  const [shippingMethod, setShippingMethod] = useState<string>("air");
  const [destLocationId, setDestLocationId] = useState("");
  const [draftLines, setDraftLines] = useState<DraftLine[]>([emptyLine()]);

  const resetCreateForm = useCallback(() => {
    setOriginCountry("");
    setOriginPort("");
    setCarrierName("");
    setTrackingRef("");
    setShippingMethod("air");
    setDestLocationId("");
    setDraftLines([emptyLine()]);
  }, []);

  const handleOpenCreate = useCallback(() => {
    resetCreateForm();
    setCreateOpen(true);
  }, [resetCreateForm]);

  /* Draft line helpers */
  const addLine = () => setDraftLines((prev) => [...prev, emptyLine()]);
  const removeLine = (id: string) =>
    setDraftLines((prev) =>
      prev.length <= 1 ? prev : prev.filter((l) => l.id !== id),
    );
  const updateLine = (id: string, field: keyof DraftLine, value: string) =>
    setDraftLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)),
    );

  /* Submit create */
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
      { onSuccess: () => setCreateOpen(false) },
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

  /* ── Receive modal state ── */
  const [receiveLines, setReceiveLines] = useState<ReceiveLine[]>([]);

  const openReceiveModal = useCallback((shipment: InboundShipment) => {
    setReceiveId(shipment.shipment_id);
    setReceiveLines(
      shipment.lines.map((l: ShipmentLine) => ({
        line_id: l.line_id,
        variant_id: l.variant_id,
        qty_expected: l.qty_expected,
        qty_received: String(l.qty_expected),
        qty_rejected: "0",
      })),
    );
  }, []);

  /* Keep receive lines in sync when shipment detail loads */
  useMemo(() => {
    if (receiveShipmentQuery.data && receiveLines.length === 0) {
      const ship = receiveShipmentQuery.data as InboundShipment;
      setReceiveLines(
        ship.lines.map((l: ShipmentLine) => ({
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

  /* ── Detect Amazon FBA destination ── */
  const destLocation = useMemo(() => {
    if (!destLocationId || !locationsQuery.data) return null;
    return (
      (locationsQuery.data as StockLocation[]).find(
        (l) => l.location_id === destLocationId,
      ) ?? null
    );
  }, [destLocationId, locationsQuery.data]);

  const isAmazonFba = destLocation?.location_type === "amazon_fba";

  /* ── Table columns ── */
  const columns: Column<InboundShipment>[] = [
    {
      key: "ref",
      header: "Shipment Ref",
      width: "140px",
      render: (r) => (
        <span className="font-mono text-[12px] font-semibold">
          {r.shipment_number}
        </span>
      ),
    },
    {
      key: "origin",
      header: "Origin",
      render: (r) => (
        <span className="text-[13px]">
          {[r.origin_country, r.origin_port].filter(Boolean).join(", ") || "--"}
        </span>
      ),
    },
    {
      key: "carrier",
      header: "Carrier",
      render: (r) => (
        <span className="text-[13px]">{r.carrier_name || "--"}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <StatusPill status={r.status} />,
    },
    {
      key: "lines",
      header: "Lines",
      align: "right",
      width: "70px",
      render: (r) => <span className="tabular-nums">{r.lines.length}</span>,
    },
    {
      key: "tracking",
      header: "Tracking",
      render: (r) => (
        <span className="font-mono text-[11px] text-text-muted truncate max-w-[140px] inline-block">
          {r.tracking_reference || "--"}
        </span>
      ),
    },
    {
      key: "created",
      header: "Created",
      align: "right",
      render: (r) => (
        <span className="text-[12px] text-text-muted tabular-nums">
          {new Date(r.created_at).toLocaleDateString("en-NG", {
            day: "2-digit",
            month: "short",
            year: "2-digit",
          })}
        </span>
      ),
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

  /* Location options for the select */
  const locationOptions = useMemo(() => {
    if (!locationsQuery.data) return [];
    return (locationsQuery.data as StockLocation[]).map((l) => ({
      value: l.location_id,
      label: `${l.display_name} (${l.location_type.replace(/_/g, " ")})`,
    }));
  }, [locationsQuery.data]);

  /* ── Error state ── */
  if (shipmentsQuery.error) {
    return (
      <ErrorState
        message={(shipmentsQuery.error as Error).message}
        onRetry={() => shipmentsQuery.refetch()}
      />
    );
  }

  /* ── Shipment data ── */
  const shipments = (shipmentsQuery.data?.data as InboundShipment[]) ?? [];
  const meta = shipmentsQuery.data?.meta;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Main table ── */}
      <DataTable
        columns={columns}
        rows={shipments}
        rowKey={(r) => r.shipment_id}
        loading={shipmentsQuery.isLoading}
        empty={{
          icon: <Package className="w-8 h-8" />,
          title: "No shipments yet",
          message:
            "Log your first inbound shipment to start tracking inventory arrivals.",
          action: canCreate ? (
            <Button
              variant="primary"
              icon={<Plus className="w-4 h-4" />}
              onClick={handleOpenCreate}
            >
              Log New Shipment
            </Button>
          ) : undefined,
        }}
        toolbar={
          <div className="flex items-center gap-3 flex-wrap w-full">
            <Truck className="w-4 h-4 text-text-muted" />
            <span className="text-[13px] font-semibold">Inbound Shipments</span>
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
              className="w-[180px] ml-auto"
            />
            {canCreate && (
              <Button
                variant="primary"
                size="sm"
                icon={<Plus className="w-4 h-4" />}
                onClick={handleOpenCreate}
              >
                Log New Shipment
              </Button>
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

      {/* ── Stepper preview for the first visible non-received shipment ── */}
      {shipments.length > 0 && shipments[0].status !== "received" && (
        <Card className="p-4">
          <div className="text-[12px] text-text-muted mb-1 font-semibold">
            {shipments[0].shipment_number} progress
          </div>
          <ShipmentStepper status={shipments[0].status} />
        </Card>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          CREATE SHIPMENT DRAWER
         ══════════════════════════════════════════════════════════════════════ */}
      <Drawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Log New Shipment"
        subtitle="Record an incoming shipment from a supplier or factory"
        wide
        footer={
          <div className="flex justify-end gap-2 p-4 border-t hairline">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
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

          {/* Line items */}
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
          RECEIVE SHIPMENT MODAL
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
          {/* Stepper for the shipment being received */}
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
              {/* Header */}
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
    </div>
  );
}
