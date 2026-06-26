import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { createBooking } from "@/lib/bookings.functions";
import type { ServiceDetail } from "@/lib/services.functions";

type PaymentProvider = "stripe" | "paystack" | "nomba";

export function BookingDrawer({
  open, onClose, service,
}: { open: boolean; onClose: () => void; service: ServiceDetail }) {
  const { user } = useAuth();
  const { currency, format } = useCurrency();
  const navigate = useNavigate();
  const create = useServerFn(createBooking);

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("10:00");
  const [name, setName] = useState(user?.email?.split("@")[0] ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [provider, setProvider] = useState<PaymentProvider>(currency === "NGN" ? "paystack" : "stripe");
  const [submitting, setSubmitting] = useState(false);

  const depositNgn =
    service.deposit_required
      ? service.deposit_amount_ngn ??
        (service.deposit_pct && service.price_ngn
          ? Math.round((service.price_ngn * service.deposit_pct) / 100)
          : null)
      : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) {
      toast.info("Please sign in to book.");
      navigate({ to: "/auth" });
      return;
    }
    setSubmitting(true);
    try {
      const scheduledAt = new Date(`${date}T${time}:00`).toISOString();
      await create({
        data: {
          service_id: service.id,
          scheduled_at: scheduledAt,
          duration_minutes: (service.duration_minutes ?? 60) + (service.buffer_minutes ?? 0),
          location_type: service.location_type,
          customer_name: name,
          customer_email: email,
          customer_phone: phone || undefined,
          notes: notes || undefined,
          deposit_amount_ngn: depositNgn ?? undefined,
          payment_provider: provider,
        },
      });
      toast.success("Booking received — we'll confirm shortly.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create booking.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[80] bg-ink/70 backdrop-blur-sm"
          />
          <motion.aside
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 200, damping: 28 }}
            className="fixed right-0 top-0 z-[81] h-full w-full max-w-[480px] bg-card border-l border-taupe/20 overflow-y-auto"
          >
            <header className="flex items-center justify-between p-6 border-b border-taupe/15">
              <div>
                <p className="text-[0.6rem] tracking-[0.4em] uppercase text-taupe">Book · réserver</p>
                <h2 className="font-display text-2xl mt-1">{service.name}</h2>
              </div>
              <button onClick={onClose} className="text-cream/70 hover:text-cream"><X /></button>
            </header>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date">
                  <input type="date" required min={today} value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Time">
                  <input type="time" required value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} />
                </Field>
              </div>

              <Field label="Full name">
                <input required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Email">
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Phone (optional)">
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+234 …" className={inputCls} />
              </Field>
              <Field label="Notes (optional)">
                <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
              </Field>

              {depositNgn != null && (
                <div className="border-t border-taupe/15 pt-5 space-y-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[0.65rem] tracking-[0.4em] uppercase text-taupe">Deposit due</span>
                    <span className="font-display text-xl text-cream">
                      {format(depositNgn / 1650, { ngnOverride: depositNgn })}
                    </span>
                  </div>
                  <Field label="Pay with">
                    <div className="grid grid-cols-3 gap-2">
                      {(["stripe", "paystack", "nomba"] as PaymentProvider[]).map((p) => (
                        <button
                          type="button"
                          key={p}
                          onClick={() => setProvider(p)}
                          className={`py-2.5 text-[0.6rem] tracking-[0.3em] uppercase border transition-colors ${
                            provider === p ? "border-taupe bg-taupe/10 text-cream" : "border-taupe/30 text-cream/65 hover:border-taupe"
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </Field>
                  <p className="text-[0.6rem] tracking-[0.3em] uppercase text-cream/45">
                    Payment integration pending — booking will be created with deposit pending.
                  </p>
                </div>
              )}

              {service.cancellation_policy && (
                <p className="text-xs text-cream/55 border-l border-rose/40 pl-3">{service.cancellation_policy}</p>
              )}

              <button
                disabled={submitting}
                type="submit"
                className="w-full py-4 bg-taupe text-ink text-[0.7rem] tracking-[0.5em] uppercase hover:bg-cream transition-colors disabled:opacity-50"
              >
                {submitting ? "Booking…" : user ? "Confirm booking →" : "Sign in to book →"}
              </button>
            </form>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

const inputCls =
  "w-full bg-ink border border-taupe/25 px-3 py-2.5 text-sm text-cream placeholder:text-cream/35 focus:border-taupe focus:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[0.6rem] tracking-[0.4em] uppercase text-taupe mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}
