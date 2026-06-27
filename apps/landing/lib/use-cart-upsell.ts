"use client";

import { useEffect, useState } from "react";
import { useCart } from "@/lib/cart-store";
import type { CartUpsellRung, LandingPayload } from "@/lib/types";

/**
 * Escalating cart upsell — rung selection only (the rendering lives in the
 * CartDrawer as a NON-blocking banner).
 *
 * This used to be a full-screen modal (z-60) layered over the open cart drawer.
 * On mobile its backdrop sat right over the Checkout CTA, so a bundle (whose
 * high value crosses the cart-value trigger that a single product doesn't)
 * popped the modal and the buyer's "Checkout" tap landed on it instead —
 * closing the cart and bouncing back to the page. The fix is to surface the
 * same offer inside the drawer where it can never intercept the CTA.
 *
 * Rules (unchanged): one rung at a time, the next-best the cart hasn't been
 * offered, dismissable per cart-open, never shown twice in a session.
 */
export function useCartUpsell(payload: LandingPayload) {
  const upsells: CartUpsellRung[] = payload.upsells || [];
  const cartOpen = useCart((s) => s.open);
  const items = useCart((s) => s.items);
  const subtotal = useCart((s) => s.subtotalNgn());
  const totalQty = useCart((s) => s.totalQty());
  const shown = useCart((s) => s.shown_upsell_ids);
  const markShown = useCart((s) => s.markUpsellShown);
  const closeCart = useCart((s) => s.closeCart);

  const [rung, setRung] = useState<CartUpsellRung | null>(null);

  useEffect(() => {
    if (!cartOpen || upsells.length === 0 || items.length === 0) {
      setRung(null);
      return;
    }
    const next =
      upsells
        .slice()
        .sort((a, b) => a.rung - b.rung)
        .find((u) => {
          if (shown.includes(u.upsell_id)) return false;
          if (u.trigger_type === "cart_qty" && u.min_cart_qty != null) {
            return totalQty >= u.min_cart_qty;
          }
          if (u.trigger_type === "cart_value" && u.min_cart_value_ngn != null) {
            return subtotal >= u.min_cart_value_ngn;
          }
          if (u.trigger_type === "specific_bundle" && u.trigger_bundle_id) {
            return items.some((i) => i.bundle_id === u.trigger_bundle_id);
          }
          return false;
        }) ?? null;
    // Small delay so it eases in after the drawer, not on the same frame.
    const t = setTimeout(() => setRung(next), 450);
    return () => clearTimeout(t);
  }, [cartOpen, items, totalQty, subtotal, shown, upsells]);

  function dismiss() {
    if (rung) markShown(rung.upsell_id);
    setRung(null);
  }

  function accept() {
    if (!rung) return;
    markShown(rung.upsell_id);
    setRung(null);
    closeCart();
    // Guide the buyer to where they can add the next item.
    setTimeout(() => {
      const target =
        document.querySelector('[data-block="bundle_showcase"]') ||
        document.querySelector('[data-block="featured_products"]');
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      const ring = [
        "ring-2",
        "ring-[rgb(var(--accent-glow))]",
        "ring-offset-4",
        "rounded-2xl",
      ];
      target.classList.add(...ring);
      setTimeout(() => target.classList.remove(...ring), 2500);
    }, 300);
  }

  return { rung, dismiss, accept };
}
