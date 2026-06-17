import { useState, useMemo } from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  Eye,
  Plus,
  Send,
  PackageCheck,
  Trash2,
} from "lucide-react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/primitives";
import { ErrorState, Select, NumberField, ConfirmDialog } from "@/components/ui/controls";
import { Drawer } from "@/components/ui/Drawer";
import { Modal } from "@/components/ui/Modal";
import { useAuthStore } from "@/stores/auth";
import {
  useStockTransfers,
  useStockTransfer,
  useStockLocations,
  useStockMutations,
} from "./hooks";
import type { StockTransfer, StockLocation } from "./types";
import {
  StatusPill,
  FieldLabel,
  TextInput,
  InfoBanner,
  Pagination,
} from "./parts";

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "dispatched", label: "Dispatched" },
  { value: "in_transit", label: "In transit" },
  { value: "received", label: "Received" },
  { value: "cancelled", label: "Cancelled" },
] as const;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ── Create Transfer Drawer ────────────────────────────────────────── */
interface DraftLine {
  variant_id: string;
  qty: string;
}

function CreateTransferDrawer({
  open,
  onClose,
  locations,
}: {
  open: boolean;
  onClose: () => void;
  locations: StockLocation[];
}) {
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ variant_id: "", qty: "" }]);

  const { createTransfer } = useStockMutations();

  const nonFbaLocations = useMemo(
    () =>
      locations
        .filter((l) => l.location_type !== "amazon_fba")
        .map((l) => ({ value: l.location_id, label: l.display_name })),
    [locations],
  );

  const allLocationOpts = useMemo(
    () => locations.map((l) => ({ value: l.location_id, label: l.display_name })),
    [locations],
  );

  const toLocation = locations.find((l) => l.location_id === toId);
  const isToFba = toLocation?.location_type === "amazon_fba";

  const updateLine = (idx: number, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const addLine = () => setLines((prev) => [...prev, { variant_id: "", qty: "" }]);

  const removeLine = (idx: number) => {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  };

  const canSave =
    fromId &&
    toId &&
    fromId !== toId &&
    lines.every((l) => l.variant_id.trim() && Number(l.qty) > 0);

  const handleSave = () => {
    if (!canSave) return;
    createTransfer.mutate(
      {
        from_location_id: fromId,
        to_location_id: toId,
        reason: notes || undefined,
        lines: lines.map((l) => ({
          variant_id: l.variant_id.trim(),
          qty_dispatched: Number(l.qty),
        })),
      },
      {
        onSuccess: () => {
          onClose();
          setFromId("");
          setToId("");
          setNotes("");
          setLines([{ variant_id: "", qty: "" }]);
        },
      },
    );
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New Transfer"
      subtitle="Move stock between locations"
      footer={
        <div className="flex justify-end gap-2 p-4 border-t hairline">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={!canSave || createTransfer.isPending}
          >
            {createTransfer.isPending ? "Saving..." : "Create Transfer"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <div>
          <FieldLabel>From location</FieldLabel>
          <Select
            value={fromId}
            onChange={setFromId}
            options={[{ value: "", label: "Select location" }, ...nonFbaLocations]}
          />
        </div>
        <div>
          <FieldLabel>To location</FieldLabel>
          <Select
            value={toId}
            onChange={setToId}
            options={[{ value: "", label: "Select location" }, ...allLocationOpts]}
          />
        </div>

        {isToFba && (
          <InfoBanner>
            This transfer represents stock moving from your Nigeria warehouse into Amazon FBA.
            Once dispatched, it will show at the FBA location on your Overview until Amazon reports
            individual units sold.
          </InfoBanner>
        )}

        <div>
          <FieldLabel>Notes (optional)</FieldLabel>
          <TextInput value={notes} onChange={setNotes} placeholder="Transfer notes" />
        </div>

        {/* Line items */}
        <div>
          <FieldLabel>Line items</FieldLabel>
          <div className="flex flex-col gap-3 mt-1">
            {lines.map((line, idx) => (
              <div key={idx} className="flex items-end gap-2">
                <div className="flex-1">
                  {idx === 0 && (
                    <span className="block text-[11px] text-text-faint mb-1">Variant ID</span>
                  )}
                  <TextInput
                    value={line.variant_id}
                    onChange={(v) => updateLine(idx, { variant_id: v })}
                    placeholder="UUID"
                  />
                </div>
                <div className="w-[100px]">
                  {idx === 0 && (
                    <span className="block text-[11px] text-text-faint mb-1">Qty</span>
                  )}
                  <NumberField
                    value={line.qty}
                    onChange={(v) => updateLine(idx, { qty: v })}
                    allowDecimal={false}
                    allowNegative={false}
                    placeholder="0"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeLine(idx)}
                  disabled={lines.length <= 1}
                  className="shrink-0 mb-px"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={addLine} className="mt-2" icon={<Plus className="w-3.5 h-3.5" />}>
            Add line
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

/* ── Receive Transfer Modal ────────────────────────────────────────── */
function ReceiveModal({
  transferId,
  onClose,
  locationMap,
}: {
  transferId: string | null;
  onClose: () => void;
  locationMap: Map<string, string>;
}) {
  const { data: transfer } = useStockTransfer(transferId);
  const { receiveTransfer } = useStockMutations();
  const [receivedQtys, setReceivedQtys] = useState<Record<string, string>>({});

  /* Seed received qtys from dispatched qty when transfer loads */
  const seeded = useMemo(() => {
    if (!transfer) return {};
    const map: Record<string, string> = {};
    for (const line of transfer.lines) {
      map[line.line_id] = String(line.qty_dispatched);
    }
    return map;
  }, [transfer]);

  const getQty = (lineId: string) => receivedQtys[lineId] ?? seeded[lineId] ?? "0";

  const handleConfirm = () => {
    if (!transfer) return;
    const lineUpdates = transfer.lines.map((line) => ({
      line_id: line.line_id,
      qty_received: Number(getQty(line.line_id)),
    }));
    receiveTransfer.mutate(
      { id: transfer.transfer_id, input: { lines: lineUpdates } },
      { onSuccess: onClose },
    );
  };

  if (!transferId) return null;

  return (
    <Modal open={!!transferId} onClose={onClose} title="Receive Transfer">
      {transfer ? (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-text-muted">
            {locationMap.get(transfer.from_location_id) ?? transfer.from_location_id.slice(0, 8)}
            <ArrowRight className="inline w-3.5 h-3.5 mx-1 text-text-faint" />
            {locationMap.get(transfer.to_location_id) ?? transfer.to_location_id.slice(0, 8)}
          </p>

          <div className="border border-line rounded-[11px] overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-text-faint text-[11px] uppercase tracking-wide">
                  <th className="px-3 py-2 border-b hairline">Variant</th>
                  <th className="px-3 py-2 border-b hairline text-right">Dispatched</th>
                  <th className="px-3 py-2 border-b hairline text-right">Received</th>
                </tr>
              </thead>
              <tbody>
                {transfer.lines.map((line) => (
                  <tr key={line.line_id} className="border-b hairline last:border-0">
                    <td className="px-3 py-2 font-mono text-text-primary">
                      {line.variant_id.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-muted">
                      {line.qty_dispatched}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <NumberField
                        value={getQty(line.line_id)}
                        onChange={(v) =>
                          setReceivedQtys((prev) => ({ ...prev, [line.line_id]: v }))
                        }
                        allowDecimal={false}
                        allowNegative={false}
                        className="w-[80px] ml-auto"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="py-6 text-center text-[13px] text-text-muted">Loading...</div>
      )}
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleConfirm}
          disabled={!transfer || receiveTransfer.isPending}
        >
          {receiveTransfer.isPending ? "Receiving..." : "Confirm Receipt"}
        </Button>
      </div>
    </Modal>
  );
}

/* ── View Transfer Modal ───────────────────────────────────────────── */
function ViewTransferModal({
  transferId,
  onClose,
  locationMap,
}: {
  transferId: string | null;
  onClose: () => void;
  locationMap: Map<string, string>;
}) {
  const { data: transfer } = useStockTransfer(transferId);

  if (!transferId) return null;

  return (
    <Modal open={!!transferId} onClose={onClose} title="Transfer Details">
      {transfer ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-[13px]">
            <span className="text-text-muted font-mono">{transfer.transfer_number}</span>
            <StatusPill status={transfer.status} />
          </div>
          <p className="text-[13px] text-text-muted">
            {locationMap.get(transfer.from_location_id) ?? transfer.from_location_id.slice(0, 8)}
            <ArrowRight className="inline w-3.5 h-3.5 mx-1 text-text-faint" />
            {locationMap.get(transfer.to_location_id) ?? transfer.to_location_id.slice(0, 8)}
          </p>
          {transfer.reason && (
            <p className="text-[12px] text-text-faint">{transfer.reason}</p>
          )}
          <div className="border border-line rounded-[11px] overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-text-faint text-[11px] uppercase tracking-wide">
                  <th className="px-3 py-2 border-b hairline">Variant</th>
                  <th className="px-3 py-2 border-b hairline text-right">Dispatched</th>
                  <th className="px-3 py-2 border-b hairline text-right">Received</th>
                  <th className="px-3 py-2 border-b hairline text-right">Variance</th>
                </tr>
              </thead>
              <tbody>
                {transfer.lines.map((line) => (
                  <tr key={line.line_id} className="border-b hairline last:border-0">
                    <td className="px-3 py-2 font-mono text-text-primary">
                      {line.variant_id.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-muted">
                      {line.qty_dispatched}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-muted">
                      {line.qty_received ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-muted">
                      {line.variance != null ? line.variance : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-[12px] text-text-faint">
            Created {fmtDate(transfer.created_at)}
            {transfer.dispatched_at && <> | Dispatched {fmtDate(transfer.dispatched_at)}</>}
            {transfer.received_at && <> | Received {fmtDate(transfer.received_at)}</>}
          </div>
        </div>
      ) : (
        <div className="py-6 text-center text-[13px] text-text-muted">Loading...</div>
      )}
    </Modal>
  );
}

/* ── TransfersTab ──────────────────────────────────────────────────── */
export default function TransfersTab() {
  const can = useAuthStore((s) => s.can);

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dispatchTarget, setDispatchTarget] = useState<StockTransfer | null>(null);
  const [receiveTargetId, setReceiveTargetId] = useState<string | null>(null);
  const [viewTargetId, setViewTargetId] = useState<string | null>(null);

  const {
    data: transfersData,
    isLoading,
    isError,
    error,
    refetch,
  } = useStockTransfers({
    status: statusFilter || undefined,
    page,
    page_size: PAGE_SIZE,
  });

  const { data: locations = [] } = useStockLocations();
  const { dispatchTransfer } = useStockMutations();

  const locationMap = useMemo(
    () => new Map(locations.map((l) => [l.location_id, l.display_name])),
    [locations],
  );

  const locName = (id: string) => locationMap.get(id) ?? id.slice(0, 8);

  /* ── Columns ──────────────────────────────────────────────────────── */
  const columns: Column<StockTransfer>[] = useMemo(
    () => [
      {
        key: "ref",
        header: "Transfer Ref",
        width: "140px",
        render: (r) => (
          <span className="text-[13px] font-mono text-text-primary">
            {r.transfer_number}
          </span>
        ),
      },
      {
        key: "route",
        header: "From / To",
        render: (r) => (
          <span className="text-[13px] text-text-muted flex items-center gap-1">
            {locName(r.from_location_id)}
            <ArrowRight className="w-3.5 h-3.5 text-text-faint shrink-0" />
            {locName(r.to_location_id)}
          </span>
        ),
      },
      {
        key: "status",
        header: "Status",
        width: "110px",
        render: (r) => <StatusPill status={r.status} />,
      },
      {
        key: "lines",
        header: "Lines",
        width: "60px",
        align: "right",
        render: (r) => (
          <span className="text-[13px] tabular-nums text-text-muted">
            {r.lines.length}
          </span>
        ),
      },
      {
        key: "created",
        header: "Created",
        width: "140px",
        render: (r) => (
          <span className="text-[13px] text-text-muted">{fmtDate(r.created_at)}</span>
        ),
      },
      {
        key: "actions",
        header: "Actions",
        width: "200px",
        render: (r) => (
          <div className="flex items-center gap-1.5">
            {r.status === "draft" && can("stock", "create") && (
              <Button
                variant="secondary"
                size="sm"
                icon={<Send className="w-3.5 h-3.5" />}
                onClick={(e) => {
                  e.stopPropagation();
                  setDispatchTarget(r);
                }}
              >
                Dispatch
              </Button>
            )}
            {(r.status === "dispatched" || r.status === "in_transit") && can("stock", "create") && (
              <Button
                variant="secondary"
                size="sm"
                icon={<PackageCheck className="w-3.5 h-3.5" />}
                onClick={(e) => {
                  e.stopPropagation();
                  setReceiveTargetId(r.transfer_id);
                }}
              >
                Receive
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              icon={<Eye className="w-3.5 h-3.5" />}
              onClick={(e) => {
                e.stopPropagation();
                setViewTargetId(r.transfer_id);
              }}
            >
              View
            </Button>
          </div>
        ),
      },
    ],
    [can, locationMap],
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

  const meta = transfersData?.meta;
  const rows = transfersData?.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Select
          value={statusFilter}
          onChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
          options={[...STATUS_OPTIONS]}
          className="w-[180px]"
        />
        <div className="flex-1" />
        {can("stock", "create") && (
          <Button
            variant="primary"
            size="sm"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => setDrawerOpen(true)}
          >
            New Transfer
          </Button>
        )}
      </div>

      {/* Data table */}
      <DataTable<StockTransfer>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.transfer_id}
        loading={isLoading}
        empty={{
          icon: <ArrowLeftRight className="w-6 h-6" />,
          title: "No transfers",
          message: "Create a transfer to move stock between locations within the same brand.",
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

      {/* Create drawer */}
      <CreateTransferDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        locations={locations}
      />

      {/* Dispatch confirm dialog */}
      <ConfirmDialog
        open={!!dispatchTarget}
        onClose={() => setDispatchTarget(null)}
        onConfirm={() => {
          if (!dispatchTarget) return;
          dispatchTransfer.mutate(dispatchTarget.transfer_id, {
            onSuccess: () => setDispatchTarget(null),
          });
        }}
        title="Dispatch Transfer"
        message={
          dispatchTarget
            ? `Dispatch ${dispatchTarget.lines.length} line${dispatchTarget.lines.length !== 1 ? "s" : ""} from ${locName(dispatchTarget.from_location_id)} to ${locName(dispatchTarget.to_location_id)}? Stock will be deducted from ${locName(dispatchTarget.from_location_id)} now and added to ${locName(dispatchTarget.to_location_id)} on receipt.`
            : ""
        }
        confirmLabel="Dispatch"
        tone="accent"
        busy={dispatchTransfer.isPending}
      />

      {/* Receive modal */}
      <ReceiveModal
        transferId={receiveTargetId}
        onClose={() => setReceiveTargetId(null)}
        locationMap={locationMap}
      />

      {/* View modal */}
      <ViewTransferModal
        transferId={viewTargetId}
        onClose={() => setViewTargetId(null)}
        locationMap={locationMap}
      />
    </div>
  );
}
