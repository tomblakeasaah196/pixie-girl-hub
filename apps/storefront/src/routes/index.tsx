import { createFileRoute } from "@tanstack/react-router";
import { getWebRequest } from "@tanstack/react-start/server";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { brandFromHost, clientBrand } from "@/lib/brand";
import { formatMoney, type Currency } from "@/lib/currency";

/**
 * Home — SCAFFOLD placeholder.
 *
 * This is intentionally minimal: it proves the brand + Hub catalogue wiring is
 * live (SSR loader + client query), then the real Aura home (hero, shade grid,
 * editorial, bundles, etc.) gets PORTED in from the reference per PORTING.md.
 *
 * This is a WEBSITE page (the storefront root), NOT the Sales Campaign Landing.
 */

interface ProductCard {
  styled_id: string;
  name: string;
  slug: string;
  cover_image_url?: string;
  effective_price_ngn?: string | number;
  effective_price_usd?: string | number;
}

export const Route = createFileRoute("/")({
  loader: async () => {
    let brand = brandFromHost(null);
    let cookie: string | undefined;
    try {
      const req = getWebRequest();
      brand = brandFromHost(req?.headers.get("host"));
      cookie = req?.headers.get("cookie") ?? undefined;
    } catch {
      /* non-request context */
    }
    try {
      const products = await api.get<ProductCard[]>(
        "/api/public/storefront/products?page=1&page_size=8",
        { brand, cookie },
      );
      return { brand, products: products ?? [] };
    } catch {
      return { brand, products: [] as ProductCard[] };
    }
  },
  component: Home,
});

function Home() {
  const initial = Route.useLoaderData();

  // Re-fetch on the client (keeps SSR data, refreshes if stale).
  const { data, isError } = useQuery({
    queryKey: ["products", initial.brand, { page: 1, page_size: 8 }],
    queryFn: () =>
      api.get<ProductCard[]>("/api/public/storefront/products?page=1&page_size=8"),
    initialData: initial.products,
  });

  const products = data ?? [];
  const currency: Currency = "NGN"; // header toggle / geo wires this in Phase 1

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto max-w-6xl px-6 py-16">
        <p className="font-couture text-sm uppercase tracking-[0.3em] text-muted-foreground">
          {clientBrand() === "faitlynhair" ? "Faitlyn Hair" : "Pixie Girl Global"}
        </p>
        <h1 className="mt-3 font-display text-4xl md:text-6xl">
          Storefront scaffold
        </h1>
        <p className="mt-4 max-w-xl text-muted-foreground">
          Brand + theme resolve from the host; products load from the Hub. The
          full Aura home gets ported in from the reference (see PORTING.md). This
          is the storefront <strong>website</strong>, not the sales campaign
          landing.
        </p>

        {isError ? (
          <p className="mt-10 text-sm text-destructive">
            Couldn't load products — is the Hub API running on :7000?
          </p>
        ) : products.length === 0 ? (
          <p className="mt-10 text-sm text-muted-foreground">
            No products yet (empty catalogue or API offline).
          </p>
        ) : (
          <ul className="mt-10 grid grid-cols-2 gap-6 md:grid-cols-4">
            {products.map((p) => (
              <li key={p.styled_id} className="rounded-lg border border-border p-4">
                <div className="font-display text-lg">{p.name}</div>
                {p.effective_price_ngn != null ? (
                  <div className="mt-2 font-mono text-sm">
                    {formatMoney(p.effective_price_ngn, currency)}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
