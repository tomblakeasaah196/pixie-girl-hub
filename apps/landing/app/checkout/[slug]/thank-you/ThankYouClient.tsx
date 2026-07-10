"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { CheckCircle, Clock, Package, ArrowRight } from "lucide-react";
import { useCart } from "@/lib/cart-store";
import { fbTrackOnce } from "@/lib/fbpixel";
import { fetchOrderStatus } from "@/lib/api-client";
import { money } from "@/lib/format";
import type { LandingPayload } from "@/lib/types";

type OrderInfo = {
  order_id: string;
  order_number: string;
  status: string;
  total_ngn: string;
  currency: string;
  payment_plan?: "full" | "instalment";
  amount_paid_ngn?: string;
  balance_due_ngn?: string;
  pay_token?: string | null;
};

export function ThankYouClient({
  payload,
  orderId,
  reference,
  brandName,
}: {
  payload: LandingPayload;
  orderId: string | null;
  reference: string | null;
  brandName: string;
}) {
  const clearCart = useCart((s) => s.clear);
  const [order, setOrder] = useState<OrderInfo | null>(null);
  const [polling, setPolling] = useState(true);
  // The cart is cleared exactly once — and only after payment is CONFIRMED.
  const clearedRef = useRef(false);

  const resolvedId =
    orderId ||
    (typeof window !== "undefined"
      ? sessionStorage.getItem("pgh-last-order-id")
      : null);

  const poll = useCallback(async () => {
    if (!resolvedId) return;
    const data = await fetchOrderStatus(payload.slug, resolvedId);
    if (data) {
      setOrder(data);
      // An instalment order stays 'pending_payment' until fully paid, so a
      // deposit is "confirmed" the moment a payment has landed on it. A full
      // order confirms on the paid/processing status as before.
      const depositLanded =
        data.payment_plan === "instalment" &&
        Number(data.amount_paid_ngn ?? 0) > 0;
      const paid =
        data.status === "paid" ||
        data.status === "processing" ||
        data.status === "confirmed" ||
        depositLanded;
      if (paid) {
        setPolling(false);
        // Meta Pixel: Purchase — the funnel's terminal conversion. Deduped on
        // the order id (persisted) so a refresh of this polling page can never
        // double-count the same sale. Value = what was actually billed now (the
        // deposit for an instalment order, the full total otherwise).
        fbTrackOnce(data.order_id, "Purchase", {
          content_type: "product",
          value: depositLanded
            ? Number(data.amount_paid_ngn) || 0
            : Number(data.total_ngn) || 0,
          currency: data.currency || "NGN",
          transaction_id: data.order_number,
        });
        // Clear the cart ONLY once the gateway has confirmed the payment. A
        // failed or cancelled payment must leave the buyer's items in the cart
        // so they can pay again — never empty a cart for an unpaid order.
        if (!clearedRef.current) {
          clearedRef.current = true;
          clearCart();
          if (typeof window !== "undefined") {
            sessionStorage.removeItem("pgh-last-order-id");
          }
        }
      }
    }
  }, [resolvedId, payload.slug, clearCart]);

  useEffect(() => {
    poll();
  }, [poll]);

  useEffect(() => {
    if (!polling || !resolvedId) return;
    const id = setInterval(poll, 4000);
    const timeout = setTimeout(() => setPolling(false), 60_000);
    return () => {
      clearInterval(id);
      clearTimeout(timeout);
    };
  }, [polling, resolvedId, poll]);

  const depositLanded =
    order?.payment_plan === "instalment" &&
    Number(order?.amount_paid_ngn ?? 0) > 0;
  const isPaid =
    order?.status === "paid" ||
    order?.status === "processing" ||
    order?.status === "confirmed" ||
    depositLanded;
  // An instalment order that has taken a payment but isn't settled yet: show a
  // "deposit received" framing rather than "paid in full".
  const isDeposit = depositLanded && order?.status !== "paid";

  // Payment not confirmed and polling has stopped (failed / cancelled / timed
  // out). The cart is still intact, so offer a one-tap path back to pay again.
  const notConfirmed = !isPaid && !polling;

  return (
    <main className="min-h-screen grid place-items-center px-6 py-16">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="glass rounded-[var(--radius)] p-8 md:p-10 max-w-lg w-full text-center space-y-6"
      >
        {isPaid ? (
          <div className="mx-auto w-16 h-16 rounded-full bg-[rgb(var(--success)/0.12)] grid place-items-center">
            <CheckCircle className="w-8 h-8 text-[rgb(var(--success))]" />
          </div>
        ) : (
          <div className="mx-auto w-16 h-16 rounded-full bg-[rgb(var(--accent)/0.12)] grid place-items-center">
            <Clock className="w-8 h-8 text-[rgb(var(--accent-glow))] animate-pulse" />
          </div>
        )}

        <h1 className="font-display text-[32px] md:text-[40px] leading-tight">
          {isPaid ? (
            <>
              Thank{" "}
              <em className="not-italic md:italic text-[rgb(var(--accent-glow))]">
                you.
              </em>
            </>
          ) : (
            <>
              Confirming your{" "}
              <em className="not-italic md:italic text-[rgb(var(--accent-glow))]">
                payment...
              </em>
            </>
          )}
        </h1>

        {isPaid ? (
          <p className="text-[rgb(var(--text-muted))]">
            {isDeposit
              ? "Your first payment is in and your order is reserved. Pay the rest anytime with the link below — it ships once fully paid."
              : "Your order is confirmed. A confirmation email is on its way."}
          </p>
        ) : (
          <p className="text-[rgb(var(--text-muted))]">
            We&apos;re verifying your payment with the gateway. This usually
            takes a few seconds.
          </p>
        )}

        {order && (
          <div className="glass rounded-xl p-5 text-left space-y-3">
            <div className="flex items-center gap-2 text-[13px]">
              <Package className="w-4 h-4 text-[rgb(var(--accent-glow))]" />
              <span className="font-semibold">Order details</span>
            </div>
            <div className="grid grid-cols-2 gap-y-2 text-[13px]">
              <span className="text-[rgb(var(--text-muted))]">
                Order number
              </span>
              <span className="font-mono font-semibold text-right">
                {order.order_number}
              </span>
              <span className="text-[rgb(var(--text-muted))]">Total</span>
              <span className="font-mono font-semibold text-right">
                {money(Number(order.total_ngn))}
              </span>
              <span className="text-[rgb(var(--text-muted))]">Status</span>
              <span className="text-right">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                    isPaid
                      ? "bg-[rgb(var(--success)/0.12)] text-[rgb(var(--success))]"
                      : "bg-[rgb(var(--warn)/0.12)] text-[rgb(var(--warn))]"
                  }`}
                >
                  {isDeposit ? "Part-paid" : isPaid ? "Paid" : "Processing"}
                </span>
              </span>
            </div>
          </div>
        )}

        {/* Flexi Pay balance — for an instalment order with a remaining
            balance, surface the permanent pay link so the buyer can save it and
            pay the rest anytime. */}
        {order?.payment_plan === "instalment" &&
          order.pay_token &&
          Number(order.balance_due_ngn ?? 0) > 0 && (
            <div className="glass rounded-xl p-5 text-left space-y-3">
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-[rgb(var(--text-muted))]">
                  Balance remaining
                </span>
                <span className="font-mono font-semibold">
                  {money(Number(order.balance_due_ngn ?? 0))}
                </span>
              </div>
              <Link
                href={`/pay/${order.pay_token}`}
                className="inline-flex items-center justify-center gap-2 w-full h-11 rounded-xl border border-[rgb(var(--accent)/0.4)] text-[rgb(var(--accent-glow))] font-semibold text-[14px]"
              >
                Pay your balance anytime <ArrowRight className="w-4 h-4" />
              </Link>
              <p className="text-[11px] text-[rgb(var(--text-faint))] text-center">
                Save this link — your order ships once it&apos;s fully paid.
              </p>
            </div>
          )}

        {!order && !resolvedId && (
          <p className="text-[rgb(var(--text-muted))] text-[14px]">
            Your order has been placed. Check your email for confirmation
            details.
          </p>
        )}

        <div className="pt-2 space-y-3">
          {notConfirmed && (
            <p className="text-[13px] text-[rgb(var(--warn))]">
              We couldn&apos;t confirm your payment. If you completed it, a
              confirmation email is on its way — otherwise your cart is saved,
              so you can try again.
            </p>
          )}
          {notConfirmed ? (
            <Link
              href={`/checkout/${payload.slug}`}
              className="inline-flex items-center justify-center gap-2 w-full h-12 rounded-xl bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))] font-semibold cta-sheen"
            >
              Return to checkout <ArrowRight className="w-4 h-4" />
            </Link>
          ) : (
            <Link
              href={`/sale/${payload.slug}`}
              className="inline-flex items-center justify-center gap-2 w-full h-12 rounded-xl bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))] font-semibold cta-sheen"
            >
              Continue shopping <ArrowRight className="w-4 h-4" />
            </Link>
          )}
          <p className="text-[11px] text-[rgb(var(--text-faint))]">
            Thank you for shopping with {brandName}
          </p>
        </div>
      </motion.div>
    </main>
  );
}
