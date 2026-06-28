import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { getBundleDetail, addCartItem, fmt } from "@/lib/storefront";
import { useCurrency, notifyCartChanged } from "@/lib/useStore";
import { Section, LoadingGrid, ErrorState } from "@/components/parts";

export const Route = createFileRoute("/bundles/$slug")({
  component: BundleDetail,
});

function BundleDetail() {
  const { slug } = Route.useParams();
  const [currency] = useCurrency();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["bundle", slug],
    queryFn: () => getBundleDetail(slug),
  });

  async function add() {
    if (!data) return;
    setBusy(true);
    try {
      await addCartItem({
        bundle_id: data.bundle_id,
        quantity: 1,
        display_currency: currency,
      });
      notifyCartChanged();
      toast.success("Bundle added to bag");
      navigate({ to: "/cart" });
    } catch {
      toast.error("Couldn't add bundle. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (isLoading)
    return (
      <Section>
        <LoadingGrid />
      </Section>
    );
  if (isError || !data)
    return (
      <Section>
        <ErrorState onRetry={() => refetch()} />
      </Section>
    );

  return (
    <Section className="grid gap-10 md:grid-cols-2">
      <div className="aspect-square overflow-hidden rounded-md bg-secondary">
        {data.hero_image_url ? (
          <img src={data.hero_image_url} alt={data.display_name} className="h-full w-full object-cover" />
        ) : null}
      </div>
      <div>
        <p className="text-caption">Bundle</p>
        <h1 className="mt-2 text-h3 font-display">{data.display_name}</h1>
        {data.bundle_price_ngn ? (
          <p className="mt-3 font-mono text-h5">{fmt(data.bundle_price_ngn, "NGN")}</p>
        ) : null}
        {data.description ? (
          <p className="mt-4 text-body text-muted-foreground">{data.description}</p>
        ) : null}

        {data.components?.length ? (
          <div className="mt-8">
            <p className="text-caption">What's included</p>
            <ul className="mt-3 divide-y divide-border">
              {data.components.map((c, i) => (
                <li key={i} className="flex items-center gap-3 py-3">
                  <div className="h-12 w-10 overflow-hidden rounded bg-secondary">
                    {c.image_url ? (
                      <img src={c.image_url} alt="" className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  <div className="flex-1 text-body-sm">{c.name}</div>
                  {c.quantity ? (
                    <span className="text-body-sm text-muted-foreground">×{c.quantity}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <button
          onClick={add}
          disabled={busy}
          className="mt-8 rounded-full bg-primary px-8 py-3 text-body text-primary-foreground disabled:opacity-60"
        >
          {busy ? "Adding…" : "Add bundle to bag"}
        </button>
      </div>
    </Section>
  );
}
