import { useState } from "react";
import { Download, Send, CreditCard, XCircle, FileText, Plus, X } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { Card, Pill, MoneyText, Button } from "@/components/ui/primitives";
import { ErrorState, ConfirmDialog, Select, NumberField } from "@/components/ui/controls";
import { FormGrid, Field } from "@/components/ui/Form";
import { useToastStore } from "@/components/notifications/NotificationToast";
import {
  useInvoice,
  useInvoicePdf,
  useSendInvoice,
  useRecordPayment,
  useVoidInvoice,
  useInvoiceReceipts,
  useIssueReceipt,
  useInvoiceReminders,
  useCancelReminder,
} from "./hooks";
import { INVOICE_STATUS, REMINDER_STATUS, SEND_VIA_OPTIONS } from "./constants";
import { CreditNoteCreateDrawer } from "./CreditNoteCreateDrawer";
import type { InvoiceSendInput } from "./types";

const RECEIPT_PAYMENT_METHODS = [
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "cash", label: "Cash" },
  { value: "pos_card", label: "POS Card" },
  { value: "paystack", label: "Paystack" },
  { value: "opay", label: "OPay" },
  { value: "other", label: "Other" },
];

export function InvoiceDetail({ invoiceId, onClose }: { invoiceId: string | null; onClose: () => void }) {
  const { data: invoice, isLoading, isError, refetch } = useInvoice(invoiceId);
  const pdf = useInvoicePdf(invoiceId ?? "");
  const sendInvoice = useSendInvoice(invoiceId ?? "");
  const recordPayment = useRecordPayment(invoiceId ?? "");
  const voidInvoice = useVoidInvoice();
  const { data: receipts } = useInvoiceReceipts(invoiceId);
  const issueReceipt = useIssueReceipt();
  const { data: reminders } = useInvoiceReminders(invoiceId);
  const cancelReminder = useCancelReminder(invoiceId ?? "");

  const toast = useToastStore();
  const fireToast = (title: string, body: string, priority: "normal" | "high" = "normal") => {
    toast.add({
      notification_id: crypto.randomUUID(),
      user_id: "",
      business: null,
      type: "invoicing",
      priority,
      title,
      body,
      reference_type: null,
      reference_id: null,
      action_url: null,
      is_read: false,
      read_at: null,
      created_at: new Date().toISOString(),
    });
  };

  const [showSendForm, setShowSendForm] = useState(false);
  const [sentVia, setSentVia] = useState<NonNullable<InvoiceSendInput["sent_via"]>>("email");
  const [showPayForm, setShowPayForm] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payNotes, setPayNotes] = useState("");
  const [showReceiptForm, setShowReceiptForm] = useState(false);
  const [receiptAmount, setReceiptAmount] = useState("");
  const [receiptMethod, setReceiptMethod] = useState("bank_transfer");
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [showCreditNote, setShowCreditNote] = useState(false);

  const handleDownloadPdf = async () => {
    try {
      const res = await pdf.mutateAsync();
      window.open(res.url, "_blank");
    } catch {
      fireToast("PDF Failed", "Failed to generate the invoice PDF.", "high");
    }
  };

  const handleSend = async () => {
    try {
      await sendInvoice.mutateAsync({ sent_via: sentVia });
      setShowSendForm(false);
      fireToast("Invoice Sent", `Sent via ${sentVia.replace(/_/g, " ")}.`);
    } catch (err) {
      fireToast(
        "Send Failed",
        err instanceof Error ? err.message : "Failed to send the invoice.",
        "high",
      );
    }
  };

  const handleRecordPayment = async () => {
    if (!payAmount) return;
    try {
      await recordPayment.mutateAsync({ amount_applied_ngn: Number(payAmount), notes: payNotes || undefined });
      setShowPayForm(false);
      setPayAmount("");
      setPayNotes("");
      fireToast("Payment Recorded", `₦${Number(payAmount).toLocaleString()} applied to the invoice.`);
    } catch (err) {
      fireToast(
        "Payment Failed",
        err instanceof Error ? err.message : "Failed to record the payment.",
        "high",
      );
    }
  };

  const handleVoid = async () => {
    if (!invoiceId) return;
    try {
      await voidInvoice.mutateAsync(invoiceId);
      setConfirmVoid(false);
      fireToast("Invoice Voided", "The invoice has been voided.");
    } catch (err) {
      setConfirmVoid(false);
      fireToast(
        "Void Failed",
        err instanceof Error ? err.message : "Failed to void the invoice.",
        "high",
      );
    }
  };

  const handleIssueReceipt = async () => {
    if (!invoice || !receiptAmount) return;
    try {
      await issueReceipt.mutateAsync({
        invoice_id: invoice.invoice_id,
        contact_id: invoice.contact_id,
        amount_ngn: Number(receiptAmount),
        payment_method: receiptMethod,
      });
      setShowReceiptForm(false);
      setReceiptAmount("");
      fireToast("Receipt Issued", "The receipt has been issued.");
    } catch (err) {
      fireToast(
        "Receipt Failed",
        err instanceof Error ? err.message : "Failed to issue the receipt.",
        "high",
      );
    }
  };

  const handleCancelReminder = async (reminderId: string) => {
    try {
      await cancelReminder.mutateAsync(reminderId);
      fireToast("Reminder Cancelled", "The scheduled reminder was cancelled.");
    } catch {
      fireToast("Cancel Failed", "Failed to cancel the reminder.", "high");
    }
  };

  const statusMeta = invoice ? INVOICE_STATUS[invoice.status] : null;
  const canSend = !!invoice && !["void", "refunded"].includes(invoice.status);
  const canPay = !!invoice && !["void", "refunded"].includes(invoice.status) && Number(invoice.balance_due_ngn) > 0;
  const canVoid = !!invoice && invoice.status !== "void" && invoice.status !== "paid";

  return (
    <>
      <Drawer
        open={!!invoiceId}
        onClose={onClose}
        title={invoice?.invoice_number ?? "Invoice"}
        subtitle={statusMeta && <Pill tone={statusMeta.tone}>{statusMeta.label}</Pill>}
        wide
      >
        {isLoading && (
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-12 rounded-xl bg-text-primary/[0.04] animate-pulse" />
            ))}
          </div>
        )}
        {isError && <ErrorState onRetry={() => refetch()} />}
        {invoice && (
          <div className="space-y-5">
            {/* Top actions */}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" icon={<Download className="w-3.5 h-3.5" />} onClick={handleDownloadPdf} disabled={pdf.isPending}>
                {pdf.isPending ? "Generating…" : "Download PDF"}
              </Button>
              {canSend && (
                showSendForm ? (
                  <div className="flex items-center gap-2">
                    <Select
                      value={sentVia}
                      onChange={setSentVia}
                      options={SEND_VIA_OPTIONS as unknown as { value: NonNullable<InvoiceSendInput["sent_via"]>; label: string }[]}
                      className="w-[150px]"
                    />
                    <Button variant="primary" size="sm" icon={<Send className="w-3.5 h-3.5" />} onClick={handleSend} disabled={sendInvoice.isPending}>
                      {sendInvoice.isPending ? "Sending…" : "Confirm"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setShowSendForm(false)}>Cancel</Button>
                  </div>
                ) : (
                  <Button variant="secondary" size="sm" icon={<Send className="w-3.5 h-3.5" />} onClick={() => setShowSendForm(true)}>
                    {invoice.sent_at ? "Resend Invoice" : "Send Invoice"}
                  </Button>
                )
              )}
            </div>

            {/* Balance ribbon */}
            {canPay && (
              <div className="flex items-center justify-between p-4 rounded-[12px] bg-warn/[0.08] border border-warn/20">
                <div>
                  <div className="text-[11px] uppercase font-bold text-warn tracking-wide">Balance Due</div>
                  <MoneyText ngn={Number(invoice.balance_due_ngn)} className="text-[22px] text-warn" />
                </div>
                <Button variant="primary" size="sm" icon={<CreditCard className="w-3.5 h-3.5" />} onClick={() => setShowPayForm(!showPayForm)}>
                  Record Payment
                </Button>
              </div>
            )}

            {/* Record payment form */}
            {showPayForm && (
              <Card className="p-4">
                <div className="micro mb-3">Record Payment</div>
                <FormGrid>
                  <Field label="Amount (NGN)">
                    <NumberField value={payAmount} onChange={setPayAmount} placeholder="0.00" suffix="NGN" />
                  </Field>
                  <Field label="Notes" hint="optional">
                    <input
                      value={payNotes}
                      onChange={(e) => setPayNotes(e.target.value)}
                      placeholder="Payment note"
                      className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
                    />
                  </Field>
                </FormGrid>
                <div className="flex gap-2 mt-4">
                  <Button variant="primary" size="sm" onClick={handleRecordPayment} disabled={recordPayment.isPending || !payAmount}>
                    {recordPayment.isPending ? "Saving…" : "Save Payment"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowPayForm(false)}>Cancel</Button>
                </div>
              </Card>
            )}

            {/* Invoice info */}
            <Card className="p-4">
              <FormGrid>
                <div>
                  <div className="micro">Customer</div>
                  <div className="text-[14px] font-semibold mt-1">{invoice.contact_name ?? invoice.contact_id.slice(0, 8)}</div>
                </div>
                <div>
                  <div className="micro">Issue Date</div>
                  <div className="text-[13px] mt-1">{new Date(invoice.issue_date).toLocaleDateString()}</div>
                </div>
                <div>
                  <div className="micro">Due Date</div>
                  <div className="text-[13px] mt-1">{new Date(invoice.due_date).toLocaleDateString()}</div>
                </div>
                <div>
                  <div className="micro">Payment Terms</div>
                  <div className="text-[13px] mt-1">{invoice.payment_terms || "—"}</div>
                </div>
              </FormGrid>
            </Card>

            {/* Lines */}
            {invoice.lines && invoice.lines.length > 0 && (
              <Card className="p-4">
                <div className="micro mb-3">Items</div>
                <div className="space-y-2">
                  {invoice.lines.map((l) => (
                    <div key={l.invoice_line_id} className="flex items-center justify-between text-[13px]">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold truncate">{l.description}</div>
                        {l.sku_snapshot && <div className="text-[11px] text-text-faint">{l.sku_snapshot}</div>}
                      </div>
                      <div className="text-text-muted mx-3">×{Number(l.quantity)}</div>
                      <MoneyText ngn={Number(l.line_total_ngn)} />
                    </div>
                  ))}
                  <div className="h-px bg-line my-2" />
                  <div className="flex justify-between text-[13px]"><span className="text-text-muted">Subtotal</span><MoneyText ngn={Number(invoice.subtotal_ngn)} /></div>
                  {Number(invoice.discount_amount_ngn) > 0 && <div className="flex justify-between text-[13px]"><span className="text-text-muted">Discount</span><span className="text-success">−<MoneyText ngn={Number(invoice.discount_amount_ngn)} /></span></div>}
                  {Number(invoice.tax_amount_ngn) > 0 && <div className="flex justify-between text-[13px]"><span className="text-text-muted">Tax</span><MoneyText ngn={Number(invoice.tax_amount_ngn)} /></div>}
                  {Number(invoice.shipping_fee_ngn) > 0 && <div className="flex justify-between text-[13px]"><span className="text-text-muted">Shipping</span><MoneyText ngn={Number(invoice.shipping_fee_ngn)} /></div>}
                  {Number(invoice.wht_amount_ngn) > 0 && <div className="flex justify-between text-[13px]"><span className="text-text-muted">Withholding Tax</span><span className="text-success">−<MoneyText ngn={Number(invoice.wht_amount_ngn)} /></span></div>}
                  <div className="flex justify-between text-[15px] font-semibold pt-1"><span>Total</span><MoneyText ngn={Number(invoice.total_ngn)} /></div>
                  <div className="flex justify-between text-[12px] text-text-muted"><span>Paid to date</span><MoneyText ngn={Number(invoice.amount_paid_ngn)} /></div>
                </div>
              </Card>
            )}

            {/* Payments ledger */}
            {invoice.payments && invoice.payments.length > 0 && (
              <Card className="p-4">
                <div className="micro mb-3">Payments</div>
                <div className="space-y-2">
                  {invoice.payments.map((p) => (
                    <div key={p.invoice_payment_id} className="flex items-center justify-between text-[13px] p-2 rounded-lg bg-text-primary/[0.02]">
                      <div>
                        <div className="font-semibold"><MoneyText ngn={Number(p.amount_applied_ngn)} /></div>
                        {p.notes && <div className="text-[11px] text-text-faint">{p.notes}</div>}
                      </div>
                      <div className="text-[10px] text-text-faint">{new Date(p.applied_at).toLocaleDateString()}</div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Receipts */}
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="micro">Receipts</div>
                <Button variant="ghost" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowReceiptForm(!showReceiptForm)}>
                  Issue Receipt
                </Button>
              </div>
              {showReceiptForm && (
                <div className="mb-3 p-3 rounded-[11px] bg-text-primary/[0.03] border border-line">
                  <FormGrid>
                    <Field label="Amount (NGN)">
                      <NumberField value={receiptAmount} onChange={setReceiptAmount} placeholder="0.00" suffix="NGN" />
                    </Field>
                    <Field label="Method">
                      <Select value={receiptMethod} onChange={setReceiptMethod} options={RECEIPT_PAYMENT_METHODS} />
                    </Field>
                  </FormGrid>
                  <div className="flex gap-2 mt-3">
                    <Button variant="primary" size="sm" onClick={handleIssueReceipt} disabled={issueReceipt.isPending || !receiptAmount}>
                      {issueReceipt.isPending ? "Issuing…" : "Issue"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setShowReceiptForm(false)}>Cancel</Button>
                  </div>
                </div>
              )}
              {receipts && receipts.length > 0 ? (
                <div className="space-y-2">
                  {receipts.map((r) => (
                    <div key={r.receipt_id} className="flex items-center justify-between text-[13px] p-2 rounded-lg bg-text-primary/[0.02]">
                      <div>
                        <div className="font-semibold">{r.receipt_number}</div>
                        <div className="text-[11px] text-text-faint capitalize">{r.payment_method.replace(/_/g, " ")}</div>
                      </div>
                      <div className="text-right">
                        <MoneyText ngn={Number(r.amount_ngn)} />
                        <div className="text-[10px] text-text-faint">{new Date(r.issued_at).toLocaleDateString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                !showReceiptForm && <div className="text-[12px] text-text-faint">No receipts issued yet.</div>
              )}
            </Card>

            {/* Reminders */}
            {reminders && reminders.length > 0 && (
              <Card className="p-4">
                <div className="micro mb-3">Reminders</div>
                <div className="space-y-2">
                  {reminders.map((r) => {
                    const meta = REMINDER_STATUS[r.status];
                    return (
                      <div key={r.reminder_id} className="flex items-center justify-between text-[13px] p-2 rounded-lg bg-text-primary/[0.02]">
                        <div>
                          <div className="font-semibold capitalize">{r.reminder_type.replace(/_/g, " ")} · {r.channel}</div>
                          <div className="text-[11px] text-text-faint">{new Date(r.scheduled_for).toLocaleString()}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          {meta && <Pill tone={meta.tone}>{meta.label}</Pill>}
                          {r.status === "scheduled" && (
                            <button
                              type="button"
                              onClick={() => handleCancelReminder(r.reminder_id)}
                              className="p-1.5 rounded-lg text-text-faint hover:text-danger hover:bg-danger/10"
                              aria-label="Cancel reminder"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" icon={<FileText className="w-3.5 h-3.5" />} onClick={() => setShowCreditNote(true)}>
                New Credit Note
              </Button>
              {canVoid && (
                <Button variant="danger" size="sm" icon={<XCircle className="w-3.5 h-3.5" />} onClick={() => setConfirmVoid(true)}>
                  Void Invoice
                </Button>
              )}
            </div>
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={confirmVoid}
        onClose={() => setConfirmVoid(false)}
        onConfirm={handleVoid}
        title="Void Invoice"
        message="Are you sure you want to void this invoice? This action cannot be undone."
        confirmLabel="Void Invoice"
        busy={voidInvoice.isPending}
      />

      <CreditNoteCreateDrawer
        open={showCreditNote}
        onClose={() => setShowCreditNote(false)}
        onCreated={() => setShowCreditNote(false)}
        invoiceId={invoice?.invoice_id ?? null}
        invoiceNumber={invoice?.invoice_number ?? null}
      />
    </>
  );
}
