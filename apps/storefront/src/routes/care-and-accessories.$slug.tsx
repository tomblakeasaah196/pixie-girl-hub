import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check } from "lucide-react";
import {
  addCartItem,
  getCareProduct,
  priceFor,
  type CareDetail,
  type CareOption,
} from "@/lib/storefront";
import { useCurrency, notifyCartChanged } from "@/lib/useStore";
import { Section, ErrorState } from "@/components/parts";
import { useCareEnabled } from "@/components/care";

/**
 * Care & Accessories — canonical retail detail page (/care-and-accessories/:slug).
 *
 * Deliberately NOT /product/:slug: that route stays the wig (styled product)
 * page with its colour/size/lace selectors, reviews and size controls, all of
 * which are meaningless for a bottle of oil.
 *
 * The buyer picks ONE exact option and that option's `variant_id` is what goes
 * into the bag — the server resolves it through the typed retail resolver, so
 * a 50 ml can never silently sell as the product's default 100 ml.
 *
 * Retail is STOCK-ONLY by owner decision: there is no pre-order, backorder or
 * made-to-order path here, so a sold-out SKU simply cannot be added.
 */
export const Route = createFileRoute("/care-and-accessories/$slug")({
  component: CareDetailPage,
});

function CareDetailPage() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const [currency] = useCurrency();
  const enabled = useCareEnabled();
  const [busy, setBusy] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["care-product", slug],
    queryFn: () => getCareProduct(slug),
    enabled,
    // A gated/unpublished slug is a real 404, not a transient failure.
    retry: false,
  });

  const options: CareOption[] = data?.options ?? [];
  // Default to the flagged default option, else the first — but ALWAYS as an
  // explicit variant_id. Nothing is ever sent to the server without one.
  const [optionId, setOptionId] = useState<string | null>(null);
  const chosen: CareOption | null =
    options.find((o) => o.variant_id === optionId) ??
    options.find((o) => o.is_default_variant) ??
    options[0] ??
    null;
  const [qty, setQty] = useState(1);

  if (!enabled) {
    return (
      <Section>
        <p className="py-24 text-center text-muted-foreground">
          This page isn't available yet.
        </p>
      </Section>
    );
  }

  if (isLoading) {
    return (
      <Section>
        <div className="grid gap-10 md:grid-cols-2">
          <div className="aspect-square animate-pulse rounded-md bg-secondary" />
          <div className="space-y-4">
            <div className="h-8 w-2/3 animate-pulse rounded bg-secondary" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-secondary" />
            <div className="h-24 animate-pulse rounded bg-secondary" />
          </div>
        </div>
      </Section>
    );
  }

  if (isError || !data) {
    return (
      <Section>
        <ErrorState onRetry={() => void refetch()} />
      </Section>
    );
  }

  const soldOut = !chosen || chosen.available <= 0;

  async function addToBag() {
    if (!chosen) return;
    setBusy(true);
    try {
      // The exact chosen SKU. Never a product_id-only add: the server must
      // not have to guess a bottle size.
      await addCartItem({
        variant_id: chosen.variant_id,
        product_id: chosen.product_id,
        quantity: qty,
      });
      notifyCartChanged();
      toast.success("Added to bag");
      void navigate({ to: "/cart" });
    } catch (e) {
      // The server owns the real reason (out of stock, unpublished, unpriced).
      const msg = e instanceof Error && e.message ? e.message : "Couldn't add to bag.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <Section>
        <Link
          to="/care-and-accessories"
          className="text-body-sm text-muted-foreground hover:text-primary"
        >
          ← Care &amp; Accessories
        </Link>

        <div className="mt-6 grid gap-10 md:grid-cols-2">
          <div className="aspect-square overflow-hidden rounded-md bg-secondary">
            {data.image_url ? (
              <img
                src={data.image_url}
                alt={data.name}
                className="h-full w-full object-cover"
              />
            ) : null}
          </div>

          <div>
            <h1 className="font-display text-3xl md:text-5xl tracking-tight text-balance">
              {data.name}
            </h1>
            {chosen ? (
              <p className="mt-3 font-mono text-xl">
                {/* USD: the SKU's catalogue USD price — what checkout charges. */}
                {priceFor(
                  {
                    retail_price_ngn: chosen.unit_price_ngn,
                    retail_price_usd: chosen.unit_price_usd,
                  },
                  currency,
                )}
              </p>
            ) : null}
            {data.short_description ? (
              <p className="mt-4 text-body text-muted-foreground">
                {data.short_description}
              </p>
            ) : null}

            {/* Option selector — one button per exact SKU. This is the whole
                point of the typed retail model: 50 ml and 100 ml are separate
                sellable identities with their own price and stock. */}
            {options.length > 1 ? (
              <div className="mt-7">
                <p className="text-[0.7rem] uppercase tracking-[0.3em] text-muted-foreground">
                  Size
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {options.map((o) => {
                    const active = chosen?.variant_id === o.variant_id;
                    const gone = o.available <= 0;
                    return (
                      <button
                        key={o.variant_id}
                        type="button"
                        onClick={() => {
                          setOptionId(o.variant_id);
                          setQty(1);
                        }}
                        aria-pressed={active}
                        className={`rounded-full border px-4 py-2 text-body-sm transition ${
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border hover:bg-secondary"
                        } ${gone ? "opacity-50 line-through" : ""}`}
                      >
                        {o.variant_label || o.sku}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {chosen ? (
              <p className="mt-4 text-body-sm text-muted-foreground">
                {soldOut
                  ? "Sold out — this size isn't in stock right now."
                  : `${chosen.available} in stock${chosen.sku ? ` · ${chosen.sku}` : ""}`}
              </p>
            ) : null}

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <div className="flex items-center rounded-full border border-border">
                <button
                  type="button"
                  aria-label="Decrease quantity"
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  className="px-4 py-2 text-body hover:text-primary"
                >
                  −
                </button>
                <span className="min-w-8 text-center font-mono text-body-sm">{qty}</span>
                <button
                  type="button"
                  aria-label="Increase quantity"
                  // Stock-only: never let the stepper exceed what is actually on
                  // the shelf. The server re-checks this anyway.
                  onClick={() =>
                    setQty((q) => Math.min(chosen?.available || 1, q + 1))
                  }
                  className="px-4 py-2 text-body hover:text-primary"
                >
                  +
                </button>
              </div>
              <button
                type="button"
                onClick={() => void addToBag()}
                disabled={busy || soldOut || !chosen}
                className="flex-1 rounded-full bg-primary px-8 py-3 text-body-sm font-medium uppercase tracking-widest text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
              >
                {busy ? "Adding…" : soldOut ? "Sold out" : "Add to bag"}
              </button>
            </div>

            {data.taxable && data.vat_rate ? (
              <p className="mt-3 text-body-sm text-muted-foreground">
                Plus {Math.round(Number(data.vat_rate) * 1000) / 10}% VAT, added at checkout.
              </p>
            ) : null}

            {data.long_description ? (
              <p className="mt-8 whitespace-pre-line text-body text-muted-foreground">
                {data.long_description}
              </p>
            ) : null}

            {/* Approved label copy. These are authored in Care & Accessories and
                are plain text — no marketing claims are generated here. */}
            <Spec label="Ingredients" body={data.ingredients} />
            <Spec label="Directions" body={data.directions} />
            <Spec label="Warnings" body={data.warnings} />
          </div>
        </div>
      </Section>
    </main>
  );
}

function Spec({ label, body }: { label: string; body?: string | null }) {
  if (!body) return null;
  return (
    <div className="mt-6 border-t border-border pt-5">
      <p className="flex items-center gap-2 text-[0.7rem] uppercase tracking-[0.3em] text-muted-foreground">
        <Check className="h-3 w-3" />
        {label}
      </p>
      <p className="mt-2 whitespace-pre-line text-body-sm text-muted-foreground">
        {body}
      </p>
    </div>
  );
}
