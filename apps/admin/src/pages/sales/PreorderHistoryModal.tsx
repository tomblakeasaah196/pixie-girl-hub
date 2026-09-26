import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Clock, RefreshCw, Mail, AlertTriangle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Pill, MoneyText, Button } from "@/components/ui/primitives";
import { ConfirmDialog, ErrorState } from "@/components/ui/controls";
import { formatDate, formatDateTime } from "@/lib/format";
import { useAuthStore } from "@/stores/auth";
import { useToastStore } from "@/components/notifications/NotificationToast";
import { usePreorderHistory, useRunPreorderBackfill } from "./hooks";
import { ORDER_STATUS } from "./constants";
import type { PreorderHistoryOrder } from "./api";
import type { OrderStatus } from "./types";

/** Days from today until a YYYY-MM-DD date (negative = overdue). */
function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

function StatusPill({ status }: { status: string }) {
  const s = ORDER_STATUS[status as OrderStatus];
  return s ? <Pill tone={s.tone}>{s.label}</Pill> : <Pill>{status}</Pill>;
}

/**
 * "Fulfilled pre-orders" — the visibility surface for pre-order auto-allocation.
 * Shows what stock arrival has fulfilled, what is still waiting (overdue first),
 * the last reconcile run, and a manual "Run backfill" escape hatch that re-runs
 * the idempotent reconcile for the active brand.
 */
