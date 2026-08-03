/**
 * Booking modal — the one place a delivery moves queued → booked.
 *
 * Replaces the old single-click "Book with courier" button (the exact
 * mistake this module was built to stop happening again). Fully manual,
 * two-step: fill in every booking detail, then a review screen that
 * requires an explicit confirm before anything is written. "Edit" from the
 * review screen returns to the form with nothing lost.
 */

import { useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  Loader2,
  Mail,
  MailX,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { Select } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { money, formatDateTime } from "@/lib/format";
import { toastReport } from "@/lib/error-report";
import {
  useBookDelivery,
  useCouriers,
  type CustomerNotification,
  type Delivery,
} from "@/lib/logistics-api";

type Step = "form" | "review" | "done";

/** Why a notice didn't go out, in the operator's language rather than the API's. */
const NOT_SENT_TEXT: Record<string, string> = {
  suppressed_by_operator: "You chose not to notify the customer.",
  no_customer_on_delivery: "This delivery isn't linked to a customer.",
  no_customer_email: "No email address on file for this customer.",
  no_email: "No email address on file for this customer.",
  no_phone: "No phone number on file for this customer.",
  disabled: "The Delivery Booked automation is switched off in Messaging settings.",
  not_configured: "The Delivery Booked automation isn't set up for this business.",
  already_sent: "The customer was already told about this booking.",
  send_failed: "The send failed — retry from the delivery's Customer updates panel.",
};

// Why a delivery isn't dispatchable, in the dispatcher's language.
const NOT_READY_TEXT: Record<string, string> = {
  awaiting_studio: "The wig is still in the studio.",
  awaiting_fulfilment: "The order hasn't been packed yet.",
  order_blocked: "The order is cancelled or refunded.",
};

function toIso(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function localInputValue(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function BookDeliveryModal({
  delivery,
  onClose,
}: {
  delivery: Delivery;
  onClose: () => void;
}) {
  const couriersQ = useCouriers();
  const book = useBookDelivery();
  const couriers = (couriersQ.data ?? []).filter((c) => c.is_active);

  const [step, setStep] = useState<Step>("form");
  const [courierId, setCourierId] = useState(delivery.courier_id || couriers[0]?.courier_id || "");
  const [fee, setFee] = useState(delivery.courier_fee_ngn != null ? String(delivery.courier_fee_ngn) : "");
  const [trackingRef, setTrackingRef] = useState(delivery.courier_tracking_ref ?? "");
  const [trackingUrl, setTrackingUrl] = useState(delivery.courier_tracking_url ?? "");
  const [pickupAt, setPickupAt] = useState(localInputValue(delivery.scheduled_pickup_at));
  const [etaAt, setEtaAt] = useState(localInputValue(delivery.expected_delivery_at));
  const [driverName, setDriverName] = useState(delivery.driver_name ?? "");
  const [driverPhone, setDriverPhone] = useState(delivery.driver_phone ?? "");

  const selectedCourier = couriers.find((c) => c.courier_id === courierId);
  const canContinue = Boolean(courierId) && fee.trim().length > 0;

  // Booking something the studio hasn't finished is allowed — scheduling a
  // courier for tomorrow while the wig finishes tonight is real — but it has
  // to be deliberate. The API refuses without the acknowledgement, and the
  // reason is written to the delivery's timeline.
  const notReady = Boolean(delivery.readiness && delivery.readiness !== "ready");
  const [notReadyReason, setNotReadyReason] = useState("");

  // Booking tells the customer who is carrying her order and when to expect
  // it. On by default — the whole point is that she stops having to ask — but
  // a courier swap on an order already being handled by phone can go silent.
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [notice, setNotice] = useState<CustomerNotification | null>(null);
  const recipientName = delivery.recipient_name_snapshot || "the customer";

  function confirm() {
    book.mutate(
      {
        id: delivery.delivery_id,
        acknowledge_not_ready: notReady || undefined,
        not_ready_reason: notReady ? notReadyReason.trim() || undefined : undefined,
        courier_id: courierId || undefined,
        courier_fee_ngn: fee ? Number(fee) : undefined,
        courier_tracking_ref: trackingRef.trim() || undefined,
        courier_tracking_url: trackingUrl.trim() || undefined,
        scheduled_pickup_at: toIso(pickupAt),
        expected_delivery_at: toIso(etaAt),
        driver_name: driverName.trim() || undefined,
        driver_phone: driverPhone.trim() || undefined,
        notify_customer: notifyCustomer ? undefined : false,
      },
      {
        // The booking has landed either way — the last step reports whether
        // the customer heard about it, so a silent failure can't slip past.
        onSuccess: (booked) => {
          setNotice(booked.customer_notification ?? { sent: false });
          setStep("done");
        },
        onError: (e) => toastReport("Logistics → Booking", "Book delivery", e),
      },
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={
        step === "form"
          ? "Book delivery"
          : step === "review"
            ? "Confirm booking"
            : "Delivery booked"
      }
      size="lg"
      footer={
        step === "form" ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!canContinue}
              onClick={() => setStep("review")}
              icon={<ArrowLeft className="w-4 h-4 rotate-180" />}
            >
              Review booking
            </Button>
          </>
        ) : step === "review" ? (
          <>
            <Button variant="ghost" icon={<ArrowLeft className="w-4 h-4" />} onClick={() => setStep("form")}>
              Edit
            </Button>
            <Button
              variant="primary"
              disabled={book.isPending}
              onClick={confirm}
              icon={book.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            >
              Confirm &amp; book
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onClose} icon={<CheckCircle2 className="w-4 h-4" />}>
            Done
          </Button>
        )
      }
    >
      {step === "form" ? (
        <div className="space-y-5">
          <div>
            <div className="micro mb-2">Courier</div>
            <Select
              value={courierId}
              onChange={setCourierId}
              options={
                couriers.length
                  ? couriers.map((c) => ({ value: c.courier_id, label: c.display_name }))
                  : [{ value: "", label: "No active agencies — add one first" }]
              }
            />
            {/* Reference rates for comparison — the fee below is always typed fresh. */}
            {couriers.length > 0 && (
              <div className="mt-2 rounded-xl border border-line divide-y divide-line overflow-hidden">
                {couriers.map((c) => (
                  <button
                    type="button"
                    key={c.courier_id}
                    onClick={() => setCourierId(c.courier_id)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-[12px] transition-colors ${
                      c.courier_id === courierId ? "bg-accent/[0.08] text-accent-glow" : "hover:bg-text-primary/[0.03]"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Truck className="w-3.5 h-3.5" />
                      {c.display_name}
                    </span>
                    <span className="font-mono text-text-faint">
                      {c.rate_card?.flat != null ? `from ₦${Number(c.rate_card.flat).toLocaleString()}` : "no reference rate"}
                      {c.rate_card?.per_kg != null ? ` +₦${Number(c.rate_card.per_kg).toLocaleString()}/kg` : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedCourier?.contact_person && (
            <p className="text-[11.5px] text-text-muted">
              Contact: {selectedCourier.contact_person}
              {selectedCourier.contact_phone ? ` · ${selectedCourier.contact_phone}` : ""}
              {selectedCourier.preferred_pickup_location ? ` · pickup at ${selectedCourier.preferred_pickup_location}` : ""}
            </p>
          )}

          <Field label="Agreed fee (₦) — this booking only">
            <Input value={fee} onChange={(v) => setFee(v.replace(/[^0-9.]/g, ""))} placeholder="0" mono />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Booking ID / AWB / tracking ref">
              <Input value={trackingRef} onChange={setTrackingRef} placeholder="Waybill number" />
            </Field>
            <Field label="Tracking URL (optional)">
              <Input value={trackingUrl} onChange={setTrackingUrl} placeholder="https://…" />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Pickup time">
              <input
                type="datetime-local"
                value={pickupAt}
                onChange={(e) => setPickupAt(e.target.value)}
                className="w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 h-[42px] text-[13px] outline-none focus:border-accent/50"
              />
            </Field>
            <Field label="Expected delivery (ETD)">
              <input
                type="datetime-local"
                value={etaAt}
                onChange={(e) => setEtaAt(e.target.value)}
                className="w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 h-[42px] text-[13px] outline-none focus:border-accent/50"
              />
            </Field>
          </div>

          <div>
            <div className="micro mb-2">Driver details (for Uber, In-Drive, Bolt &amp; similar ad-hoc riders)</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Driver name">
                <Input value={driverName} onChange={setDriverName} placeholder="Optional" />
              </Field>
              <Field label="Driver phone">
                <Input value={driverPhone} onChange={setDriverPhone} placeholder="Optional" />
              </Field>
            </div>
          </div>

          {book.isError && <p className="text-[12px] text-danger">Couldn&rsquo;t book this delivery.</p>}
        </div>
      ) : step === "done" ? (
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 rounded-xl border border-success/30 bg-success/[0.06] p-3">
            <CheckCircle2 className="w-4.5 h-4.5 text-success shrink-0 mt-px" />
            <div className="text-[12.5px]">
              <div className="font-medium">
                Booked with {selectedCourier?.display_name ?? "the courier"}
              </div>
              <div className="text-text-muted">
                {delivery.delivery_number}
                {trackingRef ? ` · ${trackingRef}` : ""}
              </div>
            </div>
          </div>

          {/* The whole reason this step exists: the booking succeeded, but did
              the customer actually get told? Say so either way. */}
          <div
            className={`flex items-start gap-2.5 rounded-xl border p-3 ${
              notice?.sent
                ? "border-line bg-text-primary/[0.02]"
                : "border-warn/40 bg-warn/[0.06]"
            }`}
          >
            {notice?.sent ? (
              <Mail className="w-4.5 h-4.5 text-success shrink-0 mt-px" />
            ) : (
              <MailX className="w-4.5 h-4.5 text-warn shrink-0 mt-px" />
            )}
            <div className="text-[12.5px] min-w-0">
              <div className="font-medium">
                {notice?.sent
                  ? `Delivery details sent to ${recipientName}`
                  : "Customer not notified"}
              </div>
              <div className="text-text-muted break-words">
                {notice?.sent
                  ? `${notice.channel === "whatsapp" ? "WhatsApp" : notice.channel === "instagram" ? "Instagram" : "Email"}${
                      notice.recipient ? ` · ${notice.recipient}` : ""
                    } — shipper, waybill and expected delivery date included.`
                  : (NOT_SENT_TEXT[notice?.reason ?? ""] ??
                    "Nothing was sent to the customer.")}
              </div>
              {!notice?.sent && notice?.reason !== "suppressed_by_operator" && (
                <div className="text-[11px] text-text-faint mt-1">
                  You can retry from the delivery&rsquo;s Customer updates panel.
                </div>
              )}
            </div>
          </div>

          <p className="text-[11.5px] text-text-faint">
            Delivery status is tracked under Customer updates on this
            delivery — sent, delivered, and opened.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-[12.5px] text-text-muted">
            Check every detail below. This locks in the booking — edit now if anything is wrong.
          </p>
          {notReady && (
            <div className="rounded-xl border border-warn/40 bg-warn/[0.07] p-3 space-y-2">
              <div className="flex items-start gap-2">
                <CircleAlert className="w-4 h-4 text-warn shrink-0 mt-px" />
                <div className="text-[12px]">
                  <div className="font-medium text-warn">
                    This delivery isn&rsquo;t ready to dispatch
                  </div>
                  <div className="text-text-muted">
                    {NOT_READY_TEXT[delivery.readiness ?? ""] ??
                      "The order isn't packed yet."}{" "}
                    You can still book the courier now — the early booking is
                    recorded on the delivery timeline.
                  </div>
                </div>
              </div>
              <input
                value={notReadyReason}
                onChange={(e) => setNotReadyReason(e.target.value)}
                placeholder="Why book now? (optional)"
                className="w-full bg-transparent border border-line rounded-lg px-2.5 h-[36px] text-[12.5px] outline-none focus:border-accent/50"
                autoComplete="off"
              />
            </div>
          )}
          <div className="rounded-xl border border-line divide-y divide-line">
            <Review label="Courier" value={selectedCourier?.display_name ?? "—"} />
            <Review label="Agreed fee" value={fee ? money(Number(fee)) : "—"} />
            <Review label="Tracking ref" value={trackingRef || "—"} />
            <Review label="Tracking URL" value={trackingUrl || "—"} />
            <Review label="Pickup time" value={pickupAt ? formatDateTime(pickupAt) : "—"} />
            <Review label="Expected delivery" value={etaAt ? formatDateTime(etaAt) : "—"} />
            <Review label="Driver" value={driverName ? `${driverName}${driverPhone ? ` · ${driverPhone}` : ""}` : "—"} />
          </div>

          {/* Confirming sends these same details to the customer. Say so
              before the click, not after. */}
          <label className="flex items-start gap-2.5 rounded-xl border border-line p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={notifyCustomer}
              onChange={(e) => setNotifyCustomer(e.target.checked)}
              className="mt-0.5 accent-accent w-4 h-4 shrink-0"
            />
            <div className="text-[12.5px] min-w-0">
              <div className="font-medium">Tell {recipientName} it&rsquo;s booked</div>
              <div className="text-text-muted">
                Sends the shipper, waybill and expected delivery date, with a
                tracking link — on whichever channel Messaging settings picked
                for Delivery Booked.
              </div>
            </div>
          </label>
        </div>
      )}
    </Modal>
  );
}

function Review({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[13px]">
      <span className="text-text-faint">{label}</span>
      <span className="font-medium text-right">{value}</span>
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
      className={`w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 h-[42px] text-[13px] outline-none focus:border-accent/50 ${mono ? "font-mono text-[12px]" : ""}`}
      autoComplete="off"
    />
  );
}
