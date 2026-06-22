import { notFound } from "next/navigation";
import { fetchCampaign, fetchPublishedLanding } from "@/lib/api";
import { getBrand } from "@/lib/brand";
import { withDefaults, type LandingConfig } from "@landing-kit";
import { BrandThemeProvider } from "@/components/BrandThemeProvider";
import { ThankYouClient } from "./ThankYouClient";

export default async function ThankYouPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { order_id?: string; ref?: string };
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
      <ThankYouClient
        payload={payload}
        orderId={searchParams.order_id ?? null}
        reference={searchParams.ref ?? null}
        brandName={brandConfig.brandName}
      />
    </BrandThemeProvider>
  );
}
