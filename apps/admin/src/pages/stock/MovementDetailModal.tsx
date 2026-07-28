import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  Loader2,
  Wrench,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button, MoneyText } from "@/components/ui/primitives";
import { ErrorState, NumberField, Select } from "@/components/ui/controls";
import { formatDateTime } from "@/lib/format";
import { useAuthStore } from "@/stores/auth";
import { toast } from "@/stores/toast";
import { useStockMovement, useStockLevels, useStockMutations } from "./hooks";
import type { StockLevel, StockMovementDetail } from "./types";
import {
  MovementTypePill,
  StatusPill,
  FieldLabel,
  TextInput,
  InfoBanner,
} from "./parts";

/* ── Channel labels ────────────────────────────────────────────────── */
const CHANNEL_LABEL: Record<string, string> = {
  storefront: "Storefront",
  pos: "POS (in-store)",
  woocommerce: "WooCommerce",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  wholesale: "Wholesale",
  partner: "Retail partner",
  stylist_routed: "Stylist routed",
  subscription: "Subscription",
  phone: "Phone order",
  event: "Event",
  public_form: "Public order form",
  facebook: "Facebook",
  tiktok: "TikTok",
  intercompany: "Intercompany",
  sales_campaign: "Sales campaign",
  walk_in: "Walk-in",
};

const REFERENCE_LABEL: Record<string, string> = {
  sales_order: "Sales order",
  // POS was retired; historic movements still carry the type.
  pos_transaction: "POS transaction",
  adjustment: "Stock adjustment",
  transfer: "Stock transfer",
  inbound_shipment: "Inbound shipment",
  goods_received_note: "Goods reception",
  production_run: "Production run",
  consignment_movement: "Consignment movement",
  intercompany: "Intercompany trade",
};

/* Correction reasons → the backend's adjustment_type enum (stock.validator.js).
   Same mapping the Write-off drawer uses, so nothing 400s on submit. */
const CORRECTION_REASONS = [
  { value: "count", label: "Wrong count — recount says otherwise" },
  { value: "damage", label: "Damaged / broken" },
  { value: "theft", label: "Missing / theft" },
  { value: "found", label: "Found — extra units surfaced" },
  { value: "quality_reject", label: "Quality reject" },
  { value: "sample", label: "Given as sample / tester" },
  { value: "other", label: "Other" },
] as const;

/* ── Small presentational helpers ──────────────────────────────────── */
function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b hairline last:border-0">
      <span className="text-[11px] text-text-faint uppercase tracking-wide shrink-0 pt-0.5">
        {label}
      </span>
      <span className="text-[13px] text-text-primary text-right min-w-0 break-words">
        {value}
      </span>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[13px] border border-line bg-text-primary/[0.02] p-3.5">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="text-[12px] font-semibold text-text-primary">
          {title}
        </span>
        {action}
      </div>
      {children}
    </div>
  );
}

function signed(qty: number): string {
  return qty > 0 ? `+${qty}` : String(qty);
}

/* ── Correction request form ───────────────────────────────────────── */
/** Raises a stock adjustment for THIS movement's variant + location and
 *  submits it for approval — the "this movement is wrong, fix the count"
 *  path. It never edits the ledger (movements are append-only); it files the
 *  correction through the normal approval queue on the Adjustments tab. */
