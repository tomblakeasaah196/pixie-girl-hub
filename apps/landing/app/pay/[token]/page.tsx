import { getBrand } from "@/lib/brand";
import { fetchPublishedLanding } from "@/lib/api";
import { withDefaults, type LandingConfig } from "@landing-kit";
import { BrandThemeProvider } from "@/components/BrandThemeProvider";
import { PayClient } from "./PayClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Pay your balance",
  robots: { index: false, follow: false },
};

/**
 * Flexi Pay balance page (PR-2). The permanent no-login link the customer
 * receives in receipts and reminders: {brand}/pay/{token}. Order-scoped, not
 * campaign-scoped — the brand comes from the host, the order from the token.
 * All figures are fetched client-side from the Hub preview endpoint, which is
 * the single source of truth (the page never computes money itself).
 */
export default async function PayPage({
  params,
}: {
  params: { token: string };
}) {
  const brand = getBrand();
  const raw = await fetchPublishedLanding(brand).catch(() => null);
  const brandConfig = withDefaults(brand, raw as Partial<LandingConfig> | null);
  const whatsapp =
    brandConfig.socials?.find((s) => s.platform === "whatsapp")?.href || null;

  return (
    <BrandThemeProvider brandConfig={brandConfig}>
      <PayClient
        token={params.token}
        brandName={brandConfig.brandName}
        whatsappHref={whatsapp}
      />
    </BrandThemeProvider>
  );
}
