"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { Gift, Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { useCart } from "@/lib/cart-store";
import { displayMoney } from "@/lib/format";
import { useDisplayCurrency } from "@/lib/currency";
import { postQuote, type CartQuote } from "@/lib/api-client";
import type { LandingPayload } from "@/lib/types";

const n = (v: string | number | undefined) => Number(v ?? 0) || 0;

export function CartDrawer({ payload }: { payload: LandingPayload }) {
  const router = useRouter();
  const open = useCart((s) => s.open);
  const close = useCart((s) => s.closeCart);
  const items = useCart((s) => s.items);
  const setQ = useCart((s) => s.setQuantity);
  const remove = useCart((s) => s.remove);
  const subtotal = useCart((s) => s.subtotalNgn());

  // Display currency (₦/$) — converted in React with the campaign's static rate
  // so the drawer is always internally consistent. `data-no-convert` (below)
  // keeps the live page's DOM currency observer from double-converting these.
  const fxRate = payload.ngn_per_usd_rate ?? null;
  const hasRate = typeof fxRate === "number" && fxRate > 0;
  const [currency] = useDisplayCurrency();
  const displayCurrency = hasRate ? currency : "NGN";
  const money = (ngn: number) => displayMoney(ngn, displayCurrency, fxRate);

  // Server-authoritative quote: the Hub applies EVERY deal rule (per-wig
  // position ladder, bundle stacking bonus, quantity-tier ladder, reseller/bulk
  // tiers) and clamps the stack at the margin floor. We never compute the
  // discount on the client — we just render what the Hub returns. The local
  // subtotal is used only as an instant optimistic figure while the quote
  // is in flight.
  const [quote, setQuote] = useState<CartQuote | null>(null);

  // Re-quote (debounced) whenever the cart contents change.
  const quoteKey = useMemo(
    () =>
      items
        .map((i) => `${i.id}:${i.quantity}:${i.unstyled ? "raw" : "styled"}`)
        .join("|"),
    [items],
  );
  useEffect(() => {
    if (items.length === 0) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const q = await postQuote({
        slug: payload.slug,
        cart: items.map((i) => ({
          bundle_id: i.bundle_id,
          product_id: i.product_id,
          styled_variant_id: i.styled_variant_id,
          unstyled: i.unstyled,
          quantity: i.quantity,
        })),
      });
      if (!cancelled) setQuote(q);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [quoteKey, items, payload.slug]);

  const totalDiscount = quote ? n(quote.total_discount_ngn) : 0;
  const finalTotal = quote ? n(quote.final_total_ngn) : subtotal;
  const comps = quote?.components;
  const dealRows: Array<{ label: string; amount: number }> = [];
  if (comps) {
    if (comps.position_ladder.applied)
      dealRows.push({
        label: "Multi-wig discount",
        amount: n(comps.position_ladder.discount_ngn),
      });
    if (comps.stacking_bonus.applied)
      dealRows.push({
        label: comps.stacking_bonus.label || "Bundle bonus",
        amount: n(comps.stacking_bonus.discount_ngn),
      });
    if (comps.quantity_tier.applied)
      dealRows.push({
        label: comps.quantity_tier.label || "Quantity discount",
        amount: n(comps.quantity_tier.discount_ngn),
      });
    if (comps.bulk_tier.applied)
      dealRows.push({
        label: comps.bulk_tier.label || "Reseller / bulk",
        amount: n(comps.bulk_tier.discount_ngn),
      });
  }

  // "Next rung" nudge — surface whichever unlock is closest to encourage one
  // more wig / bundle. Priority: stacking bonus, then position ladder.
  const nudge = (() => {
    const sb = comps?.stacking_bonus?.next as
      | { add_bundles?: number; unlock_discount_ngn?: string; label?: string }
      | null
      | undefined;
    if (sb && sb.add_bundles)
      return `Add ${sb.add_bundles} more bundle${sb.add_bundles !== 1 ? "s" : ""} to unlock ${money(n(sb.unlock_discount_ngn))} off`;
    const pl = comps?.position_ladder?.next as
      | { add_wigs?: number; extra_discount_ngn?: string }
      | null
      | undefined;
    if (pl && pl.add_wigs)
      return `Add ${pl.add_wigs} more wig${pl.add_wigs !== 1 ? "s" : ""} for an extra ${money(n(pl.extra_discount_ngn))} off`;
    const bt = comps?.bulk_tier?.next as
      | { add_raw_wigs?: number; per_item_ngn?: string }
      | null
      | undefined;
    if (bt && bt.add_raw_wigs)
      return `Add ${bt.add_raw_wigs} more raw wig${bt.add_raw_wigs !== 1 ? "s" : ""} to reach ${money(n(bt.per_item_ngn))}/wig off`;
    return null;
  })();

  // Wholesale raw wigs are a cart-wide minimum: a raw (unstyled) line only sells
  // at or above the lowest bulk tier, but that minimum is met by the COMBINED
  // raw-wig count across every style — so buyers mix products to reach it. We
  // block checkout (and the server re-checks) while raw wigs are present but the
  // combined count is still under the minimum.
  const bulkTiers = (payload.bulk_tiers || [])
    .filter((t) => t.min_qty > 0 && t.discount_per_item_ngn > 0)
    .sort((a, b) => a.min_qty - b.min_qty);
  const minBulkQty = bulkTiers[0]?.min_qty ?? 0;
  const rawQty = items
    .filter((i) => i.unstyled === true)
    .reduce((sum, i) => sum + i.quantity, 0);
  const rawBelowMin = minBulkQty > 0 && rawQty > 0 && rawQty < minBulkQty;
  const rawShortfall = rawBelowMin ? minBulkQty - rawQty : 0;
  const checkoutDisabled = items.length === 0 || rawBelowMin;

  useEffect(() => {
    if (!open) return;
    // Warm the checkout route the moment the drawer opens — Next prefetches the
    // route's JS chunk AND its server-rendered data (the campaign payload). By
    // the time the buyer taps "Checkout" the page is already in cache, so the
    // navigation is instant instead of paying for a cold server round-trip
    // (the old behaviour: click → server fetch campaign → render → "stays for a
    // while or never works" when the backend was cold).
    router.prefetch(`/checkout/${payload.slug}`);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close, router, payload.slug]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[3px]"
            onClick={close}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            role="dialog"
            aria-modal="true"
            data-no-convert
            className="fixed top-0 right-0 bottom-0 z-50 w-[min(440px,95vw)] dropglass border-l border-[rgb(var(--border-c)/0.12)] flex flex-col shadow-[-30px_0_80px_rgb(0_0_0/0.5)]"
          >
            <div className="flex items-center gap-3 px-5 py-4 border-b hairline">
              <h2 className="font-display text-[20px]">Your cart</h2>
              <button
                type="button"
                onClick={close}
                className="ml-auto grid place-items-center w-9 h-9 rounded-xl text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text))] hover:bg-[rgb(var(--text)/0.06)]"
                aria-label="Close cart"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {items.length === 0 && (
                <div className="text-center pt-10">
                  <span className="inline-grid place-items-center w-16 h-16 rounded-2xl bg-[rgb(var(--accent)/0.1)] text-[rgb(var(--accent-glow))] mb-3">
                    <ShoppingBag className="w-6 h-6" />
                  </span>
                  <h3 className="font-display text-[22px]">A quiet moment.</h3>
                  <p className="text-[rgb(var(--text-muted))] text-[13px] mt-1">
                    Drop a bundle in to begin.
                  </p>
                </div>
              )}
              {totalDiscount > 0 && (
                <div className="rounded-[14px] p-3.5 bg-[rgb(var(--success)/0.1)] border border-[rgb(var(--success)/0.3)] flex items-center gap-3">
                  <Gift className="w-5 h-5 text-[rgb(var(--success))] flex-shrink-0" />
                  <div>
                    <div className="text-[13px] font-semibold text-[rgb(var(--success))]">
                      You&apos;re saving {money(totalDiscount)}!
                    </div>
                    <div className="text-[11px] text-[rgb(var(--text-muted))] mt-0.5">
                      Every campaign discount has been applied.
                    </div>
                  </div>
                </div>
              )}
              {nudge && (
                <div className="rounded-[14px] p-3 bg-[rgb(var(--accent)/0.06)] border border-[rgb(var(--accent)/0.2)] text-[12px] text-[rgb(var(--text-muted))]">
                  {nudge}
                </div>
              )}
              {items.map((it) => (
                <div
                  key={it.id}
                  className="glass rounded-[14px] p-3 flex gap-3 items-center"
                >
                  <div className="relative w-14 h-14 rounded-[10px] overflow-hidden bg-[rgb(var(--panel-2))] flex-shrink-0">
                    {it.image_url ? (
                      <Image
                        src={it.image_url}
                        alt={it.name}
                        fill
                        sizes="56px"
                        className="object-cover"
                      />
                    ) : (
                      <div className="grid place-items-center w-full h-full text-[rgb(var(--text-faint))]">
                        <ShoppingBag className="w-5 h-5" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold truncate">
                      {it.name}
                    </div>
                    {it.preorder ? (
                      <div className="text-[10px] text-[rgb(var(--warn))] mt-0.5">
                        Out of stock · pre-order ships in{" "}
                        {it.preorder_lead_weeks ?? 3} wks
                      </div>
                    ) : (
                      it.delivery_weeks != null &&
                      it.delivery_weeks > 0 && (
                        <div className="text-[10px] text-[rgb(var(--text-faint))] mt-0.5">
                          Delivery in {it.delivery_weeks} wk
                          {it.delivery_weeks !== 1 ? "s" : ""}
                        </div>
                      )
                    )}
                    <div className="font-display tabular-nums text-[14px] mt-1">
                      {money(it.unit_price_ngn * it.quantity)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setQ(it.id, it.quantity - 1)}
                      className="grid place-items-center w-7 h-7 rounded-lg bg-[rgb(var(--text)/0.06)] hover:bg-[rgb(var(--text)/0.1)]"
                      aria-label="Decrease"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="font-mono tabular-nums w-5 text-center text-[13px]">
                      {it.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => setQ(it.id, it.quantity + 1)}
                      className="grid place-items-center w-7 h-7 rounded-lg bg-[rgb(var(--text)/0.06)] hover:bg-[rgb(var(--text)/0.1)]"
                      aria-label="Increase"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(it.id)}
                      className="ml-1 grid place-items-center w-7 h-7 rounded-lg text-[rgb(var(--text-faint))] hover:text-[rgb(var(--danger))]"
                      aria-label="Remove"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-5 border-t hairline space-y-3">
              <div className="flex justify-between text-[13px]">
                <span className="text-[rgb(var(--text-muted))]">Subtotal</span>
                <span className="font-mono tabular-nums">
                  {money(quote ? n(quote.subtotal_ngn) : subtotal)}
                </span>
              </div>
              {dealRows.map((row) => (
                <div
                  key={row.label}
                  className="flex justify-between text-[13px]"
                >
                  <span className="text-[rgb(var(--success))]">
                    {row.label}
                  </span>
                  <span className="font-mono tabular-nums text-[rgb(var(--success))]">
                    −{money(row.amount)}
                  </span>
                </div>
              ))}
              {totalDiscount > 0 && (
                <div className="flex justify-between text-[13px] pt-1 border-t hairline">
                  <span className="text-[rgb(var(--success))] font-semibold">
                    You save
                  </span>
                  <span className="font-mono tabular-nums text-[rgb(var(--success))] font-semibold">
                    −{money(totalDiscount)}
                  </span>
                </div>
              )}
              {rawBelowMin && (
                <div className="rounded-[14px] p-3 bg-[rgb(var(--warn)/0.1)] border border-[rgb(var(--warn)/0.3)] text-[12px] text-[rgb(var(--text-muted))]">
                  Raw (unstyled) wigs are wholesale — a minimum of {minBulkQty}{" "}
                  across any style. You have {rawQty}.{" "}
                  <span className="text-[rgb(var(--warn))] font-medium">
                    Add {rawShortfall} more raw wig
                    {rawShortfall !== 1 ? "s" : ""}
                  </span>{" "}
                  (any style counts) — or remove them — to check out.
                </div>
              )}
              <button
                type="button"
                disabled={checkoutDisabled}
                onClick={() => {
                  if (checkoutDisabled) return;
                  // Navigate first, then close. The old <Link onClick={close}>
                  // closed the drawer in the same click, and framer-motion's
                  // exit-unmount intermittently swallowed the navigation — the
                  // drawer just closed and nothing happened. Programmatic push
                  // is deterministic; closing after can't cancel it.
                  router.push(`/checkout/${payload.slug}`);
                  close();
                }}
                className={`w-full inline-flex items-center justify-center h-12 rounded-xl font-semibold cta-sheen disabled:cursor-not-allowed ${
                  checkoutDisabled
                    ? "bg-[rgb(var(--text)/0.06)] text-[rgb(var(--text-faint))]"
                    : "bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))]"
                }`}
              >
                {rawBelowMin
                  ? `Add ${rawShortfall} more raw wig${rawShortfall !== 1 ? "s" : ""} to continue`
                  : `Checkout · ${money(Math.max(0, finalTotal))}`}
              </button>
              <p className="text-[11px] text-[rgb(var(--text-faint))] text-center">
                DHL rates apply. Secure checkout — payment options shown at the
                next step.
              </p>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