export function PreorderHistoryModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.add);
  const canRun = useAuthStore((s) => s.can)("sales", "edit");
  const { data, isLoading, isError, refetch } = usePreorderHistory(open);
  const backfill = useRunPreorderBackfill();
  const [confirmRun, setConfirmRun] = useState(false);

  const fulfilled = data?.fulfilled ?? [];
  const waiting = data?.waiting ?? [];
  const lastRun = data?.last_run ?? null;

  const fireToast = (title: string, body: string) =>
    addToast({
      notification_id: crypto.randomUUID(),
      user_id: "",
      business: null,
      type: "order",
      priority: "normal",
      title,
      body,
      reference_type: null,
      reference_id: null,
      action_url: null,
      is_read: false,
      read_at: null,
      created_at: new Date().toISOString(),
    });

  const goToOrder = (id: string) => {
    onClose();
    navigate(`/sales/orders/${id}`);
  };

  const runBackfill = async () => {
    try {
      const r = await backfill.mutateAsync();
      setConfirmRun(false);
      const moved = r.units_deducted + r.units_reserved;
      fireToast(
        moved ? "Pre-orders fulfilled" : "Nothing to fulfil",
        moved
          ? `Reconcile complete — ${r.orders_fulfilled} order${r.orders_fulfilled === 1 ? "" : "s"} completed, ${r.units_deducted} unit${r.units_deducted === 1 ? "" : "s"} drawn, ${r.units_reserved} reserved.`
          : "No pre-orders were waiting on available stock. Everything is already up to date.",
      );
    } catch (err) {
      setConfirmRun(false);
      fireToast(
        "Backfill failed",
        err instanceof Error ? err.message : "Please try again.",
      );
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="xl"
        title={
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Fulfilled pre-orders
          </span>
        }
      >
        {/* Last-run status + manual reconcile */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 mb-4 rounded-[11px] border border-line bg-text-primary/[0.02]">
          <div className="text-[12px] text-text-muted min-w-0">
            {lastRun ? (
              <>
                <span className="font-semibold text-text-primary">
                  Last reconcile
                </span>{" "}
                {formatDateTime(lastRun.started_at)} · {lastRun.mode} ·{" "}
                {lastRun.orders_fulfilled} fulfilled, {lastRun.units_deducted} drawn,{" "}
                {lastRun.units_reserved} reserved{" "}
                {lastRun.ok ? (
                  <Pill tone="success">ok</Pill>
                ) : (
                  <Pill tone="danger">errors</Pill>
                )}
              </>
            ) : (
              <span>No reconcile has run yet for this business.</span>
            )}
          </div>
          {canRun && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmRun(true)}
              disabled={backfill.isPending}
              className="shrink-0"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 mr-1.5 ${backfill.isPending ? "animate-spin" : ""}`}
              />
              {backfill.isPending ? "Running…" : "Run backfill now"}
            </Button>
          )}
        </div>

        {isError ? (
          <ErrorState onRetry={refetch} />
        ) : isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-[52px] rounded-[11px] bg-text-primary/[0.04] animate-pulse"
              />
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Fulfilled */}
            <section>
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-text-faint mb-2">
                Fulfilled ({fulfilled.length})
              </h3>
              {fulfilled.length === 0 ? (
                <div className="py-8 text-center text-[12px] text-text-faint">
                  No pre-orders have been fulfilled from stock yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {fulfilled.map((o) => (
                    <PreorderRow
                      key={o.order_id}
                      o={o}
                      onClick={() => goToOrder(o.order_id)}
                      right={
                        <div className="flex items-center gap-2 shrink-0">
                          {o.preorder_arrival_notified_at ? (
                            <span
                              title={`Customer emailed ${formatDate(o.preorder_arrival_notified_at)}`}
                              className="text-success"
                            >
                              <Mail className="h-3.5 w-3.5" />
                            </span>
                          ) : null}
                          <StatusPill status={o.status} />
                          <MoneyText
                            ngn={Number(o.total_ngn)}
                            className="text-[13px] w-24 text-right"
                          />
                        </div>
                      }
                      sub={
                        o.preorder_fulfilled_at
                          ? `Fulfilled ${formatDate(o.preorder_fulfilled_at)}`
                          : undefined
                      }
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Still waiting */}
            <section>
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-text-faint mb-2">
                Still waiting ({waiting.length})
              </h3>
              {waiting.length === 0 ? (
                <div className="py-8 text-center text-[12px] text-text-faint">
                  Nothing is waiting on stock — every pre-order is fulfilled.
                </div>
              ) : (
                <div className="space-y-2">
                  {waiting.map((o) => {
                    const days = daysUntil(o.preorder_ready_by);
                    const overdue = days !== null && days < 0;
                    return (
                      <PreorderRow
                        key={o.order_id}
                        o={o}
                        onClick={() => goToOrder(o.order_id)}
                        right={
                          <div className="flex items-center gap-2 shrink-0">
                            {overdue ? (
                              <Pill tone="danger">
                                {Math.abs(days as number)}d overdue
                              </Pill>
                            ) : o.preorder_ready_by ? (
                              <Pill tone={days !== null && days <= 7 ? "warn" : "neutral"}>
                                {days === 0 ? "due today" : `in ${days}d`}
                              </Pill>
                            ) : null}
                            <StatusPill status={o.status} />
                          </div>
                        }
                        sub={
                          o.preorder_ready_by
                            ? `Ship by ${formatDate(o.preorder_ready_by)}`
                            : "No ship-by set"
                        }
                        icon={
                          overdue ? (
                            <AlertTriangle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
                          ) : (
                            <Clock className="h-4 w-4 text-text-faint shrink-0 mt-0.5" />
                          )
                        }
                      />
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmRun}
        onClose={() => setConfirmRun(false)}
        onConfirm={runBackfill}
        title="Run pre-order backfill?"
        confirmLabel="Run backfill"
        tone="accent"
        busy={backfill.isPending}
        message={
          <div className="space-y-2 text-[13px]">
            <p>
              This checks every waiting pre-order for this business and applies any
              stock that's available — <strong>drawing</strong> it for paid
              pre-orders and <strong>reserving</strong> it for unpaid ones,
              paid-first then oldest-first.
            </p>
            <p className="text-text-faint">
              It's safe to run any time: it only ever fills a genuine shortfall
              against available stock, so it never double-draws. Ops and sales are
              notified for anything it fulfils.
            </p>
          </div>
        }
      />
    </>
  );
}

function PreorderRow({
  o,
  onClick,
  right,
  sub,
  icon,
}: {
  o: PreorderHistoryOrder;
  onClick: () => void;
  right: React.ReactNode;
  sub?: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 rounded-[11px] border border-line bg-text-primary/[0.02] hover:bg-text-primary/[0.05] transition-colors text-left"
    >
      {icon ?? <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold font-mono">
            {o.order_number}
          </span>
          <span className="text-[12.5px] text-text-muted truncate">
            {o.contact_name || "—"}
          </span>
        </div>
        {sub ? (
          <div className="text-[11.5px] text-text-faint mt-0.5">{sub}</div>
        ) : null}
      </div>
      {right}
    </button>
  );
}
