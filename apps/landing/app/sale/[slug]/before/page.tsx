import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { fetchCampaign, fetchPublishedLanding } from "@/lib/api";
import { getBrand } from "@/lib/brand";
import { withDefaults, type LandingConfig } from "@landing-kit";
import { BeforeShell } from "./_components/BeforeShell";

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
    brandConfig.seo.metaTitle ||
    `${campaign.name} — ${brandConfig.brandName}`;
  const description =
    campaign.seo?.meta_description ||
    brandConfig.seo.metaDescription ||
    `${campaign.name} — a time-bound sale from ${brandConfig.brandName}.`;
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
    openGraph: {
      title,
      description,
      type: "website",
      url: `https://${brandConfig.domain}/sale/${params.slug}`,
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

  // Defensive: if the campaign is no longer "before", bounce to the parent
  // router which will redirect to /live or /ended.
  const starts = new Date(payload.starts_at).getTime();
  if (Number.isFinite(starts) && Date.now() >= starts) {
    redirect(`/sale/${params.slug}`);
  }

  const brandConfig = withDefaults(brand, raw as Partial<LandingConfig> | null);
  return <BeforeShell payload={payload} brandConfig={brandConfig} />;
}
