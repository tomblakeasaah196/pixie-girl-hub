import { useState } from "react";
import {
  CreditCard, Link2, Clock, Send, FileText, XCircle,
} from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { Card, Pill, MoneyText, Button } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import { FormSection, FormGrid, Field } from "@/components/ui/Form";
import { NumberField, Select, ConfirmDialog } from "@/components/ui/controls";
import { useOrder, useOrderTimeline, useAddPayment, useCreatePaymentLink, useCancelOrder } from "./hooks";
import { ORDER_STATUS, SALES_CHANNELS } from "./constants";
import type { PaymentMethod, OrderPayment } from "./types";

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "cash", label: "Cash" },
  { value: "pos_card", label: "POS Card" },
  { value: "paystack_card", label: "Paystack Card" },
  { value: "paystack_transfer", label: "Paystack Transfer" },
  { value: "opay", label: "OPay" },
  { value: "nomba_terminal", label: "Nomba Terminal" },
  { value: "wallet", label: "Wallet" },
];

export function OrderDetail({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const { data: order, isLoading, isError, refetch } = useOrder(orderId);
  const { data: timeline } = useOrderTimeline(orderId);
  const addPayment = useAddPayment(orderId ?? "");
  const createLink = useCreatePaymentLink(orderId ?? "");
  const cancelOrder = useCancelOrder();

  const [showPayForm, setShowPayForm] = useState(false);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("bank_transfer");
  const [payAmount, setPayAmount] = useState("");
  const [payRef, setPayRef] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);

  const handleAddPayment = async () => {
    if (!payAmount || !orderId) return;
    await addPayment.mutateAsync({
      method: payMethod,
      amount_ngn: Number(payAmount),
      provider_reference: payRef || undefined,
      payment_path: "staff_recorded",
    });
    setShowPayForm(false);
    setPayAmount("");
    setPayRef("");
  };

  const handlePayLink = async () => {
    if (!orderId || !order) return;
    const res = await createLink.mutateAsync({
      amount_ngn: Number(order.balance_due_ngn),
    });
    await navigator.clipboard.writeText(res.checkout_url);
  };

  const handleCancel = async () => {
    if (!orderId) return;
    await cancelOrder.mutateAsync(orderId);
    setConfirmCancel(false);
    onClose();
  };

  const statusMeta = order ? ORDER_STATUS[order.status] : null;

  return (
    <>
      <Drawer open={!!orderId} onClose={onClose} title={order?.order_number ?? "Order"} subtitle={statusMeta && <Pill tone={statusMeta.tone}>{statusMeta.label}</Pill>} wide>
        {isLoading && <div className="space-y-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 rounded-xl bg-text-primary/[0.04] animate-pulse" />)}</div>}
        {isError && <ErrorState onRetry={() => refetch()} />}
        {order && (
          <div className="space-y-5">
            {/* Balance ribbon */}
            {Number(order.balance_due_ngn) > 0 && (
              <div className="flex items-center justify-between p-4 rounded-[12px] bg-warn/[0.08] border border-warn/20">
                <div>
                  <div className="text-[11px] uppercase font-bold text-warn tracking-wide">Balance Due</div>
                  <MoneyText ngn={Number(order.balance_due_ngn)} className="text-[22px] text-warn" />
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" icon={<Link2 className="w-3.5 h-3.5" />} onClick={handlePayLink} disabled={createLink.isPending}>
                    {createLink.isPending ? "Generating…" : "Pay Link"}
                  </Button>
                  <Button variant="primary" size="sm" icon={<CreditCard className="w-3.5 h-3.5" />} onClick={() => setShowPayForm(!showPayForm)}>
                    Record Payment
                  </Button>
                </div>
              </div>
            )}

            {/* Record payment form */}
            {showPayForm && (
              <Card className="p-4">
                <div className="micro mb-3">Record Payment</div>
                <FormGrid>
                  <Field label="Method">
                    <Select value={payMethod} onChange={setPayMethod} options={PAYMENT_METHODS} />
                  </Field>
                  <Field label="Amount (NGN)">
                    <NumberField value={payAmount} onChange={setPayAmount} placeholder="0.00" suffix="NGN" />
                  </Field>
                  <Field label="Reference" hint="optional">
                    <input
                      value={payRef}
                      onChange={(e) => setPayRef(e.target.value)}
                      placeholder="Transaction ref"
                      className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
                    />
                  </Field>
                </FormGrid>
                <div className="flex gap-2 mt-4">
                  <Button variant="primary" size="sm" onClick={handleAddPayment} disabled={addPayment.isPending || !payAmount}>
                    {addPayment.isPending ? "Saving…" : "Save Payment"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowPayForm(false)}>Cancel</Button>
                </div>
              </Card>
            )}

            {/* Order info */}
            <Card className="p-4">
              <FormGrid>
                <div>
                  <div className="micro">Customer</div>
                  <div className="text-[14px] font-semibold mt-1">{order.contact_name ?? order.contact_id.slice(0, 8)}</div>
                </div>
                <div>
                  <div className="micro">Channel</div>
                  <div className="text-[13px] mt-1">{SALES_CHANNELS.find((c) => c.value === order.sales_channel)?.label}</div>
                </div>
                <div>
                  <div className="micro">Created</div>
                  <div className="text-[13px] mt-1">{new Date(order.created_at).toLocaleString()}</div>
                </div>
                <div>
                  <div className="micro">Fulfilment</div>
                  <div className="text-[13px] mt-1 capitalize">{order.order_type?.replace(/_/g, " ")}</div>
                </div>
              </FormGrid>
            </Card>

            {/* Lines */}
            {order.lines && order.lines.length > 0 && (
              <Card className="p-4">
                <div className="micro mb-3">Items</div>
                <div className="space-y-2">
                  {order.lines.map((l) => (
                    <div key={l.line_id} className="flex items-center justify-between text-[13px]">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold truncate">{l.product_name_snapshot}</div>
                        {l.variant_label_snapshot && <div className="text-[11px] text-text-faint">{l.variant_label_snapshot}</div>}
                      </div>
                      <div className="text-text-muted mx-3">×{l.quantity}</div>
                      <MoneyText ngn={Number(l.line_total)} />
                    </div>
                  ))}
                  <div className="h-px bg-line my-2" />
                  <div className="flex justify-between text-[13px]"><span className="text-text-muted">Subtotal</span><MoneyText ngn={Number(order.subtotal_ngn)} /></div>
                  {Number(order.discount_amount_ngn) > 0 && <div className="flex justify-between text-[13px]"><span className="text-text-muted">Discount</span><span className="text-success">−<MoneyText ngn={Number(order.discount_amount_ngn)} /></span></div>}
                  {Number(order.tax_amount_ngn) > 0 && <div className="flex justify-between text-[13px]"><span className="text-text-muted">Tax</span><MoneyText ngn={Number(order.tax_amount_ngn)} /></div>}
                  {Number(order.shipping_fee_ngn) > 0 && <div className="flex justify-between text-[13px]"><span className="text-text-muted">Shipping</span><MoneyText ngn={Number(order.shipping_fee_ngn)} /></div>}
                  <div className="flex justify-between text-[15px] font-semibold pt-1"><span>Total</span><MoneyText ngn={Number(order.total_ngn)} /></div>
                </div>
              </Card>
            )}

            {/* Payments ledger */}
            {order.payments && order.payments.length > 0 && (
              <Card className="p-4">
                <div className="micro mb-3">Payments</div>
                <div className="space-y-2">
                  {order.payments.map((p: OrderPayment) => (
                    <div key={p.payment_id} className="flex items-center justify-between text-[13px] p-2 rounded-lg bg-text-primary/[0.02]">
                      <div>
                        <div className="font-semibold">{p.payment_number}</div>
                        <div className="text-[11px] text-text-faint capitalize">{p.method.replace(/_/g, " ")}</div>
                      </div>
                      <div className="text-right">
                        <MoneyText ngn={Number(p.amount_ngn)} />
                        <div className="text-[10px] text-text-faint">{new Date(p.captured_at).toLocaleDateString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Timeline */}
            {timeline && timeline.length > 0 && (
              <Card className="p-4">
                <div className="micro mb-3">Timeline</div>
                <div className="space-y-3">
                  {timeline.map((ev) => (
                    <div key={ev.event_id} className="flex gap-3 text-[12px]">
                      <div className="w-1.5 h-1.5 mt-1.5 rounded-full bg-accent shrink-0" />
                      <div>
                        <div className="font-semibold">{ev.label}</div>
                        <div className="text-text-faint">{new Date(ev.created_at).toLocaleString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Actions */}
            {order.status !== "cancelled" && order.status !== "completed" && (
              <div className="flex gap-2">
                <Button variant="danger" size="sm" icon={<XCircle className="w-3.5 h-3.5" />} onClick={() => setConfirmCancel(true)}>
                  Cancel Order
                </Button>
              </div>
            )}
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={handleCancel}
        title="Cancel Order"
        message="Are you sure you want to cancel this order? This action cannot be undone."
        confirmLabel="Cancel Order"
        busy={cancelOrder.isPending}
      />
    </>
  );
}
