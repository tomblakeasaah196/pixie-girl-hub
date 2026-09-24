import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PackageCheck, AlertTriangle, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { ErrorState } from "@/components/ui/controls";
import { useAuthStore } from "@/stores/auth";
import { formatDate } from "@/lib/format";
import { getOrder } from "./api";
import { useBusinessStore } from "@/stores/business";

const useBrand = () => useBusinessStore((st) => st.activeKey);

/**
 * Care & Accessories delivery-fee review queue (PR 3).
 *
 * Every retail-containing DELIVERY order lands here when it is placed. A person
 * prices the delivery; the order cannot be dispatched (DB trigger) until the
 * review settles. Nothing here moves money: a fee increase needs recorded
 * customer consent plus an EXISTING captured payment; a decrease needs a real
 * credit note or refunded payment. The server re-checks every step and
 * permission — this screen only collects the facts.
 */

// Fixed policy wording, shown to staff exactly as the customer saw it.
const CARE_DELIVERY_NOTICE = "EXTRA DELIVERY FEES MAY APPLY";

const R = "/sales";

interface QueueRow {
  review_id: string;
  order_id: string;
  order_number: string;
  status: string;
  order_status: string;
  initial_fee_ngn: string;
  proposed_fee_ngn: string | null;
  difference_ngn: string;
  direction: "increase" | "decrease" | "no_change" | null;
  total_ngn: string;
  amount_paid_ngn: string;
  balance_due_ngn: string;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address_snapshot: unknown;
  retail_line_count: number;
  lines: { name: string; variant: string | null; sku: string | null; qty: number }[] | null;
  created_at: string;
}

interface ReviewEvent {
  event_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  amount_ngn: string | null;
  note: string | null;
  actor_name: string | null;
  created_at: string;
}

interface ReviewDetail {
  order: {
    order_id: string;
    order_number: string;
    status: string;
    shipping_fee_ngn: string;
    total_ngn: string;
    amount_paid_ngn: string;
    balance_due_ngn: string;
    needs_delivery_review: boolean;
  };
  open_review: (QueueRow & { calculation_basis: string | null; customer_consent_at: string | null }) | null;
  events: ReviewEvent[];
}

const ngn = (v: string | number | null | undefined) =>
  v == null || v === "" ? "—" : `₦${Number(v).toLocaleString()}`;

const STATUS_LABEL: Record<string, string> = {
  pending_review: "Needs pricing",
  awaiting_customer: "Awaiting customer",
  accepted: "Accepted",
  declined: "Declined",
  credited: "Credited",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
};

function errText(e: unknown) {
  return e instanceof Error ? e.message : "Something went wrong";
}

