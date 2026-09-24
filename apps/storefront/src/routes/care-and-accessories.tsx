import { useState } from "react";
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { getCareProducts, type CareOption } from "@/lib/storefront";
import { formatFromNgn } from "@/lib/money";
import { useCurrency } from "@/lib/useStore";
import { Section, LoadingGrid, ErrorState } from "@/components/parts";
import { useCareEnabled } from "@/components/care";

/**
 * Care & Accessories — the PXG retail catalogue index.
 *
 * This is the PARENT of /care-and-accessories/$slug, so like /services it
 * yields to the child route via <Outlet/> and only renders the grid on the
 * exact index path.
 *
 * Server rules honoured here: one row per ACTIVE, PRICED, PUBLISHED retail SKU
 * (a 50 ml and a 100 ml are two separate cards, because each is its own exact
 * SKU with its own stock); PXG-only and gated, so the whole section disappears
 * for FLH and for PXG until FEATURE_PXG_CARE_ACCESSORIES_ENABLED is on.
 */
export const Route = createFileRoute("/care-and-accessories")({
  head: () => ({
    meta: [
      { title: "Care & Accessories" },
      {
        name: "description",
        content: "Hair care, combs, brushes and accessories — stocked, ready to ship.",
      },
    ],
  }),
  component: CareIndex,
});

function CareIndex() {
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const onIndex =
    pathname === "/care-and-accessories" || pathname === "/care-and-accessories/";
  const enabled = useCareEnabled();
  const [currency] = useCurrency();
  const [term, setTerm] = useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    // Never fire the request for a brand where the section is gated off — it
    // would only 404 and paint an error state over a deliberate hide.
    queryKey: ["care-products", term.trim().toLowerCase()],
    queryFn: async () => {
      const qs = term.trim()
        ? `?q=${encodeURIComponent(term.trim())}&page_size=60`
        : "?page_size=60";
      return getCareProducts(qs);
    },
    enabled: enabled && onIndex,
  });

  if (!onIndex) return <Outlet />;

  // Gated off / wrong brand: render nothing rather than an empty catalogue.
  if (!enabled) {
    return (
      <Section>
        <p className="py-24 text-center text-muted-foreground">
          This section isn't available yet.
        </p>
      </Section>
    );
  }

  const items: CareOption[] = data ?? [];

  return (
    <main>
      <Section>
        <p className="text-[0.7rem] uppercase tracking-[0.4em] text-muted-foreground">
          Care &amp; Accessories
        </p>
        <h1 className="mt-4 font-display text-4xl md:text-6xl tracking-tight text-balance">
          Everything the hair needs after the hair.
        </h1>
        <p className="mt-5 max-w-2xl text-body text-muted-foreground">
          Oils, treatments, combs, brushes and accessories — real stock, held in
          our store, ready to go. Each size is its own product, so you always
          get exactly the bottle or tool you picked.
        </p>

        <div className="mt-8 flex max-w-md items-center gap-2 rounded-full border border-border bg-background px-4 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search by name, size or SKU…"
            aria-label="Search Care & Accessories"
            className="w-full bg-transparent text-body-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="mt-10">
          {isLoading ? (
            <LoadingGrid />
          ) : isError ? (
            <ErrorState onRetry={() => void refetch()} />
          ) : items.length === 0 ? (
            <p className="py-20 text-center text-muted-foreground">
              {term.trim()
                ? `Nothing matched “${term.trim()}”.`
                : "Nothing listed here yet — check back soon."}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-4">
              {items.map((it) => (
                <CareCard key={it.variant_id} item={it} currency={currency} />
              ))}
            </div>
          )}
        </div>
      </Section>
    </main>
  );
}

/**
 * One card per sellable SKU. Links to the product's canonical retail detail
 * page (/care-and-accessories/:slug) — never to /product/:slug, which stays
 * the wig route. The variant label is shown because two sizes of one product
 * are two cards, and a buyer must be able to tell them apart in the grid.
 */
function CareCard({ item, currency }: { item: CareOption; currency: string }) {
  const slug = item.slug || item.product_code || item.product_id;
  const soldOut = item.available <= 0;
  return (
    <Link
      to="/care-and-accessories/$slug"
      params={{ slug }}
      className="group flex flex-col"
    >
      <div className="relative aspect-square overflow-hidden rounded-md bg-secondary">
        {item.image_url ? (
          <img
            src={item.image_url}
            alt={item.name}
            loading="lazy"
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <span className="text-[0.65rem] uppercase tracking-[0.3em]">
              Care
            </span>
          </div>
        )}
        {soldOut ? (
          <span className="absolute left-2 top-2 rounded-full bg-background/90 px-2.5 py-1 text-[0.6rem] uppercase tracking-widest text-muted-foreground">
            Sold out
          </span>
        ) : null}
      </div>
      <h3 className="mt-3 text-body font-medium leading-snug group-hover:text-primary">
        {item.name}
      </h3>
      {item.variant_label ? (
        <p className="mt-0.5 text-body-sm text-muted-foreground">
          {item.variant_label}
        </p>
      ) : null}
      <p className="mt-1 font-mono text-body-sm">
        {formatFromNgn(Number(item.unit_price_ngn) || 0, currency)}
      </p>
    </Link>
  );
}
