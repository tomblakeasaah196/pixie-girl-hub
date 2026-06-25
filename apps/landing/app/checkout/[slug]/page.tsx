import { notFound } from "next/navigation";
import { fetchCampaign, fetchPublishedLanding } from "@/lib/api";
import { getBrand } from "@/lib/brand";
import { withDefaults, type LandingConfig } from "@landing-kit";
import { BrandThemeProvider } from "@/components/BrandThemeProvider";
import { CheckoutClient } from "@/components/checkout/CheckoutClient";
import type { LandingPayload } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Load the campaign, distinguishing the THREE outcomes that matter:
 *   - ok          → the real payload
 *   - notfound    → a clean 404 (the campaign truly doesn't exist)
 *   - unreachable → the Hub threw / timed out (a 5xx blip under live-sale load)
 *
 * We retry once to ride out a brief blip. The crucial part: an UNREACHABLE Hub
 * must NOT block checkout. The cart is entirely client-side and the form
 * re-quotes and submits straight from the browser, so checkout needs almost
 * nothing from this fetch (just the slug — which is in the URL — and the brand,
 * which we resolve from the host). Dead-ending a paying customer on an error
 * page because the backend hiccupped for a second is the actual bug here, and a
 * thrown fetch used to do exactly that: it aborted the client navigation with
 * no boundary, so the cart drawer just closed and nothing happened.
 */
async function loadCampaign(
  slug: string,
): Promise<
  | { status: "ok"; payload: LandingPayload }
  | { status: "notfound" }
  | { status: "unreachable" }
> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const payload = await fetchCampaign(slug);
      return payload ? { status: "ok", payload } : { status: "notfound" };
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 350));
    }
  }
  return { status: "unreachable" };
}

export default async function CheckoutPage({
  params,
}: {
  params: { slug: string };
}) {
  const brand = getBrand();
  const [result, raw] = await Promise.all([
    loadCampaign(params.slug),
    fetchPublishedLanding(brand).catch(() => null),
  ]);

  // A genuinely missing campaign is a real 404 — let the not-found boundary show.
  if (result.status === "notfound") notFound();

  const brandConfig = withDefaults(brand, raw as Partial<LandingConfig> | null);

  // Hub unreachable → degrade, don't dead-end. Build the minimum the checkout
  // form needs from what we already have. The client will re-quote and charge
  // itself once the Hub answers again; until then the buyer can still fill in
  // their details instead of being bounced back to the sale page.
  const payload: LandingPayload =
    result.status === "ok"
      ? result.payload
      : ({
          slug: params.slug,
          name: "Checkout",
          state: "live",
          starts_at: "",
          ends_at: "",
          hero: {},
          countdown_to: null,
          signup_for_notifications: false,
          blocks: [],
          products: [],
          seo: {},
          brand: { business_key: brand, display_name: brand },
          ngn_per_usd_rate: null,
        } as LandingPayload);

  return (
    <BrandThemeProvider brandConfig={brandConfig}>
      <CheckoutClient
        payload={payload}
        degraded={result.status === "unreachable"}
      />
    </BrandThemeProvider>
  );
}
