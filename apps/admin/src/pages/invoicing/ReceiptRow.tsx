/**
 * One receipt in the invoice's Receipts card, with the same send/track/resend
 * affordances as the invoice itself: a Sent/Opened pill, a Send/Resend control
 * (email/WhatsApp), and an expandable Delivery panel showing the full history.
 */

import { useState } from "react";
import { Send, ChevronDown, ChevronRight } from "lucide-react";
import { Pill, MoneyText, Button } from "@/components/ui/primitives";
import { Select } from "@/components/ui/controls";
import { useSendReceipt, useReceiptDelivery } from "./hooks";
import { DeliveryPanel } from "./DeliveryPanel";
import type { Receipt } from "./types";

const SEND_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "sms", label: "SMS" },
];

export function ReceiptRow({
  receipt,
  invoiceId,
  fireToast,
}: {
  receipt: Receipt;
  invoiceId: string | null;
  fireToast: (title: string, body: string, priority?: "normal" | "high") => void;
}) {
  const sendReceipt = useSendReceipt(invoiceId);
  const [showSend, setShowSend] = useState(false);
  const [sentVia, setSentVia] = useState("email");
  const [expanded, setExpanded] = useState(false);
  const { data: delivery, isLoading: deliveryLoading } = useReceiptDelivery(
    expanded ? receipt.receipt_id : null,
  );

  const handleSend = async () => {
    try {
      await sendReceipt.mutateAsync({ receiptId: receipt.receipt_id, sent_via: sentVia });
      setShowSend(false);
      fireToast("Receipt Sent", `Sent to the customer via ${sentVia.replace(/_/g, " ")}.`);
    } catch (err) {
      fireToast(
        "Send Failed",
        err instanceof Error ? err.message : "Failed to send the receipt.",
        "high",
      );
    }
  };

  const sentMeta = receipt.sent_at
    ? { label: "Sent", tone: "info" as const }
    : { label: "Not sent", tone: "neutral" as const };

  return (
    <div className="rounded-lg bg-text-primary/[0.02]">
      <div className="flex items-center justify-between text-[13px] p-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 min-w-0 text-left hover:opacity-80"
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-text-faint shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-text-faint shrink-0" />
          )}
          <div className="min-w-0">
            <div className="font-semibold flex items-center gap-2">
              {receipt.receipt_number}
              <Pill tone={sentMeta.tone}>{sentMeta.label}</Pill>
            </div>
            <div className="text-[11px] text-text-faint capitalize">
              {receipt.payment_method.replace(/_/g, " ")}
            </div>
          </div>
        </button>
        <div className="text-right shrink-0">
          <MoneyText ngn={Number(receipt.amount_ngn)} />
          <div className="text-[10px] text-text-faint">
            {new Date(receipt.issued_at).toLocaleDateString()}
          </div>
        </div>
      </div>

      {/* Send / resend control */}
      <div className="px-2 pb-2">
        {showSend ? (
          <div className="flex items-center gap-2">
            <Select value={sentVia} onChange={setSentVia} options={SEND_OPTIONS} className="w-[130px]" />
            <Button
              variant="primary"
              size="sm"
              icon={<Send className="w-3.5 h-3.5" />}
              onClick={handleSend}
              disabled={sendReceipt.isPending}
            >
              {sendReceipt.isPending ? "Sending…" : "Confirm"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowSend(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            icon={<Send className="w-3.5 h-3.5" />}
            onClick={() => setShowSend(true)}
          >
            {receipt.sent_at ? "Resend Receipt" : "Send Receipt"}
          </Button>
        )}
      </div>

      {expanded && (
        <div className="px-2 pb-2">
          <DeliveryPanel delivery={delivery} isLoading={deliveryLoading} />
        </div>
      )}
    </div>
  );
}
