import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { motion, AnimatePresence } from "motion/react";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { requestOrderCancellation } from "@/lib/orders.functions";

export const Route = createFileRoute("/_authenticated/order/$id")({
  head: () => ({
    meta: [
      { title: "Order — Faitlyn Hair" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OrderPage,
  notFoundComponent: () => (
    <div className="min-h-screen bg-ink text-cream grid place-items-center p-8 text-center">
      <div>
        <h1 className="font-display text-4xl">Order not found</h1>
        <Link to="/account" className="mt-6 inline-block text-taupe underline">Back to account</Link>
      </div>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="min-h-screen bg-ink text-cream grid place-items-center p-8 text-center">
      <p>{error.message}</p>
    </div>
  ),
});

type Order = {
  id: string;
  order_number: string;
  status: string;
  subtotal: number;
  total: number;
  currency: string;
  created_at: string;
  items: Array<{ slug: string; name: string; variant: string; qty: number; price: number; image: string }>;
  shipping_address: any;
  contact_email: string | null;
  contact_phone: string | null;
  preferred_contact: string | null;
  concierge_notes: string | null;
};
type Event = { id: string; status: string; note: string | null; created_at: string };

const STAGES = ["inquiry", "confirmed", "preparing", "shipped", "delivered"] as const;
const STAGE_LABEL: Record<string, string> = {
  inquiry: "Inquiry received",
  confirmed: "Concierge confirmed",
  preparing: "Atelier preparing",
  shipped: "In transit",
  delivered: "Delivered",
  cancellation_requested: "Cancellation requested",
  cancelled: "Cancelled",
};
const CANCELLABLE = new Set(["inquiry", "confirmed", "preparing"]);

function OrderPage() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [justCreated, setJustCreated] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelAck, setCancelAck] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const cancelFn = useServerFn(requestOrderCancellation);

  useEffect(() => {
    if (!user) return;
    let active = true;

    (async () => {
      const { data: o } = await supabase.from("orders").select("*").eq("id", id).maybeSingle();
      if (!active) return;
      if (!o) { setLoading(false); return; }
      setOrder(o as unknown as Order);
      const ageMs = Date.now() - new Date(o.created_at).getTime();
      setJustCreated(ageMs < 15_000);
      const { data: ev } = await supabase
        .from("order_events").select("*").eq("order_id", id).order("created_at", { ascending: true });
      if (!active) return;
      setEvents((ev as Event[]) ?? []);
      setLoading(false);
    })();

    const channel = supabase
      .channel(`order:${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${id}` },
        (payload) => setOrder((cur) => cur ? { ...cur, ...(payload.new as unknown as Order) } : (payload.new as unknown as Order)))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "order_events", filter: `order_id=eq.${id}` },
        (payload) => setEvents((cur) => [...cur, payload.new as Event]))
      .subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
  }, [id, user]);

  if (loading) {
    return (
      <Shell>
        <div className="max-w-4xl mx-auto animate-pulse space-y-6">
          <div className="h-12 w-2/3 bg-taupe/10" />
          <div className="h-40 bg-taupe/5" />
          <div className="h-64 bg-taupe/5" />
        </div>
      </Shell>
    );
  }
  if (!order) throw notFound();

  const stageIdx = STAGES.indexOf(order.status as typeof STAGES[number]);
  const progress = stageIdx >= 0 ? ((stageIdx + 1) / STAGES.length) * 100 : 0;
  const ship = order.shipping_address ?? {};

  return (
    <Shell>
      <div className="mx-auto max-w-[1100px]">
        <AnimatePresence>
          {justCreated && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mb-10 border border-taupe/30 bg-taupe/5 p-6 text-center"
            >
              <p className="text-[0.62rem] tracking-[0.5em] uppercase text-taupe">Confirmed</p>
              <h2 className="font-display text-3xl mt-2">Thank you — your inquiry is with us.</h2>
              <p className="mt-2 text-sm text-cream/65">A concierge will reach out within 24 hours via {order.preferred_contact ?? "email"}.</p>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-taupe/15 pb-8">
            <div>
              <p className="text-[0.62rem] tracking-[0.5em] uppercase text-taupe/80">Order</p>
              <h1 className="font-display text-5xl mt-2">{order.order_number}</h1>
              <p className="mt-2 text-xs text-cream/55">
                Placed {new Date(order.created_at).toLocaleDateString(undefined, { dateStyle: "long" })}
              </p>
            </div>
            <div className="text-right">
              <span className="text-[0.6rem] tracking-[0.4em] uppercase text-taupe">{STAGE_LABEL[order.status] ?? order.status}</span>
              <div className="font-display text-4xl mt-1">${Number(order.total).toFixed(2)}</div>
            </div>
          </div>

          {order.status !== "cancelled" && (
            <div className="mt-10">
              <div className="relative h-[2px] bg-taupe/15">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute inset-y-0 left-0 bg-taupe"
                />
              </div>
              <div className="mt-4 grid grid-cols-5 gap-2 text-[0.55rem] tracking-[0.32em] uppercase">
                {STAGES.map((s, i) => (
                  <div key={s} className={`text-center ${i <= stageIdx ? "text-cream" : "text-cream/30"}`}>
                    {STAGE_LABEL[s]}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-14 grid lg:grid-cols-[1.4fr,1fr] gap-12">
            <section>
              <h3 className="font-display text-2xl mb-6">Activity</h3>
              <ol className="relative border-l border-taupe/20 pl-6 space-y-6">
                <AnimatePresence initial={false}>
                  {[...events].reverse().map((e) => (
                    <motion.li
                      key={e.id}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="relative"
                    >
                      <span className="absolute -left-[31px] top-1 w-3 h-3 rounded-full bg-taupe" />
                      <div className="text-[0.6rem] tracking-[0.4em] uppercase text-taupe">{STAGE_LABEL[e.status] ?? e.status}</div>
                      {e.note && <p className="text-sm text-cream/75 mt-1 leading-relaxed">{e.note}</p>}
                      <div className="text-[0.55rem] tracking-[0.3em] uppercase text-cream/40 mt-1">
                        {new Date(e.created_at).toLocaleString()}
                      </div>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ol>

              <h3 className="font-display text-2xl mt-12 mb-6">Pieces</h3>
              <div className="space-y-4">
                {order.items?.map((it, i) => (
                  <div key={i} className="flex gap-4 border border-taupe/15 p-4">
                    <img src={it.image} alt={it.name} className="w-20 h-24 object-cover" />
                    <div className="flex-1">
                      <div className="font-display text-lg">{it.name}</div>
                      <div className="text-[0.6rem] tracking-[0.3em] uppercase text-cream/55 mt-1">{it.variant} · ×{it.qty}</div>
                    </div>
                    <div className="text-taupe text-sm">${it.price * it.qty}</div>
                  </div>
                ))}
              </div>
            </section>

            <aside className="space-y-8">
              <div className="border border-taupe/15 p-6">
                <h4 className="text-[0.6rem] tracking-[0.4em] uppercase text-taupe mb-3">Shipping to</h4>
                <div className="text-sm leading-relaxed text-cream/80">
                  <div>{ship.line1}</div>
                  {ship.line2 && <div>{ship.line2}</div>}
                  <div>{ship.city}{ship.region ? `, ${ship.region}` : ""} {ship.postal_code}</div>
                  <div>{ship.country}</div>
                </div>
              </div>
              <div className="border border-taupe/15 p-6">
                <h4 className="text-[0.6rem] tracking-[0.4em] uppercase text-taupe mb-3">Concierge contact</h4>
                <div className="text-sm text-cream/80 space-y-1">
                  <div>{order.contact_email}</div>
                  <div>{order.contact_phone}</div>
                  <div className="text-[0.6rem] tracking-[0.3em] uppercase text-cream/50 pt-2">
                    Prefers {order.preferred_contact ?? "email"}
                  </div>
                </div>
              </div>
              {order.concierge_notes && (
                <div className="border border-taupe/15 p-6">
                  <h4 className="text-[0.6rem] tracking-[0.4em] uppercase text-taupe mb-3">Your notes</h4>
                  <p className="text-sm text-cream/75 whitespace-pre-wrap">{order.concierge_notes}</p>
                </div>
              )}
              {CANCELLABLE.has(order.status) && (
                <button
                  onClick={() => setCancelOpen(true)}
                  className="block w-full text-center border border-taupe/30 hover:border-taupe hover:text-cream text-[0.62rem] tracking-[0.4em] uppercase py-3 text-taupe transition-colors"
                >
                  Request cancellation
                </button>
              )}
              {order.status === "cancellation_requested" && (
                <div className="border border-taupe/30 bg-taupe/5 p-4 text-center text-[0.6rem] tracking-[0.4em] uppercase text-taupe">
                  Awaiting concierge confirmation
                </div>
              )}
              <Link to="/account" className="block text-center border border-taupe/30 hover:border-taupe text-[0.62rem] tracking-[0.4em] uppercase py-3">
                Back to account
              </Link>
            </aside>
          </div>
        </motion.div>
      </div>

      <AnimatePresence>
        {cancelOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-ink/85 backdrop-blur-sm grid place-items-center p-6"
            onClick={() => !cancelling && setCancelOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg bg-ink border border-taupe/25 p-8 md:p-10"
            >
              <p className="text-[0.6rem] tracking-[0.5em] uppercase text-taupe">Concierge</p>
              <h2 className="font-display text-3xl mt-2">Request cancellation</h2>
              <p className="mt-4 text-sm text-cream/70 leading-relaxed">
                Please review our{" "}
                <Link to="/policies/cancellation" target="_blank" className="text-taupe underline underline-offset-4 hover:text-cream">
                  cancellation policy
                </Link>{" "}
                before submitting. An atelier fee may apply if your piece is already in production.
              </p>

              <label className="block mt-6 text-[0.6rem] tracking-[0.4em] uppercase text-taupe mb-2">Reason</label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={4}
                placeholder="Share why you'd like to cancel — change of plans, sizing, timing…"
                className="w-full bg-transparent border border-taupe/25 focus:border-taupe outline-none p-3 text-sm text-cream resize-none"
              />

              <label className="mt-5 flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cancelAck}
                  onChange={(e) => setCancelAck(e.target.checked)}
                  className="mt-1 accent-taupe"
                />
                <span className="text-xs text-cream/75 leading-relaxed">
                  I have read and accept the{" "}
                  <Link to="/policies/cancellation" target="_blank" className="text-taupe underline underline-offset-4">
                    Cancellation Policy
                  </Link>
                  , including any atelier fees that may apply.
                </span>
              </label>

              <div className="mt-8 flex gap-3 justify-end">
                <button
                  onClick={() => setCancelOpen(false)}
                  disabled={cancelling}
                  className="px-5 py-2.5 text-[0.6rem] tracking-[0.4em] uppercase text-cream/60 hover:text-cream"
                >
                  Keep order
                </button>
                <button
                  disabled={!cancelAck || cancelReason.trim().length < 3 || cancelling}
                  onClick={async () => {
                    setCancelling(true);
                    try {
                      await cancelFn({ data: { orderId: order.id, reason: cancelReason.trim(), acknowledgedPolicy: true } });
                      toast.success("Cancellation request sent to your concierge.");
                      setCancelOpen(false);
                      setCancelReason("");
                      setCancelAck(false);
                    } catch (err: any) {
                      toast.error(err?.message ?? "Could not submit cancellation.");
                    } finally {
                      setCancelling(false);
                    }
                  }}
                  className="px-6 py-2.5 bg-taupe text-ink text-[0.6rem] tracking-[0.4em] uppercase disabled:opacity-40 hover:bg-cream transition-colors"
                >
                  {cancelling ? "Submitting…" : "Submit request"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-ink text-cream">
      <SiteHeader />
      <main className="pt-32 pb-24 px-6">{children}</main>
      <SiteFooter />
    </div>
  );
}
