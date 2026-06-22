import { notFound } from "next/navigation";
import { fetchCampaign, fetchPublishedLanding } from "@/lib/api";
import { getBrand } from "@/lib/brand";
import { withDefaults, type LandingConfig } from "@landing-kit";
import { BrandThemeProvider } from "@/components/BrandThemeProvider";
import { CheckoutClient } from "@/components/checkout/CheckoutClient";

export default async function CheckoutPage({
  params,
}: {
  params: { slug: string };
}) {
  const brand = getBrand();
  const [payload, raw] = await Promise.all([
    fetchCampaign(params.slug),
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
