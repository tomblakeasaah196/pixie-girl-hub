import { useState } from "react";
import {
  Send, CheckCircle, XCircle, ArrowRightCircle,
} from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { Card, Pill, MoneyText, Button } from "@/components/ui/primitives";
import { ErrorState, ConfirmDialog, Select } from "@/components/ui/controls";
import { FormGrid } from "@/components/ui/Form";
import { useQuotation, useSendQuotation, useAcceptQuotation, useConvertQuotation } from "./hooks";
import { QUOTE_STATUS, SALES_CHANNELS } from "./constants";
import type { SalesChannel, QuotationSendInput } from "./types";

const SEND_OPTIONS: { value: NonNullable<QuotationSendInput["sent_via"]>; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "sms", label: "SMS" },
];

export function QuoteDetail({ quoteId, onClose }: { quoteId: string | null; onClose: () => void }) {
  const { data: quote, isLoading, isError, refetch } = useQuotation(quoteId);
  const sendQuote = useSendQuotation();
  const acceptQuote = useAcceptQuotation();
  const convertQuote = useConvertQuotation();

  const [sendVia, setSendVia] = useState<NonNullable<QuotationSendInput["sent_via"]>>("email");
  const [showConvert, setShowConvert] = useState(false);
  const [convertChannel, setConvertChannel] = useState<SalesChannel>("walk_in");

  const handleSend = async () => {
    if (!quoteId) return;
    await sendQuote.mutateAsync({ id: quoteId, input: { sent_via: sendVia } });
  };

  const handleAccept = async () => {
    if (!quoteId) return;
    await acceptQuote.mutateAsync(quoteId);
  };

  const handleConvert = async () => {
    if (!quoteId) return;
    await convertQuote.mutateAsync({ id: quoteId, input: { sales_channel: convertChannel } });
    setShowConvert(false);
    onClose();
  };

  const statusMeta = quote ? QUOTE_STATUS[quote.status] : null;

  return (
    <>
      <Drawer open={!!quoteId} onClose={onClose} title={quote?.quotation_number ?? "Quotation"} subtitle={statusMeta && <Pill tone={statusMeta.tone}>{statusMeta.label}</Pill>} wide>
        {isLoading && <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-12 rounded-xl bg-text-primary/[0.04] animate-pulse" />)}</div>}
        {isError && <ErrorState onRetry={() => refetch()} />}
        {quote && (
          <div className="space-y-5">
            {/* Info */}
            <Card className="p-4">
              <FormGrid>
                <div><div className="micro">Customer</div><div className="text-[14px] font-semibold mt-1">{quote.contact_name ?? quote.contact_id.slice(0, 8)}</div></div>
                <div><div className="micro">Created</div><div className="text-[13px] mt-1">{new Date(quote.created_at).toLocaleString()}</div></div>
                <div><div className="micro">Valid Until</div><div className="text-[13px] mt-1">{quote.valid_until ? new Date(quote.valid_until).toLocaleDateString() : "—"}</div></div>
                <div><div className="micro">Delivery</div><div className="text-[13px] mt-1 capitalize">{quote.delivery_type?.replace(/_/g, " ") ?? "—"}</div></div>
              </FormGrid>
              {quote.payment_terms && (
                <div className="mt-3"><div className="micro">Payment Terms</div><div className="text-[13px] mt-1">{quote.payment_terms}</div></div>
              )}
              {quote.notes && (
                <div className="mt-3"><div className="micro">Notes</div><div className="text-[13px] mt-1 text-text-muted">{quote.notes}</div></div>
              )}
            </Card>

            {/* Lines */}
            {quote.lines && quote.lines.length > 0 && (
              <Card className="p-4">
                <div className="micro mb-3">Items</div>
                <div className="space-y-2">
                  {quote.lines.map((l) => (
                    <div key={l.line_id} className="flex items-center justify-between text-[13px]">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold truncate">{l.product_name_snapshot}</div>
                        {l.variant_label_snapshot && <div className="text-[11px] text-text-faint">{l.variant_label_snapshot}</div>}
                      </div>
                      <div className="text-text-muted mx-3">×{l.quantity}</div>
                      <MoneyText ngn={Number(l.line_total_ngn)} />
                    </div>
                  ))}
                  <div className="h-px bg-line my-2" />
                  <div className="flex justify-between text-[13px]"><span className="text-text-muted">Subtotal</span><MoneyText ngn={Number(quote.subtotal_ngn)} /></div>
                  {Number(quote.discount_amount_ngn) > 0 && <div className="flex justify-between text-[13px]"><span className="text-text-muted">Discount</span><MoneyText ngn={Number(quote.discount_amount_ngn)} /></div>}
                  {Number(quote.tax_amount_ngn) > 0 && <div className="flex justify-between text-[13px]"><span className="text-text-muted">Tax</span><MoneyText ngn={Number(quote.tax_amount_ngn)} /></div>}
                  {Number(quote.shipping_fee_ngn) > 0 && <div className="flex justify-between text-[13px]"><span className="text-text-muted">Shipping</span><MoneyText ngn={Number(quote.shipping_fee_ngn)} /></div>}
                  <div className="flex justify-between text-[15px] font-semibold pt-1"><span>Total</span><MoneyText ngn={Number(quote.total_ngn)} /></div>
                </div>
              </Card>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              {quote.status === "draft" && (
                <div className="flex items-center gap-2">
                  <Select value={sendVia} onChange={setSendVia} options={SEND_OPTIONS} className="w-[130px]" />
                  <Button variant="primary" size="sm" icon={<Send className="w-3.5 h-3.5" />} onClick={handleSend} disabled={sendQuote.isPending}>
                    {sendQuote.isPending ? "Sending…" : "Send Quote"}
                  </Button>
                </div>
              )}
              {(quote.status === "sent" || quote.status === "viewed") && (
                <Button variant="primary" size="sm" icon={<CheckCircle className="w-3.5 h-3.5" />} onClick={handleAccept} disabled={acceptQuote.isPending}>
                  {acceptQuote.isPending ? "Accepting…" : "Mark Accepted"}
                </Button>
              )}
              {quote.status === "accepted" && (
                <Button variant="primary" size="sm" icon={<ArrowRightCircle className="w-3.5 h-3.5" />} onClick={() => setShowConvert(true)}>
                  Convert to Order
                </Button>
              )}
              {quote.converted_sales_order_id && (
                <div className="text-[12px] text-success flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5" />
                  Converted to order
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={showConvert}
        onClose={() => setShowConvert(false)}
        onConfirm={handleConvert}
        title="Convert to Sales Order"
        message={
          <div className="space-y-3">
            <p>This will create a new sales order from this quotation.</p>
            <div>
              <div className="text-[10.5px] uppercase tracking-[0.1em] font-bold text-text-muted mb-2">Sales Channel</div>
              <Select value={convertChannel} onChange={setConvertChannel} options={SALES_CHANNELS as unknown as { value: SalesChannel; label: string }[]} />
            </div>
          </div>
        }
        confirmLabel="Convert"
        tone="accent"
        busy={convertQuote.isPending}
      />
    </>
  );
}
