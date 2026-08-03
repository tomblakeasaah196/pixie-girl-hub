import { useEffect, useMemo, useRef, useState } from "react";
import { useUrlTab } from "@/hooks/useUrlTab";
import { useNavigate } from "react-router-dom";
import {
  Truck,
  Plus,
  Search,
  Package,
  MapPin,
  Phone,
  Loader2,
  ArrowRight,
  Ban,
  CheckCircle2,
  Clock,
  CircleAlert,
  Trash2,
  Scissors,
  ExternalLink,
  Mail,
  Camera,
} from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import { ModuleInsights } from "@/components/insights/ModuleInsights";
import { money, formatDateTime } from "@/lib/format";
import {
  Button,
  Card,
  Pill,
  Skeleton,
  EmptyState,
} from "@/components/ui/primitives";
import { ErrorState, DeniedState, Select } from "@/components/ui/controls";
import { Drawer } from "@/components/ui/Drawer";
import { Modal } from "@/components/ui/Modal";
import {
  useDeliveries,
  useDelivery,
  useCouriers,
  useCreateDelivery,
  useAdvanceDelivery,
  useCancelDelivery,
  useRecordAttempt,
  useRecordProof,
  useNotifyDelivered,
  STATUS_META,
  FLOW,
  ADVANCE_STATES,
  TAB_STATUSES,
  addressLine,
  useAddDeliveryCost,
  useRemoveDeliveryCost,
  useSetFeeWaiver,
  useDeliveryReconciliation,
  type Delivery,
  type DeliveryAddress,
  type DeliveryItem,
} from "@/lib/logistics-api";
import { searchContacts } from "@/pages/sales/api";
import { api } from "@/lib/api";
import { ShippingRatesTab } from "./ShippingRates";
import { AgenciesTab } from "./Agencies";
import { BookDeliveryModal } from "./BookDeliveryModal";
import { DeliveryCommsPanel } from "./DeliveryCommsPanel";

/**
 * Logistics (`/logistics`) — dispatch queue, tracking and proof of delivery.
 * Ports the hub-system UX onto this backend's delivery state machine.
 */

// Studio job status → short label + tone, so dispatchers see at a glance
// whether the wig is still being styled (and can pre-arrange the courier).
// `ready`/`handed`/`completed` mean the piece is out of the studio.
type StudioTone = "success" | "warn" | "info" | "danger" | "neutral";
const STUDIO_STATUS: Record<string, { label: string; tone: StudioTone }> = {
  pending: { label: "Studio: awaiting stylist", tone: "warn" },
  assigned: { label: "Studio: assigned", tone: "info" },
  in_progress: { label: "Studio: styling", tone: "info" },
  on_hold: { label: "Studio: on hold", tone: "warn" },
  returned_for_qc: { label: "Studio: in QC", tone: "warn" },
  qc_passed: { label: "Studio: QC passed", tone: "success" },
  rework: { label: "Studio: rework", tone: "warn" },
  ready_for_dispatch: { label: "Studio: ready ✓", tone: "success" },
  handed_to_sales: { label: "Studio: handed over ✓", tone: "success" },
  completed: { label: "Studio: done ✓", tone: "success" },
  rejected: { label: "Studio: rejected", tone: "danger" },
  cancelled: { label: "Studio: cancelled", tone: "neutral" },
};
// Whether the wig is still physically in the studio (dispatch must wait).
const STUDIO_IN_PROGRESS = new Set([
  "pending",
  "assigned",
  "in_progress",
  "on_hold",
  "returned_for_qc",
  "rework",
]);

// Readiness, computed server-side from the order + studio status. Older
// payloads may omit it, in which case we treat the row as ready rather than
// hiding it in the "not ready" band.
const READINESS_LABEL: Record<string, string> = {
  awaiting_studio: "Still in the studio",
  awaiting_fulfilment: "Order not packed yet",
  order_blocked: "Order cancelled or refunded",
};
const isReady = (d: { readiness?: string }) =>
  !d.readiness || d.readiness === "ready";

type Tab =
  | "queue"
  | "active"
  | "delivered"
  | "issues"
  | "all"
  | "reconciliation"
  | "rates"
  | "agencies";

const TABS: { key: Tab; label: string }[] = [
  { key: "queue", label: "Queue" },
  { key: "active", label: "Active" },
  { key: "delivered", label: "Delivered" },
  { key: "issues", label: "Issues" },
  { key: "all", label: "All" },
  { key: "reconciliation", label: "Reconciliation" },
  { key: "agencies", label: "Agencies" },
  { key: "rates", label: "Shipping Rates" },
];

const NON_LIST_TABS = new Set<Tab>(["rates", "agencies", "reconciliation"]);

