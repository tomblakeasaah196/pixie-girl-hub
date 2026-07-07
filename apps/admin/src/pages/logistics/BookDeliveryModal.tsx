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
import { ArrowLeft, CheckCircle2, Loader2, Truck } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { Select } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { money } from "@/lib/format";
import { toastReport } from "@/lib/error-report";
import {
  useBookDelivery,
  useCouriers,
  type Delivery,
} from "@/lib/logistics-api";

type Step = "form" | "review";

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

  function confirm() {
    book.mutate(
      {
        id: delivery.delivery_id,
        courier_id: courierId || undefined,
        courier_fee_ngn: fee ? Number(fee) : undefined,
        courier_tracking_ref: trackingRef.trim() || undefined,
        courier_tracking_url: trackingUrl.trim() || undefined,
        scheduled_pickup_at: toIso(pickupAt),
        expected_delivery_at: toIso(etaAt),
        driver_name: driverName.trim() || undefined,
        driver_phone: driverPhone.trim() || undefined,
      },
      {
        onSuccess: onClose,
        onError: (e) => toastReport("Logistics → Booking", "Book delivery", e),
      },
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={step === "form" ? "Book delivery" : "Confirm booking"}
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
        ) : (
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
      ) : (
        <div className="space-y-4">
          <p className="text-[12.5px] text-text-muted">
            Check every detail below. This locks in the booking — edit now if anything is wrong.
          </p>
          <div className="rounded-xl border border-line divide-y divide-line">
            <Review label="Courier" value={selectedCourier?.display_name ?? "—"} />
            <Review label="Agreed fee" value={fee ? money(Number(fee)) : "—"} />
            <Review label="Tracking ref" value={trackingRef || "—"} />
            <Review label="Tracking URL" value={trackingUrl || "—"} />
            <Review label="Pickup time" value={pickupAt ? new Date(pickupAt).toLocaleString() : "—"} />
            <Review label="Expected delivery" value={etaAt ? new Date(etaAt).toLocaleString() : "—"} />
            <Review label="Driver" value={driverName ? `${driverName}${driverPhone ? ` · ${driverPhone}` : ""}` : "—"} />
          </div>
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