function CorrectionForm({
  movement,
  onDone,
}: {
  movement: StockMovementDetail;
  onDone: () => void;
}) {
  const [reason, setReason] = useState<string>("count");
  const [physical, setPhysical] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const mutations = useStockMutations();

  const levelsQ = useStockLevels({
    variant_id: movement.variant_id,
    location_id: movement.location_id,
    page_size: 50,
  });
  const levels: StockLevel[] = Array.isArray(levelsQ.data)
    ? levelsQ.data
    : ((levelsQ.data as { data?: StockLevel[] } | undefined)?.data ?? []);
  const level = levels.find(
    (l) =>
      l.variant_id === movement.variant_id &&
      l.location_id === movement.location_id,
  );
  const systemCount = level?.on_hand ?? null;

  const delta =
    physical === "" || systemCount === null
      ? null
      : Number(physical) - systemCount;

  const handleSubmit = async () => {
    if (systemCount === null || physical === "" || delta === 0) return;
    setSubmitting(true);
    try {
      const adj = await mutations.createAdjustment.mutateAsync({
        location_id: movement.location_id,
        adjustment_type: reason,
        // The movement number is the audit trail back to what went wrong —
        // it's what the approver sees in the queue.
        reason: `Correction for ${movement.movement_number}${
          note ? ` — ${note}` : ""
        }`,
        lines: [
          {
            variant_id: movement.variant_id,
            system_count: systemCount,
            physical_count: Number(physical),
            notes: note || undefined,
          },
        ],
      });
      await mutations.submitAdjustment.mutateAsync(adj.adjustment_id);
      toast.success("Correction submitted for approval", {
        description: `${adj.adjustment_number} is now in the Adjustments approval queue.`,
      });
      onDone();
    } catch {
      /* the failing mutation's own onError (hooks.ts) already toasted */
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3.5">
      <InfoBanner>
        <AlertTriangle className="w-3.5 h-3.5 inline-block mr-1 -mt-0.5" />
        Movements are append-only — nothing here edits{" "}
        {movement.movement_number}. This files a stock adjustment for approval;
        the count only changes once it is approved and posted.
      </InfoBanner>

      <div>
        <FieldLabel>What went wrong</FieldLabel>
        <Select
          value={reason}
          onChange={setReason}
          options={CORRECTION_REASONS.map((r) => ({
            value: r.value,
            label: r.label,
          }))}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>System count now</FieldLabel>
          <div className="h-[38px] flex items-center px-3 rounded-[11px] border border-line text-[13px] font-mono tabular-nums text-text-muted">
            {levelsQ.isLoading
              ? "Loading…"
              : systemCount === null
                ? "Unknown"
                : systemCount}
          </div>
        </div>
        <div>
          <FieldLabel>Correct physical count</FieldLabel>
          <NumberField
            value={physical}
            onChange={setPhysical}
            allowDecimal={false}
            allowNegative={false}
            placeholder={systemCount === null ? "0" : String(systemCount)}
          />
        </div>
      </div>

      {delta !== null && delta !== 0 && (
        <p className="text-[12px] text-text-muted">
          Adjustment of{" "}
          <span
            className={`font-mono font-semibold ${
              delta > 0 ? "text-success" : "text-danger"
            }`}
          >
            {signed(delta)}
          </span>{" "}
          unit{Math.abs(delta) === 1 ? "" : "s"} at{" "}
          {movement.location_name ?? "this location"}.
        </p>
      )}

      <div>
        <FieldLabel>Note for the approver</FieldLabel>
        <TextInput
          value={note}
          onChange={setNote}
          placeholder="e.g. sale logged twice, customer never collected"
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleSubmit}
          disabled={
            submitting || systemCount === null || physical === "" || delta === 0
          }
        >
          {submitting ? "Submitting…" : "Submit for approval"}
        </Button>
      </div>
    </div>
  );
}

/* ── Movement Detail Modal ─────────────────────────────────────────── */
/** Shared by the Overview "Recent Movements" strip and the Movements tab, so
 *  a movement reads the same wherever it is clicked. */
