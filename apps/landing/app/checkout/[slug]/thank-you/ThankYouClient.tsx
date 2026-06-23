"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { CheckCircle, Clock, Package, ArrowRight } from "lucide-react";
import { useCart } from "@/lib/cart-store";
import { fetchOrderStatus } from "@/lib/api-client";
import { money } from "@/lib/format";
import type { LandingPayload } from "@/lib/types";

type OrderInfo = {
  order_id: string;
  order_number: string;
  status: string;
  total_ngn: string;
  currency: string;
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
      const paid =
        data.status === "paid" ||
        data.status === "processing" ||
        data.status === "confirmed";
      if (paid) {
        setPolling(false);
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

  const isPaid =
    order?.status === "paid" ||
    order?.status === "processing" ||
    order?.status === "confirmed";

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
            Your order is confirmed. A confirmation email is on its way.
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
                  {isPaid ? "Paid" : "Processing"}
                </span>
              </span>
            </div>
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
              We couldn&apos;t confirm your payment. If you completed it,
              a confirmation email is on its way — otherwise your cart is
              saved, so you can try again.
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