export function LogisticsPage() {
  useBreadcrumbs([{ label: "Logistics" }]);
  const { can } = useAuthStore();
  const [tab, setTab] = useUrlTab<Tab>(
    "queue",
    TABS.map((t) => t.key),
  );
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const deliveriesQ = useDeliveries({ q: search || undefined });
  const all = deliveriesQ.data ?? [];

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of Object.keys(TAB_STATUSES)) {
      const set = new Set(TAB_STATUSES[t]);
      const inTab = all.filter((d) => set.has(d.status));
      // The Queue badge counts only what can actually be dispatched. A badge
      // that includes rows you cannot act on is a number people learn to
      // ignore — the not-ready count gets its own band header instead.
      c[t] =
        t === "queue"
          ? inTab.filter((d) => isReady(d)).length
          : inTab.length;
    }
    return c;
  }, [all]);

  const rows = useMemo(() => {
    if (tab === "all" || NON_LIST_TABS.has(tab)) return all;
    const set = new Set(TAB_STATUSES[tab]);
    return all.filter((d) => set.has(d.status));
  }, [all, tab]);

  // Queue is banded: actionable rows on top, everything still waiting on the
  // studio or on fulfilment below. Unready deliveries stay visible — seeing
  // what's coming is how dispatch pre-arranges couriers for out-of-state drops.
  const queueBands = useMemo(() => {
    if (tab !== "queue") return null;
    return {
      ready: rows.filter((d) => isReady(d)),
      notReady: rows.filter((d) => !isReady(d)),
    };
  }, [rows, tab]);

  if (!can("logistics", "view")) {
    return <DeniedState message="You don't have access to Logistics." />;
  }

  return (
    <div className="max-w-[1180px] space-y-5">
      <ModuleInsights module="logistics" />
      {!NON_LIST_TABS.has(tab) && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center flex-1 min-w-[220px] max-w-md rounded-[11px] bg-text-primary/[0.04] border border-line focus-within:border-accent/50 px-3">
            <Search className="w-4 h-4 text-text-faint" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search deliveries (number, recipient)…"
              className="w-full bg-transparent px-2 h-[42px] text-[13px] outline-none" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
            />
          </div>
          <div className="flex items-center gap-2">
            {can("logistics", "create") && (
              <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)}>
                New delivery
              </Button>
            )}
          </div>
        </div>
      )}

      <nav className="flex items-center gap-1 border-b border-line overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-[13px] font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors ${
              tab === t.key
                ? "border-accent text-accent-glow"
                : "border-transparent text-text-muted hover:text-text-primary"
            }`}
          >
            {t.label}
            {t.key !== "all" && !NON_LIST_TABS.has(t.key) && counts[t.key] > 0 && (
              <span className="text-[10.5px] rounded-full bg-accent/[0.15] text-accent-glow px-1.5 py-px">
                {counts[t.key]}
              </span>
            )}
          </button>
        ))}
      </nav>

      {tab === "rates" ? (
        <ShippingRatesTab />
      ) : tab === "agencies" ? (
        <AgenciesTab />
      ) : tab === "reconciliation" ? (
        <ReconciliationTab />
      ) : deliveriesQ.isLoading ? (
        <Card className="p-4 space-y-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} style={{ height: 52 }} />)}
        </Card>
      ) : deliveriesQ.isError ? (
        <ErrorState onRetry={() => deliveriesQ.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Truck className="w-7 h-7" />}
          title="No deliveries here"
          message="Create a delivery to dispatch an order, transfer, or sample."
          action={
            can("logistics", "create") ? (
              <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)}>
                New delivery
              </Button>
            ) : undefined
          }
        />
      ) : queueBands ? (
        <div className="space-y-4">
          <DeliveryBand
            title="Ready to dispatch"
            rows={queueBands.ready}
            onOpen={setDetailId}
            emptyMessage="Nothing is ready to dispatch right now."
          />
          {queueBands.notReady.length > 0 && (
            <DeliveryBand
              title="Not ready yet"
              subtitle="Waiting on the studio or on fulfilment. Visible so couriers can be pre-arranged — but not dispatchable."
              rows={queueBands.notReady}
              onOpen={setDetailId}
              muted
            />
          )}
        </div>
      ) : (
        <DeliveryList rows={rows} onOpen={setDetailId} />
      )}

      {creating && <CreateDeliveryDrawer onClose={() => setCreating(false)} />}
      {detailId && (
        <DeliveryDetailDrawer id={detailId} onClose={() => setDetailId(null)} />
      )}
    </div>
  );
}

// ── List rendering ──────────────────────────────────────────

function DeliveryBand({
  title,
  subtitle,
  rows,
  onOpen,
  muted,
  emptyMessage,
}: {
  title: string;
  subtitle?: string;
  rows: Delivery[];
  onOpen: (id: string) => void;
  muted?: boolean;
  emptyMessage?: string;
}) {
  return (
    <section>
      <header className="flex items-baseline gap-2 mb-2 px-0.5">
        <h3 className="text-[12.5px] font-semibold text-text-primary">{title}</h3>
        <span className="text-[11px] text-text-faint">{rows.length}</span>
        {subtitle && (
          <span className="text-[11px] text-text-faint hidden md:inline">
            · {subtitle}
          </span>
        )}
      </header>
      {rows.length === 0 ? (
        <Card className="p-4 text-[12.5px] text-text-faint">
          {emptyMessage ?? "Nothing here."}
        </Card>
      ) : (
        <DeliveryList rows={rows} onOpen={onOpen} muted={muted} />
      )}
    </section>
  );
}

function DeliveryList({
  rows,
  onOpen,
  muted,
}: {
  rows: Delivery[];
  onOpen: (id: string) => void;
  muted?: boolean;
}) {
  return (
    <Card className={`p-0 overflow-hidden ${muted ? "opacity-70" : ""}`}>
          {rows.map((d, i) => (
            <button
              key={d.delivery_id}
              onClick={() => onOpen(d.delivery_id)}
              className={`w-full text-left p-4 flex items-center gap-3 hover:bg-text-primary/[0.03] transition-colors ${
                i < rows.length - 1 ? "border-b border-line" : ""
              }`}
            >
              <span className="grid place-items-center w-10 h-10 rounded-xl bg-panel-2 text-accent-glow border border-line shrink-0">
                <Package className="w-5 h-5" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[12px] text-text-faint">{d.delivery_number}</span>
                  {d.order_number && (
                    <span className="font-mono text-[11px] text-text-muted">· {d.order_number}</span>
                  )}
                  <Pill tone={STATUS_META[d.status]?.tone ?? "neutral"}>
                    {STATUS_META[d.status]?.label ?? d.status}
                  </Pill>
                  {/* Fulfilment type: dispatch = delivery, collection/walk_in = pickup */}
                  {d.order_type && (
                    <Pill
                      tone={d.order_type === "dispatch" ? "accent" : "neutral"}
                      dot={false}
                    >
                      {d.order_type === "dispatch" ? "Delivery" : "Pickup"}
                    </Pill>
                  )}
                  {d.is_pay_on_delivery && <Pill tone="warn" dot={false}>POD</Pill>}
                  {/* Styling status — dispatchers can see whether the wig is
                      still in the studio before booking a courier. */}
                  {d.service_job_status && STUDIO_STATUS[d.service_job_status] && (
                    <Pill
                      tone={STUDIO_STATUS[d.service_job_status].tone}
                      dot={false}
                    >
                      <Scissors className="w-3 h-3 inline mr-1" />
                      {STUDIO_STATUS[d.service_job_status].label}
                    </Pill>
                  )}
                  {/* Why this row can't be dispatched yet. */}
                  {!isReady(d) && READINESS_LABEL[d.readiness ?? ""] && (
                    <Pill tone="neutral" dot={false}>
                      {READINESS_LABEL[d.readiness ?? ""]}
                    </Pill>
                  )}
                  {/* Cost overran what the customer paid. */}
                  {d.has_delivery_loss && (
                    <Pill tone="danger" dot={false}>
                      Loss {money(Number(d.delivery_loss_ngn ?? 0))}
                    </Pill>
                  )}
                  {/* Delivered but nobody recorded what it cost — this reads as
                      pure profit in the report until someone fills it in. */}
                  {d.status === "delivered" && !d.cost_recorded_at && (
                    <Pill tone="warn" dot={false}>
                      Cost not recorded
                    </Pill>
                  )}
                </div>
                <div className="text-[13px] mt-0.5 truncate">
                  {d.customer_name || d.recipient_name_snapshot || d.delivery_address_snapshot?.recipient_name || "—"}
                </div>
                <div className="text-[11.5px] text-text-faint truncate">
                  {addressLine(d.delivery_address_snapshot)}
                </div>
              </div>
              <div className="text-right shrink-0 hidden sm:block">
                {d.courier_name && (
                  <div className="text-[11.5px] text-text-muted">{d.courier_name}</div>
                )}
                {/* Customer-billed delivery fee (from the order), falling back to
                    the courier cost when the order fee isn't set. */}
                {d.order_shipping_fee_ngn != null && Number(d.order_shipping_fee_ngn) > 0 ? (
                  <div className="font-mono text-[12px]">{money(Number(d.order_shipping_fee_ngn))}</div>
                ) : d.courier_fee_ngn != null ? (
                  <div className="font-mono text-[12px]">{money(d.courier_fee_ngn)}</div>
                ) : null}
                <div className="text-[10.5px] text-text-faint">charged to client</div>
                {/* Completion attribution — who signed this off, and when. */}
                {d.status === "delivered" && (
                  <div className="mt-1.5 pt-1.5 border-t border-line/60">
                    <div className="text-[10.5px] text-text-faint">
                      {formatDateTime(d.completed_at ?? d.delivered_at)}
                    </div>
                    <div className="text-[11px] text-text-muted truncate max-w-[160px]">
                      {d.completed_by_name ?? "Driver-confirmed (legacy link)"}
                    </div>
                  </div>
                )}
              </div>
            </button>
          ))}
    </Card>
  );
}

// ── Detail drawer ───────────────────────────────────────────

function DeliveryDetailDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAuthStore();
  const navigate = useNavigate();
  const detailQ = useDelivery(id);
  const advance = useAdvanceDelivery();
  const cancel = useCancelDelivery();
  const attempt = useRecordAttempt();
  const proof = useRecordProof();
  const notifyDelivered = useNotifyDelivered();
  const [booking, setBooking] = useState(false);
  const [uploadingProof, setUploadingProof] = useState(false);
  const proofInputRef = useRef<HTMLInputElement>(null);

  const d = detailQ.data;
  const canEdit = can("logistics", "edit");
  const canCancel = can("logistics", "delete");

  const nextStates = d ? (FLOW[d.status] ?? []) : [];
  const advanceTargets = nextStates.filter((s) => ADVANCE_STATES.has(s));
  const canRecordAttempt = nextStates.includes("attempted_failed");
  const canCancelNow = canCancel && nextStates.includes("cancelled");
  const busy =
    advance.isPending || cancel.isPending || attempt.isPending || proof.isPending || uploadingProof;

  // "Mark delivered" is offered from any live state, not just out_for_delivery.
  // Riders phone in "delivered" without anyone having clicked through the
  // intermediate states; the API records the skip rather than refusing it.
  const TERMINAL_STATES = new Set([
    "delivered",
    "returned_to_sender",
    "cancelled",
    "lost",
    "damaged",
  ]);
  const canMarkDelivered =
    canEdit && d != null && !TERMINAL_STATES.has(d.status);
  const isDeliveredShortcut =
    canMarkDelivered && !advanceTargets.includes("delivered");

  const [marking, setMarking] = useState(false);
  const [cancelling, setCancelling] = useState(false);


  async function uploadProof(file: File) {
    if (!d) return;
    setUploadingProof(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("document_type", "delivery_proof");
      form.append("reference_type", "delivery");
      form.append("reference_id", d.delivery_id);
      const doc = await api.postForm<{ document_id: string }>("/documents", form);
      await proof.mutateAsync({ id, proof_type: "photo_at_door", document_id: doc.document_id });
    } finally {
      setUploadingProof(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={d ? d.delivery_number : "Delivery"}
      subtitle={d ? STATUS_META[d.status]?.label : ""}
    >
      {detailQ.isLoading || !d ? (
        <div className="p-1 space-y-3">
          <Skeleton style={{ height: 24, width: "50%" }} />
          <Skeleton style={{ height: 80 }} />
        </div>
      ) : (
        <div className="space-y-4 p-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Pill tone={STATUS_META[d.status]?.tone ?? "neutral"}>
              {STATUS_META[d.status]?.label ?? d.status}
            </Pill>
            {d.order_number && (
              <button
                type="button"
                onClick={() => navigate(`/sales/orders/${d.order_id}`)}
                className="font-mono text-[11px] text-accent hover:underline inline-flex items-center gap-1"
              >
                <Package className="w-3 h-3" />
                {d.order_number}
              </button>
            )}
          </div>

          {/* Styling status — the wig may still be in the studio. Dispatch can
              see the stage and jump to the exact job to pre-arrange a courier
              (or hold off booking until it's out of QC). */}
          {d.service_job_status && (
            <div
              className={`rounded-xl border p-3 flex items-center justify-between gap-2 ${
                STUDIO_IN_PROGRESS.has(d.service_job_status)
                  ? "border-warn/30 bg-warn/[0.05]"
                  : "border-success/25 bg-success/[0.05]"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Scissors className="w-4 h-4 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold">
                    {STUDIO_STATUS[d.service_job_status]?.label ??
                      `Studio: ${d.service_job_status}`}
                  </div>
                  {d.service_job_number && (
                    <div className="text-[11px] text-text-faint font-mono">
                      {d.service_job_number}
                      {STUDIO_IN_PROGRESS.has(d.service_job_status)
                        ? " · still in studio"
                        : " · out of studio"}
                    </div>
                  )}
                </div>
              </div>
              {d.service_job_id && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<ExternalLink className="w-3.5 h-3.5" />}
                  onClick={() =>
                    navigate(
                      `/service-jobs?tab=board&job=${d.service_job_id}`,
                    )
                  }
                >
                  Studio
                </Button>
              )}
            </div>
          )}

          {/* Recipient + address */}
          <div className="rounded-xl border border-line p-3 space-y-1.5">
            <div className="flex items-center gap-2 text-[13.5px] font-medium">
              {d.recipient_name_snapshot || d.delivery_address_snapshot?.recipient_name || "—"}
            </div>
            {(d.recipient_phone_snapshot || d.delivery_address_snapshot?.phone) && (
              <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
                <Phone className="w-3.5 h-3.5" />
                {d.recipient_phone_snapshot || d.delivery_address_snapshot?.phone}
              </div>
            )}
            <div className="flex items-start gap-1.5 text-[12px] text-text-muted">
              <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              {addressLine(d.delivery_address_snapshot)}
            </div>
          </div>

          {/* Meta */}
          <dl className="grid grid-cols-2 gap-y-2 gap-x-4 text-[12.5px]">
            {d.courier_name && <Meta label="Courier" value={d.courier_name} />}
            {d.courier_fee_ngn != null && <Meta label="Fee" value={money(d.courier_fee_ngn)} />}
            {d.courier_tracking_ref && <Meta label="Tracking" value={d.courier_tracking_ref} mono />}
            {d.is_pay_on_delivery && (
              <Meta label="POD expected" value={money(d.pod_amount_expected_ngn ?? 0)} />
            )}
            {d.expected_delivery_at && (
              <Meta label="ETA" value={formatDateTime(d.expected_delivery_at)} />
            )}
          </dl>

          {d.delivery_instructions && (
            <div>
              <div className="micro mb-1">Instructions</div>
              <p className="text-[12.5px] text-text-muted">{d.delivery_instructions}</p>
            </div>
          )}

          {/* Completed-by — the headline answer to "who followed this up". */}
          {d.status === "delivered" && (
            <div className="rounded-xl border border-line bg-panel-2/40 p-3">
              <div className="micro mb-1.5">Completed</div>
              <div className="flex items-center gap-2 text-[12.5px]">
                <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                <span className="font-mono">
                  {formatDateTime(d.completed_at ?? d.delivered_at)}
                </span>
              </div>
              <div className="text-[12px] text-text-muted mt-1">
                {d.completed_by_name ? (
                  <>
                    by <span className="font-medium">{d.completed_by_name}</span>
                    {d.completed_by_job_title && (
                      <span className="text-text-faint"> · {d.completed_by_job_title}</span>
                    )}
                  </>
                ) : (
                  // Rows completed through the retired public driver link have
                  // no staff user behind them.
                  <span className="text-text-faint">
                    Driver-confirmed via the retired public link — no staff member recorded
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Timeline. Server returns this as `history`; each entry carries the
              resolved staff name behind the status change. */}
          {d.history && d.history.length > 0 && (
            <div>
              <div className="micro mb-2">Timeline</div>
              <div className="space-y-1.5">
                {d.history.map((h, i) => (
                  <div key={h.history_id ?? i} className="flex items-start gap-2 text-[11.5px] text-text-muted">
                    <Clock className="w-3 h-3 text-text-faint mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <span className="font-medium">{STATUS_META[h.to_status]?.label ?? h.to_status}</span>
                      {h.changed_at && (
                        <span className="text-text-faint ml-1.5 font-mono">
                          {formatDateTime(h.changed_at)}
                        </span>
                      )}
                      {h.actor_name && (
                        <span className="text-text-faint ml-1.5">· {h.actor_name}</span>
                      )}
                      {h.changed_by_source === "system" && (
                        <span className="text-text-faint ml-1.5 italic">· inferred</span>
                      )}
                      {h.notes && (
                        <div className="text-[11px] text-text-faint truncate">{h.notes}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Cost + loss */}
          <DeliveryCostPanel delivery={d} canEdit={canEdit} />

          {/* What the customer has been told, and whether it landed. The
              booking notice can only be (re)sent once a courier is booked. */}
          <DeliveryCommsPanel
            deliveryId={id}
            canEdit={canEdit}
            canNotify={d.status !== "queued"}
          />

          {/* Delivered-confirmation email — auto-sent, but staff can resend */}
          {d.status === "delivered" && canEdit && (
            <div className="rounded-xl border border-line p-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[12.5px] font-medium">Delivered-confirmation email</div>
                <div className="text-[11px] text-text-faint truncate">
                  {notifyDelivered.data
                    ? notifyDelivered.data.sent
                      ? "Sent."
                      : `Not sent (${notifyDelivered.data.reason ?? "no email on file"}).`
                    : "Sent automatically when marked delivered."}
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={notifyDelivered.isPending}
                icon={notifyDelivered.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                onClick={() => notifyDelivered.mutate(id)}
              >
                Send now
              </Button>
            </div>
          )}

          {/* Actions */}
          {canEdit && (
            <div className="space-y-2 pt-2 border-t border-line">
              <div className="micro">Update status</div>

              {d.status === "queued" && (
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => setBooking(true)}
                  icon={<Truck className="w-4 h-4" />}
                >
                  Book delivery
                </Button>
              )}

              {(advanceTargets.length > 0 || canMarkDelivered) && (
                <div className="flex flex-wrap gap-2">
                  {advanceTargets
                    .filter((s) => s !== "delivered")
                    .map((s) => (
                      <Button
                        key={s}
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => advance.mutate({ id, to_status: s })}
                        icon={<ArrowRight className="w-4 h-4" />}
                      >
                        {STATUS_META[s]?.label ?? s}
                      </Button>
                    ))}
                  {/* Always available while the delivery is live — the common
                      case is a rider calling it in from an earlier state. */}
                  {canMarkDelivered && (
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busy}
                      onClick={() => setMarking(true)}
                      icon={<CheckCircle2 className="w-4 h-4" />}
                    >
                      Mark delivered
                    </Button>
                  )}
                </div>
              )}

              {canRecordAttempt && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    attempt.mutate({ id, outcome: "recipient_unavailable" })
                  }
                  icon={<CircleAlert className="w-4 h-4" />}
                >
                  Record failed attempt
                </Button>
              )}

              <div className="flex flex-wrap gap-2">
                <input
                  ref={proofInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadProof(file);
                    e.target.value = "";
                  }}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => proofInputRef.current?.click()}
                  icon={uploadingProof ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                >
                  Upload proof photo
                </Button>
                {canCancelNow && (
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    onClick={() => setCancelling(true)}
                    icon={<Ban className="w-4 h-4" />}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {booking && d && <BookDeliveryModal delivery={d} onClose={() => setBooking(false)} />}
      {marking && d && (
        <MarkDeliveredModal
          delivery={d}
          isShortcut={Boolean(isDeliveredShortcut)}
          onClose={() => setMarking(false)}
        />
      )}
      {cancelling && d && (
        <ReasonModal
          title="Cancel delivery"
          message="This closes the delivery without completing it. The reason is recorded on the timeline."
          label="Reason for cancelling"
          confirmLabel="Cancel delivery"
          tone="danger"
          busy={cancel.isPending}
          onClose={() => setCancelling(false)}
          onConfirm={(reason) => {
            cancel.mutate(
              { id, reason: reason || undefined },
              { onSuccess: () => setCancelling(false) },
            );
          }}
        />
      )}
    </Drawer>
  );
}

// ── Create drawer ───────────────────────────────────────────

interface ContactHit {
  contact_id: string;
  display_name: string;
  primary_phone?: string | null;
}

// ── Branded dialogs ─────────────────────────────────────────

/**
 * A reason capture — replaces `window.prompt`, which is unstyled browser
 * chrome and breaks the design canon.
 */
function ReasonModal({
  title,
  message,
  label,
  placeholder,
  confirmLabel,
  tone = "accent",
  required,
  busy,
  onClose,
  onConfirm,
}: {
  title: string;
  message?: string;
  label: string;
  placeholder?: string;
  confirmLabel: string;
  tone?: "accent" | "danger";
  required?: boolean;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const ok = !required || reason.trim().length > 0;
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            disabled={!ok || busy}
            onClick={() => onConfirm(reason.trim())}
            icon={busy ? <Loader2 className="w-4 h-4 animate-spin" /> : undefined}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {message && (
          <p className="text-[12.5px] text-text-muted leading-relaxed">{message}</p>
        )}
        <label className="block">
          <span className="block text-[11.5px] text-text-muted mb-1.5">
            {label}
            {required && <span className="text-danger"> *</span>}
          </span>
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={placeholder}
            className="w-full bg-transparent border border-line rounded-lg px-2.5 h-[38px] text-[13px] outline-none focus:border-accent/50"
            autoComplete="off"
          />
        </label>
      </div>
    </Modal>
  );
}

/**
 * Marking a delivery delivered.
 *
 * Completion is the ONLY moment the cost is actually knowable — the dispatcher
 * is on the phone with the rider right now. Once the delivery drops out of the
 * actionable queue nobody opens it again, and an uncosted delivery doesn't
 * report as "unknown", it reports as ₦0 paid out — i.e. 100% margin. That
 * silently inflates the P&L and buries the genuine losses. So when nothing has
 * been costed yet, the agency and the amount are REQUIRED here.
 *
 * The API enforces the same rule; this dialog exists so the requirement is met
 * at the natural moment rather than surfacing as a rejected request.
 */
function MarkDeliveredModal({
  delivery: d,
  isShortcut,
  onClose,
}: {
  delivery: Delivery;
  isShortcut: boolean;
  onClose: () => void;
}) {
  const couriersQ = useCouriers();
  const couriers = (couriersQ.data ?? []).filter((c) => c.is_active);
  const addCost = useAddDeliveryCost();
  const advance = useAdvanceDelivery();

  const needsCost = (d.costs ?? []).length === 0 && !d.fee_waiver_reason;
  const [courierId, setCourierId] = useState(d.courier_id || "");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const revenue = Number(d.order_shipping_fee_ngn ?? 0);
  const paid = needsCost ? Number(amount || 0) : Number(d.courier_fee_ngn ?? 0);
  const margin = revenue - paid;
  const ready = needsCost ? Boolean(courierId) && Number(amount) > 0 : true;
  const busy = addCost.isPending || advance.isPending;

  async function confirm() {
    setError(null);
    try {
      if (needsCost) {
        await addCost.mutateAsync({
          id: d.delivery_id,
          amount_ngn: Number(amount),
          courier_id: courierId,
          cost_type: "outbound",
          notes: notes.trim() || undefined,
        });
      }
      await advance.mutateAsync({ id: d.delivery_id, to_status: "delivered" });
      onClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't mark this delivery delivered.",
      );
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Mark delivered"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!ready || busy}
            onClick={confirm}
            icon={
              busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )
            }
          >
            Confirm delivered
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {isShortcut && (
          <div className="rounded-xl border border-warn/40 bg-warn/[0.07] p-3 flex items-start gap-2">
            <CircleAlert className="w-4 h-4 text-warn shrink-0 mt-px" />
            <div className="text-[12px]">
              <div className="font-medium text-warn">
                This delivery is &lsquo;{STATUS_META[d.status]?.label ?? d.status}&rsquo;
              </div>
              <div className="text-text-muted">
                Marking it delivered skips the states in between. The skip is
                recorded on the timeline — nothing is lost.
              </div>
            </div>
          </div>
        )}

        {needsCost ? (
          <>
            <div>
              <div className="text-[12.5px] font-medium">
                What did this delivery cost us?
              </div>
              <p className="text-[11.5px] text-text-faint mt-0.5">
                Required. Recorded now while you have the figure — a delivery
                with no cost reports as pure profit and hides real losses.
              </p>
            </div>

            <label className="block">
              <span className="block text-[11.5px] text-text-muted mb-1.5">
                Agency / courier <span className="text-danger">*</span>
              </span>
              <Select
                value={courierId}
                onChange={setCourierId}
                ariaLabel="Agency"
                options={
                  couriers.length
                    ? couriers.map((c) => ({
                        value: c.courier_id,
                        label: c.display_name,
                      }))
                    : [{ value: "", label: "No active agencies — add one first" }]
                }
              />
            </label>

            <label className="block">
              <span className="block text-[11.5px] text-text-muted mb-1.5">
                Amount paid (₦) <span className="text-danger">*</span>
              </span>
              <input
                autoFocus
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-transparent border border-line rounded-lg px-2.5 h-[38px] text-[13px] font-mono outline-none focus:border-accent/50"
                autoComplete="off"
              />
            </label>

            <label className="block">
              <span className="block text-[11.5px] text-text-muted mb-1.5">
                Note (optional)
              </span>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Waybill number, who paid, anything useful later"
                className="w-full bg-transparent border border-line rounded-lg px-2.5 h-[38px] text-[13px] outline-none focus:border-accent/50"
                autoComplete="off"
              />
            </label>
          </>
        ) : (
          <p className="text-[12.5px] text-text-muted">
            Cost already recorded for this delivery. Confirm to complete it.
          </p>
        )}

        {/* Live margin — the overspend is visible before the save, not after. */}
        <div className="rounded-xl border border-line p-3 grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-[10.5px] text-text-faint">Charged</div>
            <div className="font-mono text-[12.5px]">{money(revenue)}</div>
          </div>
          <div>
            <div className="text-[10.5px] text-text-faint">Paid out</div>
            <div className="font-mono text-[12.5px]">{money(paid)}</div>
          </div>
          <div>
            <div className="text-[10.5px] text-text-faint">Margin</div>
            <div
              className={`font-mono text-[12.5px] ${margin < 0 ? "text-danger" : "text-success"}`}
            >
              {money(margin)}
            </div>
          </div>
        </div>

        {margin < 0 && (
          <div className="rounded-lg border border-danger/40 bg-danger/[0.07] p-2.5 text-[11.5px]">
            <span className="font-medium text-danger">
              This delivery loses {money(Math.abs(margin))}.
            </span>{" "}
            <span className="text-text-faint">
              It will still be saved — the money was spent — and flagged as a
              loss in the reconciliation report.
            </span>
          </div>
        )}

        {error && <p className="text-[12px] text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

// ── Delivery cost + loss ────────────────────────────────────

/**
 * What this delivery actually cost us, against what the customer paid for
 * shipping. Entering a cost above the collected fee is allowed — the money was
 * genuinely spent — but the shortfall is computed and flagged immediately.
 */
function DeliveryCostPanel({
  delivery: d,
  canEdit,
}: {
  delivery: Delivery;
  canEdit: boolean;
}) {
  const addCost = useAddDeliveryCost();
  const removeCost = useRemoveDeliveryCost();
  const setWaiver = useSetFeeWaiver();
  const [amount, setAmount] = useState("");
  const [costType, setCostType] = useState("outbound");
  const [notes, setNotes] = useState("");
  const [adding, setAdding] = useState(false);
  const [waiving, setWaiving] = useState(false);

  const revenue = Number(d.order_shipping_fee_ngn ?? 0);
  const cost = Number(d.courier_fee_ngn ?? 0);
  const margin = revenue - cost;
  const costs = d.costs ?? [];

  // Live preview of what this entry would do to the margin, so the overspend
  // is visible before the save rather than after it.
  const pending = Number(amount || 0);
  const projectedLoss = pending > 0 ? Math.max(cost + pending - revenue, 0) : 0;

  async function submit() {
    if (!(pending > 0)) return;
    await addCost.mutateAsync({
      id: d.delivery_id,
      amount_ngn: pending,
      cost_type: costType,
      notes: notes || undefined,
    });
    setAmount("");
    setNotes("");
    setAdding(false);
  }

  return (
    <div className="rounded-xl border border-line p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="micro">Delivery cost</div>
        {d.status === "delivered" && !d.cost_recorded_at && (
          <Pill tone="warn" dot={false}>Not recorded</Pill>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-[10.5px] text-text-faint">Charged</div>
          <div className="font-mono text-[12.5px]">{money(revenue)}</div>
        </div>
        <div>
          <div className="text-[10.5px] text-text-faint">Paid out</div>
          <div className="font-mono text-[12.5px]">{money(cost)}</div>
        </div>
        <div>
          <div className="text-[10.5px] text-text-faint">Margin</div>
          <div
            className={`font-mono text-[12.5px] ${margin < 0 ? "text-danger" : "text-success"}`}
          >
            {money(margin)}
          </div>
        </div>
      </div>

      {d.has_delivery_loss && (
        <div className="rounded-lg border border-danger/40 bg-danger/[0.07] p-2.5 flex items-start gap-2">
          <CircleAlert className="w-4 h-4 text-danger shrink-0 mt-px" />
          <div className="text-[11.5px]">
            <div className="font-medium text-danger">
              Loss of {money(Number(d.delivery_loss_ngn ?? 0))}
            </div>
            <div className="text-text-faint">
              We paid more for this delivery than the customer was charged.
              {d.fee_waiver_reason
                ? ` Fee waived: ${d.fee_waiver_reason}.`
                : ""}
            </div>
          </div>
        </div>
      )}

      {costs.length > 0 && (
        <div className="space-y-1">
          {costs.map((c) => (
            <div
              key={c.cost_id}
              className="flex items-center gap-2 text-[11.5px] text-text-muted"
            >
              <span className="font-mono">{money(Number(c.amount_ngn))}</span>
              <span className="text-text-faint">{c.cost_type.replace(/_/g, " ")}</span>
              {c.courier_name && <span className="text-text-faint">· {c.courier_name}</span>}
              <span className="text-text-faint font-mono">
                {formatDateTime(c.incurred_at)}
              </span>
              {c.settled_at ? (
                <Pill tone="success" dot={false}>Settled</Pill>
              ) : (
                <Pill tone="neutral" dot={false}>
                  {c.settlement_mode === "per_drop" ? "Cash" : "Invoice"}
                </Pill>
              )}
              {canEdit && !c.settled_at && (
                <button
                  className="ml-auto text-text-faint hover:text-danger"
                  disabled={removeCost.isPending}
                  onClick={() =>
                    removeCost.mutate({ id: d.delivery_id, cost_id: c.cost_id })
                  }
                  aria-label="Remove cost"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit &&
        (adding ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Amount paid (₦)"
                className="flex-1 bg-transparent border border-line rounded-lg px-2.5 h-[38px] text-[13px] outline-none focus:border-accent/50"
                autoComplete="off"
              />
              <Select
                value={costType}
                onChange={setCostType}
                className="w-[150px]"
                ariaLabel="Cost type"
                options={[
                  { value: "outbound", label: "Outbound" },
                  { value: "redelivery", label: "Redelivery" },
                  { value: "return_leg", label: "Return leg" },
                  { value: "waiting_time", label: "Waiting time" },
                  { value: "packaging", label: "Packaging" },
                  { value: "other", label: "Other" },
                ]}
              />
            </div>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Note (optional)"
              className="w-full bg-transparent border border-line rounded-lg px-2.5 h-[38px] text-[13px] outline-none focus:border-accent/50"
              autoComplete="off"
            />
            {projectedLoss > 0 && (
              <div className="text-[11.5px] text-danger">
                This puts the delivery {money(projectedLoss)} over what the
                customer paid. It will be saved and flagged as a loss.
              </div>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="primary"
                disabled={!(pending > 0) || addCost.isPending}
                onClick={submit}
              >
                {addCost.isPending ? "Saving…" : "Save cost"}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              Add cost
            </Button>
            {revenue === 0 && !d.fee_waiver_reason && (
              <Button
                size="sm"
                variant="secondary"
                disabled={setWaiver.isPending}
                onClick={() => setWaiving(true)}
              >
                Mark fee waived
              </Button>
            )}
          </div>
        ))}

      {waiving && (
        <ReasonModal
          title="Mark delivery fee waived"
          message="Records that this delivery was deliberately free, so it doesn't read as an overspend in the reconciliation report."
          label="Why was delivery free?"
          placeholder="Promo, remake, apology reship…"
          confirmLabel="Save reason"
          required
          busy={setWaiver.isPending}
          onClose={() => setWaiving(false)}
          onConfirm={(reason) =>
            setWaiver.mutate(
              { id: d.delivery_id, reason },
              { onSuccess: () => setWaiving(false) },
            )
          }
        />
      )}
    </div>
  );
}

// ── Reconciliation ──────────────────────────────────────────

/** Default period: the current calendar month, to today. */
function monthToDate() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: from.toISOString(), to: now.toISOString() };
}

function ReconciliationTab() {
  const [range, setRange] = useState(monthToDate);
  const q = useDeliveryReconciliation(range.from, range.to);

  const setMonths = (back: number) => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - back, 1);
    setRange({ from: from.toISOString(), to: now.toISOString() });
  };

  if (q.isLoading) {
    return (
      <Card className="p-4 space-y-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} style={{ height: 60 }} />)}
      </Card>
    );
  }
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  const r = q.data;
  if (!r) return null;

  const t = r.totals;
  const marginTone = Number(t.margin_ngn) < 0 ? "text-danger" : "text-success";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => setMonths(0)}>
          This month
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setMonths(1)}>
          Last 2 months
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setMonths(5)}>
          Last 6 months
        </Button>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="Completed" value={String(t.deliveries)} />
          <Stat label="Charged to clients" value={money(Number(t.revenue_ngn))} />
          <Stat label="Paid to couriers" value={money(Number(t.cost_ngn))} />
          <Stat
            label="Margin"
            value={money(Number(t.margin_ngn))}
            className={marginTone}
          />
        </div>
        <div className="mt-3 pt-3 border-t border-line flex flex-wrap gap-3 text-[11.5px] text-text-muted">
          <span>
            <span className="text-danger font-medium">{t.loss_count}</span> made a
            loss ({money(Number(t.loss_ngn))} total)
          </span>
          <span>·</span>
          <span>{t.waived_count} fee waived</span>
          <span>·</span>
          <span
            className={t.cost_missing_count > 0 ? "text-warn" : undefined}
            title="These read as pure profit until someone records what they cost."
          >
            {t.cost_missing_count} with no cost recorded
          </span>
        </div>
      </Card>

      <ReconTable
        title="By courier"
        caption="Which courier consistently costs more than we charge."
        rows={r.by_courier.map((x) => ({
          key: x.courier_id ?? x.courier_name ?? "—",
          label: x.courier_name ?? "Unassigned",
          hint: x.settlement_mode === "per_drop" ? "cash" : "invoice",
          ...x,
        }))}
      />
      <ReconTable
        title="By destination"
        caption="Where the rate card is wrong — a zone charged flat but costing by distance."
        rows={r.by_destination.map((x) => ({
          key: x.destination ?? "—",
          label: x.destination ?? "Unknown",
          ...x,
        }))}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div>
      <div className="text-[10.5px] text-text-faint uppercase tracking-wide">{label}</div>
      <div className={`font-mono text-[16px] mt-0.5 ${className ?? ""}`}>{value}</div>
    </div>
  );
}

function ReconTable({
  title,
  caption,
  rows,
}: {
  title: string;
  caption: string;
  rows: Array<{
    key: string;
    label: string;
    hint?: string;
    deliveries: number;
    revenue_ngn: number | string;
    cost_ngn: number | string;
    margin_ngn: number | string;
    loss_ngn: number | string;
    loss_count?: number;
  }>;
}) {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="p-3 border-b border-line">
        <div className="text-[12.5px] font-semibold">{title}</div>
        <div className="text-[11px] text-text-faint">{caption}</div>
      </div>
      {rows.length === 0 ? (
        <div className="p-4 text-[12.5px] text-text-faint">
          Nothing completed in this period.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-text-faint text-[10.5px] uppercase tracking-wide">
                <th className="text-left font-medium p-2.5">Name</th>
                <th className="text-right font-medium p-2.5">Drops</th>
                <th className="text-right font-medium p-2.5">Charged</th>
                <th className="text-right font-medium p-2.5">Paid</th>
                <th className="text-right font-medium p-2.5">Margin</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.key} className="border-t border-line">
                  <td className="p-2.5">
                    {x.label}
                    {x.hint && (
                      <span className="text-text-faint text-[10.5px] ml-1.5">
                        {x.hint}
                      </span>
                    )}
                    {(x.loss_count ?? 0) > 0 && (
                      <span className="text-danger text-[10.5px] ml-1.5">
                        {x.loss_count} at a loss
                      </span>
                    )}
                  </td>
                  <td className="p-2.5 text-right font-mono">{x.deliveries}</td>
                  <td className="p-2.5 text-right font-mono">
                    {money(Number(x.revenue_ngn))}
                  </td>
                  <td className="p-2.5 text-right font-mono">
                    {money(Number(x.cost_ngn))}
                  </td>
                  <td
                    className={`p-2.5 text-right font-mono ${
                      Number(x.margin_ngn) < 0 ? "text-danger" : "text-success"
                    }`}
                  >
                    {money(Number(x.margin_ngn))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function CreateDeliveryDrawer({ onClose }: { onClose: () => void }) {
  const couriersQ = useCouriers();
  const create = useCreateDelivery();
  const couriers = (couriersQ.data ?? []).filter((c) => c.is_active);

  // Customer search (debounced)
  const [contactId, setContactId] = useState("");
  const [cq, setCq] = useState("");
  const [results, setResults] = useState<ContactHit[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (contactId || cq.trim().length < 2) {
      setResults([]);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const r = await searchContacts(cq.trim());
        setResults(((r as { data?: ContactHit[] })?.data ?? []) as ContactHit[]);
        setOpen(true);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [cq, contactId]);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [line1, setLine1] = useState("");
  const [area, setArea] = useState("");
  const [landmark, setLandmark] = useState("");
  const [city, setCity] = useState("Lagos");
  const [stateV, setStateV] = useState("Lagos");
  const [country, setCountry] = useState("Nigeria");
  const [courierId, setCourierId] = useState("");
  const [fee, setFee] = useState("");
  const [instructions, setInstructions] = useState("");
  const [pod, setPod] = useState(false);
  const [podAmount, setPodAmount] = useState("");
  const [items, setItems] = useState<{ description: string; quantity: string }[]>([
    { description: "", quantity: "1" },
  ]);

  const resolvedCourier = courierId || couriers[0]?.courier_id || "";
  const validItems = items.filter((it) => it.description.trim());
  const canSave =
    !!resolvedCourier && !!name && !!line1 && !!city && validItems.length > 0 && !create.isPending;

  function pick(c: ContactHit) {
    setContactId(c.contact_id);
    setCq(c.display_name);
    setOpen(false);
    if (!name) setName(c.display_name);
    if (!phone && c.primary_phone) setPhone(c.primary_phone);
  }

  function submit() {
    const address: DeliveryAddress = {
      line1,
      area: area || undefined,
      landmark: landmark || undefined,
      city,
      state: stateV || undefined,
      country: country || undefined,
      recipient_name: name,
      phone: phone || undefined,
    };
    const lines: DeliveryItem[] = validItems.map((it) => ({
      description: it.description.trim(),
      quantity: Number(it.quantity) || 1,
    }));
    create.mutate(
      {
        courier_id: resolvedCourier,
        recipient_contact_id: contactId || undefined,
        recipient_name_snapshot: name,
        recipient_phone_snapshot: phone || undefined,
        delivery_address_snapshot: address,
        delivery_instructions: instructions || undefined,
        courier_fee_ngn: fee ? Number(fee) : undefined,
        is_pay_on_delivery: pod || undefined,
        pod_amount_expected_ngn: pod && podAmount ? Number(podAmount) : undefined,
        items: lines,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Drawer open onClose={onClose} title="New delivery" subtitle="Dispatch a package">
      <div className="space-y-5 p-1">
        {/* Customer */}
        <Field label="Customer">
          <div className="relative">
            <Input
              value={cq}
              onChange={(v) => {
                setCq(v);
                setContactId("");
              }}
              placeholder="Search customer by name or phone…"
            />
            {open && results.length > 0 && (
              <div className="absolute z-50 left-0 right-0 mt-1 rounded-[11px] border border-line bg-panel-2 shadow-glass overflow-hidden">
                {results.map((c) => (
                  <button
                    key={c.contact_id}
                    type="button"
                    onClick={() => pick(c)}
                    className="w-full text-left px-3 py-2 text-[13px] hover:bg-text-primary/[0.06]"
                  >
                    <div className="font-medium">{c.display_name}</div>
                    {c.primary_phone && <div className="text-[11px] text-text-faint">{c.primary_phone}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </Field>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Address */}
          <div className="space-y-3">
            <div className="micro">Delivery address</div>
            <Field label="Recipient name"><Input value={name} onChange={setName} placeholder="Jane Doe" /></Field>
            <Field label="Phone"><Input value={phone} onChange={setPhone} placeholder="0801…" /></Field>
            <Field label="Street address"><Input value={line1} onChange={setLine1} placeholder="14 Admiralty Way" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Area"><Input value={area} onChange={setArea} placeholder="Lekki Phase 1" /></Field>
              <Field label="Landmark"><Input value={landmark} onChange={setLandmark} placeholder="Near…" /></Field>
              <Field label="City"><Input value={city} onChange={setCity} /></Field>
              <Field label="State"><Input value={stateV} onChange={setStateV} /></Field>
            </div>
            <Field label="Country"><Input value={country} onChange={setCountry} /></Field>
          </div>

          {/* Courier & fee */}
          <div className="space-y-3">
            <div className="micro">Courier &amp; fee</div>
            <Field label="Courier">
              <Select
                value={resolvedCourier}
                onChange={setCourierId}
                options={
                  couriers.length
                    ? couriers.map((c) => ({ value: c.courier_id, label: c.display_name }))
                    : [{ value: "", label: "No couriers configured" }]
                }
              />
            </Field>
            <Field label="Delivery fee (₦)">
              <Input value={fee} onChange={(v) => setFee(v.replace(/[^0-9.]/g, ""))} placeholder="0" mono />
            </Field>
            <label className="flex items-center gap-2 text-[12.5px] text-text-muted">
              <input type="checkbox" checked={pod} onChange={(e) => setPod(e.target.checked)} className="accent-accent" />
              Pay on delivery
            </label>
            {pod && (
              <Field label="POD amount (₦)">
                <Input value={podAmount} onChange={(v) => setPodAmount(v.replace(/[^0-9.]/g, ""))} placeholder="0" mono />
              </Field>
            )}
            <Field label="Instructions">
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={2}
                placeholder="Call on arrival, gate code…"
                className="w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 py-2.5 text-[13px] outline-none focus:border-accent/50 resize-y"
              />
            </Field>
          </div>
        </div>

        {/* Items */}
        <div className="space-y-2">
          <div className="micro">What&rsquo;s being delivered?</div>
          {items.map((it, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  value={it.description}
                  onChange={(v) => setItems((arr) => arr.map((x, j) => (j === i ? { ...x, description: v } : x)))}
                  placeholder="e.g. Rouge 500ml"
                />
              </div>
              <input
                value={it.quantity}
                onChange={(e) =>
                  setItems((arr) => arr.map((x, j) => (j === i ? { ...x, quantity: e.target.value.replace(/[^0-9]/g, "") } : x)))
                }
                className="w-16 h-[42px] px-2 text-center rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] outline-none focus:border-accent/50 tabular-nums"
                placeholder="1" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
              />
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => setItems((arr) => arr.filter((_, j) => j !== i))}
                  className="p-2.5 text-text-faint hover:text-danger"
                  aria-label="Remove item"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setItems((arr) => [...arr, { description: "", quantity: "1" }])}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line py-2 text-[12px] text-text-muted hover:text-accent-glow hover:border-accent/40"
          >
            <Plus className="w-3.5 h-3.5" /> Add item
          </button>
        </div>

        {couriers.length === 0 && (
          <p className="text-[12px] text-warn">No couriers configured — add one before dispatching.</p>
        )}
        {create.isError && <p className="text-[12px] text-danger">Couldn&rsquo;t create the delivery.</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!canSave}
            onClick={submit}
            icon={create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          >
            Create delivery
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

// ── Shared bits ─────────────────────────────────────────────

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10.5px] uppercase tracking-widest text-text-faint">{label}</dt>
      <dd className={`text-text-primary ${mono ? "font-mono text-[11.5px] break-all" : ""}`}>{value}</dd>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11.5px] text-text-muted mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 h-[42px] text-[13px] outline-none focus:border-accent/50 ${mono ? "font-mono text-[12px]" : ""}`} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
    />
  );
}
