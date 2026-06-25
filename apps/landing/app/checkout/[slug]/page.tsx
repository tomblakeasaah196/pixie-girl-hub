import { notFound } from "next/navigation";
import { fetchCampaign, fetchPublishedLanding } from "@/lib/api";
import { getBrand } from "@/lib/brand";
import { withDefaults, type LandingConfig } from "@landing-kit";
import { BrandThemeProvider } from "@/components/BrandThemeProvider";
import { CheckoutClient } from "@/components/checkout/CheckoutClient";

/**
 * Load the campaign with ONE transient retry. Under live-sale load the Hub can
 * blip a 5xx; `fetchCampaign` throws on a non-ok, non-404 status. A single
 * retry turns most blips into a successful checkout render instead of bouncing
 * the buyer to the error boundary. A real 404 still returns null (→ notFound),
 * and a persistent failure still throws (→ error.tsx with a retry button) —
 * never a silent abort.
 */
async function loadCampaign(slug: string) {
  try {
    return await fetchCampaign(slug);
  } catch {
    await new Promise((r) => setTimeout(r, 350));
    return await fetchCampaign(slug);
  }
}

export default async function CheckoutPage({
  params,
}: {
  params: { slug: string };
}) {
  const brand = getBrand();
  const [payload, raw] = await Promise.all([
    loadCampaign(params.slug),
    fetchPublishedLanding(brand).catch(() => null),
  ]);
  if (!payload) notFound();

  const brandConfig = withDefaults(brand, raw as Partial<LandingConfig> | null);
  return (
    <BrandThemeProvider brandConfig={brandConfig}>
      <CheckoutClient payload={payload} />
    </BrandThemeProvider>
  );
}
