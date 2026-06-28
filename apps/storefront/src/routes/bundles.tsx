import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { getBundles, addCartItem, fmt } from "@/lib/storefront";
import { useCurrency, notifyCartChanged } from "@/lib/useStore";
import { Section, LoadingGrid, EmptyState, ErrorState } from "@/components/parts";

export const Route = createFileRoute("/bundles")({ component: BundlesPage });

function BundlesPage() {
  const [currency] = useCurrency();
  const [busy, setBusy] = useState<string | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["bundles"],
    queryFn: () => getBundles(),
  });
  const bundles = data ?? [];

  async function add(bundle_id: string) {
    setBusy(bundle_id);
    try {
      await addCartItem({ bundle_id, quantity: 1, display_currency: currency });
      notifyCartChanged();
      toast.success("Bundle added to bag");
    } catch {
      toast.error("Couldn't add bundle. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section>
      <h1 className="text-h2 font-display">Bundles</h1>
      <p className="mt-2 text-body text-muted-foreground">
        Curated sets, priced to save.
      </p>
      <div className="mt-10">
        {isLoading ? (
          <LoadingGrid />
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : bundles.length === 0 ? (
          <EmptyState title="No bundles available right now." />
        ) : (
          <div className="grid gap-6 md:grid-cols-3">
            {bundles.map((b) => (
              <div key={b.bundle_id} className="rounded-lg border border-border p-4">
                <div className="aspect-video overflow-hidden rounded bg-secondary">
                  {b.hero_image_url ? (
                    <img src={b.hero_image_url} alt={b.display_name} className="h-full w-full object-cover" />
                  ) : null}
                </div>
                <h3 className="mt-3 text-h6 font-display">{b.display_name}</h3>
                {b.description ? (
                  <p className="mt-1 text-body-sm text-muted-foreground">{b.description}</p>
                ) : null}
                {b.bundle_price_ngn ? (
                  <p className="mt-2 font-mono text-body">{fmt(b.bundle_price_ngn, "NGN")}</p>
                ) : null}
                <button
                  onClick={() => add(b.bundle_id)}
                  disabled={busy === b.bundle_id}
                  className="mt-4 w-full rounded-full bg-primary py-2.5 text-body-sm text-primary-foreground disabled:opacity-60"
                >
                  {busy === b.bundle_id ? "Adding..." : "Add bundle"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}