export function DeliveryReviewView() {
  const brand = useBrand();
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["delivery-reviews", brand],
    queryFn: () =>
      api.get<{ data: QueueRow[]; meta: { total: number } }>(
        `${R}/delivery-reviews?page_size=100`,
      ),
    enabled: brand === "pixiegirl",
  });

  if (brand !== "pixiegirl")
    return (
      <p className="text-[13px] text-text-muted">
        Delivery-fee reviews apply to Pixie Girl Care &amp; Accessories orders only.
      </p>
    );
  if (q.isError) return <ErrorState message={errText(q.error)} />;

  const rows = q.data?.data ?? [];
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-amber-400/40 bg-amber-400/5 p-3 text-[12.5px]">
        <div className="font-bold uppercase tracking-wide">{CARE_DELIVERY_NOTICE}</div>
        <div className="mt-1 text-text-muted">
          Delivery orders containing care products are priced by hand here before
          they can be dispatched. Customers were told extra fees <em>may</em> apply
          — never that they will.
        </div>
      </div>
      {q.isLoading ? (
        <div className="flex items-center gap-2 text-text-muted text-[13px]">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="flex items-center gap-2 text-text-muted text-[13px] p-6">
          <PackageCheck className="w-4 h-4" /> No delivery fees waiting for review.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border hairline">
          <table className="w-full text-[12.5px]">
            <thead className="text-text-faint text-left">
              <tr>
                <th className="p-2">Order</th>
                <th className="p-2">Customer</th>
                <th className="p-2">Items</th>
                <th className="p-2">Initial fee</th>
                <th className="p-2">Proposed</th>
                <th className="p-2">Status</th>
                <th className="p-2">Opened</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.review_id}
                  className="border-t hairline cursor-pointer hover:bg-text-primary/[0.04]"
                  onClick={() => setOpenId(r.order_id)}
                >
                  <td className="p-2 font-medium">{r.order_number}</td>
                  <td className="p-2">
                    {r.customer_name ?? "—"}
                    <div className="text-text-faint">{r.customer_phone ?? ""}</div>
                  </td>
                  <td className="p-2">
                    {(r.lines ?? []).map((l, i) => (
                      <div key={i} className="truncate max-w-[260px]">
                        {l.qty}× {l.name}
                        {l.variant ? ` — ${l.variant}` : ""}
                      </div>
                    ))}
                  </td>
                  <td className="p-2 tabular-nums">{ngn(r.initial_fee_ngn)}</td>
                  <td className="p-2 tabular-nums">{ngn(r.proposed_fee_ngn)}</td>
                  <td className="p-2">{STATUS_LABEL[r.status] ?? r.status}</td>
                  <td className="p-2 text-text-faint">{formatDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {openId && <ReviewModal orderId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function ReviewModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const brand = useBrand();
  const qc = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const canEdit = can("sales", "edit");
  const canApprove = can("sales", "approve");
  const [msg, setMsg] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["delivery-review", brand, orderId],
    queryFn: () => api.get<ReviewDetail>(`${R}/orders/${orderId}/delivery-review`),
  });
  const order = useQuery({
    queryKey: ["sales-order", brand, orderId, "for-review"],
    queryFn: () => getOrder(orderId),
  });

  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body: Record<string, unknown> }) =>
      api.post(`${R}/orders/${orderId}/delivery-review${path}`, body),
    onSuccess: () => {
      setMsg(null);
      qc.invalidateQueries({ queryKey: ["delivery-review", brand, orderId] });
      qc.invalidateQueries({ queryKey: ["delivery-reviews", brand] });
      qc.invalidateQueries({ queryKey: ["sales-order", brand, orderId] });
    },
    onError: (e) => setMsg(errText(e)),
  });

  const [fee, setFee] = useState("");
  const [basis, setBasis] = useState("");
  const [consentChannel, setConsentChannel] = useState("whatsapp");
  const [consentRef, setConsentRef] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [refundRef, setRefundRef] = useState<{ kind: "credit_note_id" | "refund_payment_id"; id: string }>({
    kind: "refund_payment_id",
    id: "",
  });

  const d = detail.data;
  const rv = d?.open_review ?? null;
  const payments = (order.data?.payments ?? []).filter((p) =>
    ["captured", "refunded", "partially_refunded"].includes(p.status),
  );

  return (
    <Modal open onClose={onClose} size="lg" title={`Delivery fee review — ${d?.order.order_number ?? ""}`}>
      {detail.isLoading || !d ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <div className="space-y-4 text-[13px]">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="Delivery fee on order" value={ngn(d.order.shipping_fee_ngn)} />
            <Stat label="Order total" value={ngn(d.order.total_ngn)} />
            <Stat label="Paid" value={ngn(d.order.amount_paid_ngn)} />
            <Stat label="Balance" value={ngn(d.order.balance_due_ngn)} />
          </div>

          {!rv ? (
            <p className="text-text-muted">
              No open review. {d.order.needs_delivery_review ? "" : "This order may be dispatched."}
            </p>
          ) : (
            <>
              <div className="rounded-lg border hairline p-3">
                <div className="flex justify-between">
                  <span>Status: <b>{STATUS_LABEL[rv.status] ?? rv.status}</b></span>
                  <span>
                    Initial {ngn(rv.initial_fee_ngn)} → proposed {ngn(rv.proposed_fee_ngn)}
                    {rv.direction && rv.direction !== "no_change" && ` (${rv.direction} ${ngn(rv.difference_ngn)})`}
                  </span>
                </div>
                {rv.calculation_basis && (
                  <div className="text-text-faint mt-1">Basis: {rv.calculation_basis}</div>
                )}
              </div>

              {/* 1 — price it */}
              {canEdit && (rv.status === "pending_review" || rv.status === "awaiting_customer") && !rv.customer_consent_at && (
                <Step title="1. Enter the calculated delivery fee">
                  <div className="flex gap-2 flex-wrap">
                    <input className="input w-36" inputMode="decimal" placeholder="Fee ₦" value={fee} onChange={(e) => setFee(e.target.value)} />
                    <input className="input flex-1 min-w-[220px]" placeholder="How it was calculated (courier quote, zone, etc.)" value={basis} onChange={(e) => setBasis(e.target.value)} />
                    <Button
                      disabled={act.isPending || fee === "" || basis.trim().length < 3}
                      onClick={() => act.mutate({ path: "/fee", body: { proposed_fee_ngn: Number(fee), calculation_basis: basis.trim() } })}
                    >
                      Save fee
                    </Button>
                  </div>
                </Step>
              )}

              {canApprove && rv.status === "awaiting_customer" && rv.direction === "increase" && !rv.customer_consent_at && (
                <Step title="2. Record the customer's answer (a website notice is not consent)">
                  <div className="flex gap-2 flex-wrap">
                    <select className="input w-36" value={consentChannel} onChange={(e) => setConsentChannel(e.target.value)}>
                      {["whatsapp", "instagram", "phone", "email", "in_store"].map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input className="input flex-1 min-w-[220px]" placeholder="Message / call reference" value={consentRef} onChange={(e) => setConsentRef(e.target.value)} />
                    <Button disabled={act.isPending || !consentRef.trim()} onClick={() => act.mutate({ path: "/consent", body: { accepted: true, channel: consentChannel, reference: consentRef.trim() } })}>Accepted</Button>
                    <Button variant="secondary" disabled={act.isPending || !consentRef.trim()} onClick={() => act.mutate({ path: "/consent", body: { accepted: false, channel: consentChannel, reference: consentRef.trim() } })}>Refused</Button>
                  </div>
                </Step>
              )}

              {canApprove && rv.direction === "increase" && rv.customer_consent_at && rv.status === "awaiting_customer" && (
                <Step title={`3. Verify the separate top-up payment (≥ ${ngn(rv.difference_ngn)})`}>
                  <div className="flex gap-2 flex-wrap">
                    <select className="input flex-1" value={paymentId} onChange={(e) => setPaymentId(e.target.value)}>
                      <option value="">Select a captured payment…</option>
                      {payments.filter((p) => p.status === "captured").map((p) => (
                        <option key={p.payment_id} value={p.payment_id}>{p.payment_number} · {ngn(p.amount_ngn)} · {p.method}</option>
                      ))}
                    </select>
                    <Button disabled={act.isPending || !paymentId} onClick={() => act.mutate({ path: "/top-up", body: { payment_id: paymentId } })}>Verify &amp; settle</Button>
                  </div>
                  <p className="text-text-faint mt-1">Record the payment on the order first (payment link or manual receipt). Nothing is charged from here.</p>
                </Step>
              )}

              {canApprove && rv.direction === "decrease" && (
                <Step title={`Refund / credit the difference (${ngn(rv.difference_ngn)})`}>
                  <div className="flex gap-2 flex-wrap">
                    <select className="input w-44" value={refundRef.kind} onChange={(e) => setRefundRef({ kind: e.target.value as typeof refundRef.kind, id: "" })}>
                      <option value="refund_payment_id">Refunded payment</option>
                      <option value="credit_note_id">Credit note id</option>
                    </select>
                    {refundRef.kind === "refund_payment_id" ? (
                      <select className="input flex-1" value={refundRef.id} onChange={(e) => setRefundRef({ ...refundRef, id: e.target.value })}>
                        <option value="">Select…</option>
                        {payments.filter((p) => p.status !== "captured").map((p) => (
                          <option key={p.payment_id} value={p.payment_id}>{p.payment_number} · {ngn(p.amount_ngn)} · {p.status}</option>
                        ))}
                      </select>
                    ) : (
                      <input className="input flex-1" placeholder="Credit note UUID" value={refundRef.id} onChange={(e) => setRefundRef({ ...refundRef, id: e.target.value })} />
                    )}
                    <Button disabled={act.isPending || !refundRef.id} onClick={() => act.mutate({ path: "/refund", body: { [refundRef.kind]: refundRef.id } })}>Verify &amp; settle</Button>
                  </div>
                </Step>
              )}

              {canApprove && rv.direction === "no_change" && (
                <Step title="Confirm the fee already agreed is final">
                  <Button disabled={act.isPending} onClick={() => act.mutate({ path: "/confirm", body: {} })}>Confirm &amp; release for dispatch</Button>
                </Step>
              )}

              {canApprove && rv.status === "declined" && (
                <Step title="Customer refused the increase">
                  <p className="text-text-muted mb-2">
                    No cancellation fee is invented. Route to a manager to cancel &amp; refund, switch to pickup, or re-price.
                  </p>
                  <Button variant="secondary" disabled={act.isPending} onClick={() => act.mutate({ path: "/decline-route", body: {} })}>Route to manager</Button>
                </Step>
              )}

              {msg && (
                <div className="flex items-start gap-2 text-rose-300">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {msg}
                </div>
              )}
            </>
          )}

          {d.events.length > 0 && (
            <div>
              <div className="text-text-faint mb-1">History</div>
              <ul className="space-y-1">
                {d.events.map((e) => (
                  <li key={e.event_id} className="text-[12px]">
                    <span className="text-text-faint">{formatDate(e.created_at)}</span>{" "}
                    <b>{e.event_type}</b>
                    {e.to_status ? ` → ${STATUS_LABEL[e.to_status] ?? e.to_status}` : ""}
                    {e.amount_ngn ? ` · ${ngn(e.amount_ngn)}` : ""}
                    {e.actor_name ? ` · ${e.actor_name}` : ""}
                    {e.note ? ` — ${e.note}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border hairline p-2">
      <div className="text-[11px] text-text-faint">{label}</div>
      <div className="tabular-nums">{value}</div>
    </div>
  );
}

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border hairline p-3">
      <div className="font-medium mb-2">{title}</div>
      {children}
    </div>
  );
}