export function MovementDetailModal({
  movementId,
  onClose,
}: {
  movementId: string | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const can = useAuthStore((s) => s.can);
  const [correcting, setCorrecting] = useState(false);

  const { data, isLoading, isError, error, refetch } =
    useStockMovement(movementId);

  const handleClose = () => {
    setCorrecting(false);
    onClose();
  };

  const channel = useMemo(() => {
    const raw = data?.sales_channel || data?.order_sales_channel;
    return raw ? (CHANNEL_LABEL[raw] ?? raw.replace(/_/g, " ")) : null;
  }, [data]);

  const title = data ? `${data.movement_number}` : movementId ? "Movement" : "";

  return (
    <Modal
      open={!!movementId}
      onClose={handleClose}
      size="md"
      title={
        <span className="flex items-center gap-2.5">
          <span className="font-mono">{title}</span>
          {data && <MovementTypePill type={data.movement_type} />}
        </span>
      }
    >
      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-10 text-text-muted text-[13px]">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading movement…
        </div>
      )}

      {isError && (
        <ErrorState
          message={(error as Error)?.message}
          onRetry={() => refetch()}
        />
      )}

      {data && !isLoading && !isError && (
        <div className="flex flex-col gap-3.5">
          {correcting ? (
            <CorrectionForm movement={data} onDone={handleClose} />
          ) : (
            <>
              {/* What moved */}
              <Section title="What moved">
                <Row
                  label="Product"
                  value={
                    [data.product_name, data.variant_name]
                      .filter(Boolean)
                      .join(" — ") ||
                    data.sku ||
                    `Variant ${data.variant_id.slice(0, 8)}`
                  }
                />
                <Row label="SKU" value={data.sku ?? "—"} />
                <Row
                  label="Quantity"
                  value={
                    <span
                      className={`font-mono font-semibold ${
                        data.quantity > 0 ? "text-success" : "text-danger"
                      }`}
                    >
                      {signed(data.quantity)}
                    </span>
                  }
                />
                <Row
                  label="Location"
                  value={data.location_name ?? data.location_id.slice(0, 8)}
                />
                <Row
                  label="Unit cost"
                  value={
                    data.unit_cost_ngn ? (
                      <MoneyText ngn={Number(data.unit_cost_ngn)} />
                    ) : (
                      "—"
                    )
                  }
                />
                <Row label="When" value={formatDateTime(data.performed_at)} />
                <Row
                  label="Processed by"
                  value={
                    data.performed_by_name ??
                    (data.performed_by ? "—" : "System (automatic)")
                  }
                />
              </Section>

              {/* Where it came from */}
              <SourceSection
                movement={data}
                channel={channel}
                navigate={navigate}
              />

              {/* The rest of the same operation */}
              {data.related_movements && data.related_movements.length > 0 && (
                <Section
                  title={`Other lines in this operation (${data.related_movements.length})`}
                >
                  <div className="flex flex-col">
                    {data.related_movements.map((m) => (
                      <div
                        key={m.movement_id}
                        className="flex items-center justify-between gap-3 py-1.5 border-b hairline last:border-0"
                      >
                        <span className="text-[12px] text-text-primary truncate min-w-0">
                          {m.product_name ??
                            m.variant_name ??
                            m.sku ??
                            m.movement_number}
                        </span>
                        <span
                          className={`text-[12px] font-mono font-semibold shrink-0 ${
                            m.quantity > 0 ? "text-success" : "text-danger"
                          }`}
                        >
                          {signed(m.quantity)}
                        </span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {data.notes && (
                <Section title="Notes">
                  <p className="text-[13px] text-text-muted whitespace-pre-wrap">
                    {data.notes}
                  </p>
                </Section>
              )}

              {/* Correction path — files an adjustment through the normal
                  approval queue; never edits the append-only ledger. */}
              {can("stock", "create") && (
                <div className="flex justify-end">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Wrench className="w-4 h-4" />}
                    onClick={() => setCorrecting(true)}
                  >
                    This looks wrong — request a correction
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ── Source document section ───────────────────────────────────────── */
function SourceSection({
  movement: m,
  channel,
  navigate,
}: {
  movement: StockMovementDetail;
  channel: string | null;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const refType = m.reference_type ?? null;
  const refLabel = refType
    ? (REFERENCE_LABEL[refType] ?? refType.replace(/_/g, " "))
    : null;

  /* Manual / unlinked movement — say so plainly rather than showing blanks. */
  if (!refType || !m.reference_number) {
    return (
      <Section title="Where it came from">
        <Row
          label="Source"
          value={
            refLabel
              ? `${refLabel} (no linked document)`
              : "Logged directly in Stock"
          }
        />
        {channel && <Row label="Channel" value={channel} />}
        {m.reference_id && (
          <Row
            label="Reference id"
            value={
              <span className="font-mono text-[11px]">{m.reference_id}</span>
            }
          />
        )}
      </Section>
    );
  }

  const goto = (to: string, label: string) => (
    <Button
      variant="ghost"
      size="sm"
      icon={<ExternalLink className="w-3.5 h-3.5" />}
      onClick={() => navigate(to)}
    >
      {label}
    </Button>
  );

  if (refType === "sales_order" || refType === "pos_transaction") {
    return (
      <Section
        title="Where it came from"
        action={
          m.order_id
            ? goto(`/sales/orders/${m.order_id}`, "Open order")
            : undefined
        }
      >
        <Row
          label={refLabel ?? "Source"}
          value={<span className="font-mono">{m.reference_number}</span>}
        />
        <Row label="Customer" value={m.customer_name ?? "—"} />
        <Row label="Channel" value={channel ?? "—"} />
        <Row
          label="Order status"
          value={m.order_status ? <StatusPill status={m.order_status} /> : "—"}
        />
        {m.order_type && (
          <Row label="Order type" value={m.order_type.replace(/_/g, " ")} />
        )}
      </Section>
    );
  }

  if (refType === "adjustment") {
    return (
      <Section
        title="Where it came from"
        action={goto("/stock?tab=adjustments", "Open adjustments")}
      >
        <Row
          label="Adjustment"
          value={<span className="font-mono">{m.adjustment_number}</span>}
        />
        <Row
          label="Type"
          value={m.adjustment_type?.replace(/_/g, " ") ?? "—"}
        />
        <Row label="Reason" value={m.adjustment_reason ?? "—"} />
        <Row
          label="Status"
          value={
            m.adjustment_status ? (
              <StatusPill status={m.adjustment_status} />
            ) : (
              "—"
            )
          }
        />
        <Row label="Raised by" value={m.adjustment_created_by_name ?? "—"} />
        <Row
          label="Approved by"
          value={
            m.adjustment_approved_by_name
              ? `${m.adjustment_approved_by_name}${
                  m.adjustment_approved_at
                    ? ` · ${formatDateTime(m.adjustment_approved_at)}`
                    : ""
                }`
              : "—"
          }
        />
      </Section>
    );
  }

  if (refType === "transfer") {
    return (
      <Section
        title="Where it came from"
        action={goto("/stock?tab=transfers", "Open transfers")}
      >
        <Row
          label="Transfer"
          value={<span className="font-mono">{m.transfer_number}</span>}
        />
        <Row
          label="Route"
          value={
            <span className="inline-flex items-center gap-1.5">
              {m.transfer_from_location_name ?? "—"}
              <ArrowRight className="w-3 h-3 text-text-faint" />
              {m.transfer_to_location_name ?? "—"}
            </span>
          }
        />
        <Row
          label="Status"
          value={
            m.transfer_status ? <StatusPill status={m.transfer_status} /> : "—"
          }
        />
      </Section>
    );
  }

  if (refType === "inbound_shipment" || refType === "goods_received_note") {
    return (
      <Section
        title="Where it came from"
        action={goto("/stock?tab=receive", "Open goods reception")}
      >
        <Row
          label={refLabel ?? "Source"}
          value={<span className="font-mono">{m.shipment_number}</span>}
        />
        <Row
          label="Status"
          value={
            m.shipment_status ? <StatusPill status={m.shipment_status} /> : "—"
          }
        />
      </Section>
    );
  }

  return (
    <Section title="Where it came from">
      <Row label="Source" value={refLabel ?? "—"} />
      <Row
        label="Reference"
        value={<span className="font-mono">{m.reference_number}</span>}
      />
      {channel && <Row label="Channel" value={channel} />}
    </Section>
  );
}
