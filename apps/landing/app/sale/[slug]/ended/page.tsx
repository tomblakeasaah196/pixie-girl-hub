import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { fetchCampaign, fetchPublishedLanding } from "@/lib/api";
import { getBrand } from "@/lib/brand";
import { deriveState } from "@/lib/state-engine";
import { withDefaults, type LandingConfig } from "@landing-kit";
import { AfterShell } from "./_components/AfterShell";

interface Params {
  slug: string;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const brand = getBrand();
  const [campaign, raw] = await Promise.all([
    fetchCampaign(params.slug).catch(() => null),
    fetchPublishedLanding(brand).catch(() => null),
  ]);
  if (!campaign) return { title: "Sale not found" };

  const brandConfig = withDefaults(brand, raw as Partial<LandingConfig> | null);
  const title =
    campaign.seo?.meta_title ||
    `${campaign.name} — ended · ${brandConfig.brandName}`;
  const description =
    campaign.seo?.meta_description ||
    `${campaign.name} has ended. Stay close — the next chapter is being prepared.`;
  const ogImage =
    campaign.seo?.og_image_url ||
    brandConfig.seo.ogImageUrl ||
    campaign.hero?.image_url ||
    brandConfig.hero.imageUrl ||
    brandConfig.logo.url ||
    null;
  const favicon = brandConfig.seo.faviconUrl || brandConfig.logo.url || null;

  return {
    title,
    description,
    icons: favicon ? { icon: favicon, apple: favicon } : undefined,
    // The after page is a memento — don't compete with the apex or the next
    // campaign's before page in search results.
    robots: { index: false, follow: true },
    openGraph: {
      title,
      description,
      type: "website",
      url: `https://${brandConfig.domain}/sale/${params.slug}/ended`,
      siteName: brandConfig.brandName,
      images: ogImage
        ? [{ url: ogImage, width: 1200, height: 630, alt: title }]
        : undefined,
    },
    twitter: {
      card: ogImage ? "summary_large_image" : "summary",
      title,
      description,
      site: brandConfig.seo.twitterHandle || undefined,
      images: ogImage ? [ogImage] : undefined,
    },
  };
}

export default async function Page({ params }: { params: Params }) {
  const brand = getBrand();
  const [payload, raw] = await Promise.all([
    fetchCampaign(params.slug),
    fetchPublishedLanding(brand).catch(() => null),
  ]);
  if (!payload) notFound();

  const { state } = deriveState(payload);
  if (state !== "ended") redirect(`/sale/${params.slug}/${state}`);

  const brandConfig = withDefaults(brand, raw as Partial<LandingConfig> | null);
  return <AfterShell payload={payload} brandConfig={brandConfig} />;
}
