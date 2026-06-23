/**
 * Public sales-campaign landing page — /sale/:slug (no auth).
 *
 * Served at the sales subdomain (Host → brand) or, when previewed from the
 * admin, with an explicit ?brand= hint. Renders the same LandingRender the
 * Studio previews, so the admin sees exactly what the customer will.
 *
 * Checkout is handled inline: "Buy now" on any product card adds the item to
 * a local cart and opens the checkout sheet. The sheet posts to the public
 * checkout endpoint (POST /api/public/sale/:slug/checkout) and redirects to
 * the payment gateway URL on success.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Loader2, ShoppingBag, X } from "lucide-react";
import {
  type LandingBlock,
  usePublicLanding,
  usePublicLandingConfig,
  usePublicCheckout,
  type PublicCheckoutResult,
} from "@/lib/campaigns";
import type { LandingProduct } from "../landing/LandingRender";
import { withDefaults } from "@landing-kit";
import {
  LandingRender,
  type LandingModel,
} from "../landing/LandingRender";

// ── Types ──────────────────────────────────────────────────

interface CartItem {
  product: LandingProduct;
  qty: number;
}

// ── Helpers ────────────────────────────────────────────────

function genIdemKey(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function galleryFromBlocks(blocks: LandingBlock[]): string[] {
  const lb = (blocks || []).find(
    (b) => (b.key || b.type) === "lookbook_carousel",
  );
  const imgs = lb?.props?.images;
  return Array.isArray(imgs) ? (imgs as string[]) : [];
}

// ── Checkout sheet ─────────────────────────────────────────

function CheckoutSheet({
  slug,
  brand,
  cart,
  onClose,
}: {
  slug: string;
  brand?: string;
  cart: CartItem[];
  onClose: () => void;
}) {
  const checkout = usePublicCheckout(slug, brand);
  // Stable key for this checkout session; regenerated when the sheet unmounts.
  const idemKey = useRef(genIdemKey());
  const [confirmed, setConfirmed] = useState<PublicCheckoutResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [f, setF] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    line1: "",
    city: "",
    state: "",
    terms: false,
    whatsapp_opt_in: false,
  });

  // Redirect to payment gateway as soon as we receive a URL.
  useEffect(() => {
    if (confirmed?.payment_url) {
      window.location.href = confirmed.payment_url;
    }
  }, [confirmed]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!f.terms) {
      setFormError("Please accept the Terms & Conditions to proceed.");
      return;
    }
    try {
      const result = await checkout.mutateAsync({
        contact: {
          first_name: f.first_name.trim(),
          last_name: f.last_name.trim() || undefined,
          email: f.email.trim(),
          phone: f.phone.trim(),
          address: {
            line1: f.line1.trim(),
            city: f.city.trim(),
            state: f.state.trim() || undefined,
            country: "Nigeria",
          },
          consent: {
            terms_accepted: true,
            whatsapp_opt_in: f.whatsapp_opt_in,
          },
        },
        cart: cart
          .filter((i) => i.product.product_id)
          .map((i) => ({
            product_id: i.product.product_id as string,
            quantity: i.qty,
          })),
        client_idempotency_key: idemKey.current,
      });
      setConfirmed(result);
    } catch (err) {
      const msg =
        (err as { message?: string })?.message ||
        "Checkout failed — please check your details and try again.";
      setFormError(msg);
    }
  }

  const inp =
    "w-full h-11 px-4 rounded-[10px] bg-panel/40 border border-line outline-none focus:border-accent/60 text-[14px] text-text-primary placeholder:text-text-faint";

  // ── Redirecting to payment ─────────────────────────────
  if (confirmed?.payment_url) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        <div className="relative bg-[rgb(var(--bg,18_10_10))] border border-[rgb(var(--line,255_255_255)/0.12)] rounded-[24px] p-8 max-w-[420px] w-full mx-4 text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 opacity-60" />
          <h2 className="font-display text-[22px]">Redirecting to payment…</h2>
          <p className="text-text-muted text-[13.5px] mt-2">
            Order ref:{" "}
            <span className="font-mono">
              {confirmed.order_id.slice(0, 8).toUpperCase()}
            </span>
          </p>
          <a
            href={confirmed.payment_url}
            className="mt-4 inline-block text-[13px] text-accent-glow underline"
          >
            Click here if you are not redirected
          </a>
        </div>
      </div>
    );
  }

  // ── Order confirmed (bank transfer / preorder — no payment URL) ──
  if (confirmed) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        />
        <div className="relative bg-[rgb(var(--bg,18_10_10))] border border-[rgb(var(--line,255_255_255)/0.12)] rounded-[24px] p-8 max-w-[420px] w-full mx-4 text-center">
          <div className="w-14 h-14 rounded-full bg-accent/15 flex items-center justify-center mx-auto mb-5">
            <ShoppingBag className="w-7 h-7 text-accent-glow" />
          </div>
          <h2 className="font-display text-[26px]">Order placed!</h2>
          <p className="text-text-muted text-[13.5px] mt-2 leading-relaxed">
            Your order{" "}
            <span className="font-mono text-text-primary">
              #{confirmed.order_id.slice(0, 8).toUpperCase()}
            </span>{" "}
            has been received. We will be in touch with the next steps.
          </p>
          {confirmed.preorder && (
            <p className="text-text-muted text-[12.5px] mt-3">
              This is a pre-order — production lead time applies.
            </p>
          )}
          <button
            onClick={onClose}
            className="mt-6 h-[48px] px-7 rounded-full bg-accent text-[#F4E9D9] font-semibold"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  // ── Checkout form ──────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-[rgb(var(--bg,18_10_10))] border border-[rgb(var(--line,255_255_255)/0.12)] rounded-t-[24px] sm:rounded-[24px] w-full sm:max-w-[520px] max-h-[90vh] overflow-y-auto p-6 md:p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-[22px]">Complete your order</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/10 transition"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Cart summary */}
        <div className="mb-6 rounded-[14px] bg-panel/30 border border-line/60 divide-y divide-line/40">
          {cart.map((item, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 px-4 py-3 text-[13.5px]"
            >
              <span className="truncate">
                {item.product.name || "Product"} × {item.qty}
              </span>
              {item.product.regular_price_ngn && (
                <span className="font-mono shrink-0 text-text-muted">
                  ₦
                  {(
                    Number(item.product.regular_price_ngn) * item.qty
                  ).toLocaleString()}
                </span>
              )}
            </div>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11.5px] text-text-muted mb-1.5 font-medium">
                First name *
              </label>
              <input
                required
                className={inp}
                value={f.first_name}
                onChange={(e) =>
                  setF((x) => ({ ...x, first_name: e.target.value }))
                }
              />
            </div>
            <div>
              <label className="block text-[11.5px] text-text-muted mb-1.5 font-medium">
                Last name
              </label>
              <input
                className={inp}
                value={f.last_name}
                onChange={(e) =>
                  setF((x) => ({ ...x, last_name: e.target.value }))
                }
              />
            </div>
          </div>

          <div>
            <label className="block text-[11.5px] text-text-muted mb-1.5 font-medium">
              Email address *
            </label>
            <input
              type="email"
              required
              className={inp}
              value={f.email}
              onChange={(e) => setF((x) => ({ ...x, email: e.target.value }))}
            />
          </div>

          <div>
            <label className="block text-[11.5px] text-text-muted mb-1.5 font-medium">
              Phone number *
            </label>
            <input
              type="tel"
              required
              minLength={7}
              className={inp}
              placeholder="e.g. 08012345678"
              value={f.phone}
              onChange={(e) => setF((x) => ({ ...x, phone: e.target.value }))}
            />
          </div>

          <div>
            <label className="block text-[11.5px] text-text-muted mb-1.5 font-medium">
              Delivery address *
            </label>
            <input
              required
              className={inp}
              placeholder="Street address"
              value={f.line1}
              onChange={(e) =>
                setF((x) => ({ ...x, line1: e.target.value }))
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11.5px] text-text-muted mb-1.5 font-medium">
                City *
              </label>
              <input
                required
                className={inp}
                placeholder="Lagos"
                value={f.city}
                onChange={(e) =>
                  setF((x) => ({ ...x, city: e.target.value }))
                }
              />
            </div>
            <div>
              <label className="block text-[11.5px] text-text-muted mb-1.5 font-medium">
                State
              </label>
              <input
                className={inp}
                placeholder="Lagos State"
                value={f.state}
                onChange={(e) =>
                  setF((x) => ({ ...x, state: e.target.value }))
                }
              />
            </div>
          </div>

          <div className="space-y-2.5 pt-1">
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                className="mt-0.5 shrink-0 accent-[rgb(var(--accent,105_9_9))]"
                checked={f.whatsapp_opt_in}
                onChange={(e) =>
                  setF((x) => ({ ...x, whatsapp_opt_in: e.target.checked }))
                }
              />
              <span className="text-[12.5px] text-text-muted leading-snug">
                Send me order updates on WhatsApp
              </span>
            </label>
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                className="mt-0.5 shrink-0 accent-[rgb(var(--accent,105_9_9))]"
                checked={f.terms}
                onChange={(e) =>
                  setF((x) => ({ ...x, terms: e.target.checked }))
                }
              />
              <span className="text-[12.5px] text-text-muted leading-snug">
                I accept the Terms &amp; Conditions. Prices shown are in NGN
                and exclude delivery fees. *
              </span>
            </label>
          </div>

          {formError && (
            <div className="text-[13px] text-red-400 bg-red-500/10 rounded-[10px] p-3">
              {formError}
            </div>
          )}

          <button
            type="submit"
            disabled={checkout.isPending}
            className="w-full h-[52px] rounded-full bg-accent text-[#F4E9D9] font-semibold text-[15px] tracking-wide hover:brightness-110 transition shadow-[0_12px_40px_rgb(var(--accent)/0.45)] disabled:opacity-60 disabled:cursor-not-allowed mt-2"
          >
            {checkout.isPending ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing…
              </span>
            ) : (
              "Pay now"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────

export function SaleLandingPublic() {
  const { slug } = useParams<{ slug: string }>();
  const [params] = useSearchParams();
  const brand = params.get("brand") || undefined;
  const q = usePublicLanding(slug, brand);

  // Resolve brand so the page renders in the brand's palette.
  const brandKey = brand || q.data?.brand?.business_key;
  const cfgQ = usePublicLandingConfig(brandKey);
  const brandConfig = useMemo(
    () => (brandKey ? withDefaults(brandKey, cfgQ.data ?? null) : null),
    [brandKey, cfgQ.data],
  );

  const [cart, setCart] = useState<CartItem[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const handleAddToCart = useCallback(
    (product: LandingProduct, qty: number) => {
      setCart((prev) => {
        const idx = prev.findIndex(
          (i) => i.product.product_id === product.product_id,
        );
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], qty: next[idx].qty + qty };
          return next;
        }
        return [...prev, { product, qty }];
      });
      setCheckoutOpen(true);
    },
    [],
  );

  const model: LandingModel | null = useMemo(() => {
    if (!q.data) return null;
    const d = q.data;
    return {
      slug: d.slug,
      name: d.name,
      state: d.state,
      hero: d.hero,
      countdown_to: d.countdown_to,
      countdown_message: d.countdown_message,
      signup_for_notifications: d.signup_for_notifications,
      ngn_per_usd_rate: d.ngn_per_usd_rate ?? null,
      discount_type: d.discount_type ?? null,
      discount_value: d.discount_value ?? null,
      position_ladder: d.position_ladder ?? null,
      blocks: d.blocks,
      products: (d.products || []) as LandingProduct[],
      ended: d.ended,
      gallery: galleryFromBlocks(d.blocks),
    };
  }, [q.data]);

  const totalQty = cart.reduce((s, i) => s + i.qty, 0);

  if (q.isLoading) {
    return (
      <div className="min-h-screen bg-bg grid place-items-center text-text-muted">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (q.isError || !model) {
    return (
      <div className="min-h-screen bg-bg grid place-items-center px-6 text-center">
        <div className="max-w-[460px]">
          <div className="text-[11px] tracking-[0.3em] uppercase text-accent-glow/90 font-semibold mb-4">
            Between drops
          </div>
          <h1 className="font-display text-[32px] md:text-[40px] leading-tight mb-4">
            This chapter is being prepared
          </h1>
          <p className="text-text-muted leading-relaxed">
            The page you're looking for isn't open right now. Follow us, or
            join the list, to be the first to know the moment it opens.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <LandingRender
        model={model}
        brandConfig={brandConfig}
        scrollable={false}
        className="min-h-screen"
        onAddToCart={model.state === "live" ? handleAddToCart : undefined}
      />

      {/* Floating cart button — visible when sale is live and cart has items */}
      {model.state === "live" && totalQty > 0 && (
        <button
          onClick={() => setCheckoutOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 h-[52px] pl-4 pr-5 rounded-full bg-accent text-[#F4E9D9] font-semibold text-[14px] shadow-[0_12px_40px_rgb(var(--accent)/0.55)] hover:brightness-110 transition"
        >
          <ShoppingBag className="w-5 h-5" />
          {totalQty} {totalQty === 1 ? "item" : "items"} — Checkout
        </button>
      )}

      {/* Checkout sheet */}
      {checkoutOpen && slug && cart.length > 0 && (
        <CheckoutSheet
          slug={slug}
          brand={brand}
          cart={cart}
          onClose={() => setCheckoutOpen(false)}
        />
      )}
    </>
  );
}
