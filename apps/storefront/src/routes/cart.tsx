import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import {
  getCart,
  quoteCart,
  updateCartItem,
  removeCartItem,
  type Cart,
  type Quote,
} from "@/lib/storefront";
import { formatFromNgn, settlementFor } from "@/lib/money";
import { useCurrency, notifyCartChanged } from "@/lib/useStore";
import { usePageSlots, withSlots } from "@/lib/site-config";
import { Section, EmptyState, ErrorState } from "@/components/parts";
import { preorderText } from "@/components/availability";

export const Route = createFileRoute("/cart")({ component: CartPage });

function CartPage() {
  const [currency] = useCurrency();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const s = withSlots(
    {
      heading: "Your bag",
      loading: "Loading your bag...",
      emptyTitle: "Your bag is empty.",
      emptyCta: "Start shopping",
      summaryTitle: "Summary",
      subtotalLabel: "Subtotal",
      discountLabel: "Discount",
      deliveryLabel: "Delivery",
      deliveryValue: "calculated at checkout",
      totalLabel: "Total",
      checkoutCta: "Checkout",
      // {currency} is replaced with the settlement currency at render.
      chargedNote: "Charged in {currency}",
    },
    usePageSlots("cart"),
  );

  const cartQ = useQuery<Cart>({
    queryKey: ["cart"],
    queryFn: () => getCart(),
  });
  const quoteQ = useQuery<Quote>({
    queryKey: ["cart-quote", currency, cartQ.data?.items?.length],
    queryFn: () => quoteCart({ display_currency: currency }),
    enabled: !!cartQ.data && (cartQ.data.items?.length ?? 0) > 0,
  });

  const items = cartQ.data?.items ?? [];
  const num = (v: string | number | null | undefined) => Number(v ?? 0) || 0;

  async function mutate(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      notifyCartChanged();
      await Promise.all([cartQ.refetch(), quoteQ.refetch()]);
    } finally {
      setBusy(false);
    }
  }

  if (cartQ.isLoading)
    return (
      <Section>
        <p className="text-body text-muted-foreground">{s.loading}</p>
      </Section>
    );
  if (cartQ.isError)
    return (
      <Section>
        <ErrorState onRetry={() => cartQ.refetch()} />
      </Section>
    );
  if (items.length === 0)
    return (
      <Section>
        <h1 className="text-h3 font-display">{s.heading}</h1>
        <EmptyState
          title={s.emptyTitle}
          cta={
            <Link to="/shop" className="rounded-full bg-primary px-6 py-2.5 text-body-sm text-primary-foreground">
              {s.emptyCta}
            </Link>
          }
        />
      </Section>
    );

  const q = quoteQ.data;
  const total = q ? formatFromNgn(num(q.total_ngn), currency) : null;

  return (
    <Section className="grid gap-10 md:grid-cols-[1fr_360px]">
      <div>
        <h1 className="text-h3 font-display">{s.heading}</h1>
        <ul className="mt-6 divide-y divide-border">
          {items.map((it) => (
            <li key={it.cart_item_id} className="flex gap-4 py-4">
              <div className="h-20 w-16 overflow-hidden rounded bg-secondary">
                {it.thumbnail_url_snapshot ? (
                  <img src={it.thumbnail_url_snapshot} alt="" className="h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="flex-1">
                <p className="text-body font-display">{it.product_name_snapshot}</p>
                {it.variant_label_snapshot ? (
                  <p className="text-body-sm text-muted-foreground">{it.variant_label_snapshot}</p>
                ) : null}
                {/* Per-line pre-order / sold-out tag (000086); nothing in-stock. */}
                {preorderText(it.availability) ? (
                  <span className="mt-1 inline-block rounded-full border border-taupe/40 px-2 py-0.5 text-[0.55rem] font-medium uppercase tracking-[0.2em] text-taupe">
                    {preorderText(it.availability)}
                  </span>
                ) : null}
                <div className="mt-2 flex items-center gap-2">
                  <button
                    disabled={busy}
                    onClick={() => mutate(() => updateCartItem(it.cart_item_id, Math.max(1, it.quantity - 1)))}
                    className="h-7 w-7 rounded border border-border"
                  >
                    -
                  </button>
                  <span className="w-8 text-center text-body-sm">{it.quantity}</span>
                  <button
                    disabled={busy}
                    onClick={() => mutate(() => updateCartItem(it.cart_item_id, it.quantity + 1))}
                    className="h-7 w-7 rounded border border-border"
                  >
                    +
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => mutate(() => removeCartItem(it.cart_item_id))}
                    className="ml-3 text-muted-foreground hover:text-destructive"
                    aria-label="Remove"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              <div className="font-mono text-body-sm">
                {formatFromNgn(num(it.unit_price_ngn), currency)}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Summary */}
      <aside className="h-fit rounded-lg border border-border p-6">
        <h2 className="text-h6 font-display">{s.summaryTitle}</h2>
        <dl className="mt-4 space-y-2 text-body-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{s.subtotalLabel}</dt>
            <dd className="font-mono">
              {q ? formatFromNgn(num(q.subtotal_ngn), currency) : "..."}
            </dd>
          </div>
          {q && Number(q.discount_ngn || 0) > 0 ? (
            <div className="flex justify-between text-rose">
              <dt>{s.discountLabel}</dt>
              <dd className="font-mono">
                −{formatFromNgn(num(q.discount_ngn), currency)}
              </dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{s.deliveryLabel}</dt>
            <dd className="font-mono">{s.deliveryValue}</dd>
          </div>
          <div className="flex justify-between border-t border-border pt-2 text-body">
            <dt>{s.totalLabel}</dt>
            <dd className="font-mono">{total ?? "-"}</dd>
          </div>
        </dl>
        <button
          onClick={() => navigate({ to: "/checkout" })}
          className="mt-6 w-full rounded-full bg-primary py-3 text-body text-primary-foreground"
        >
          {s.checkoutCta}
        </button>
        <p className="mt-3 text-center text-body-sm text-muted-foreground">
          {s.chargedNote.replace("{currency}", settlementFor(currency))}
        </p>
      </aside>
    </Section>
  );
}
