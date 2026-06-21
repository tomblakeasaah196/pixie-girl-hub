import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { fetchCampaign, fetchPublishedLanding } from "@/lib/api";
import { getBrand } from "@/lib/brand";
import { deriveState } from "@/lib/state-engine";
import { withDefaults, type LandingConfig } from "@landing-kit";
import { LiveShell } from "./_components/LiveShell";

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
  const [payload, raw] = await Promise.all([
    fetchCampaign(params.slug).catch(() => null),
    fetchPublishedLanding(brand).catch(() => null),
  ]);
  if (!payload) return { title: "Sale not found" };

  const brandConfig = withDefaults(brand, raw as Partial<LandingConfig> | null);
  const title = payload.seo.meta_title || `${payload.name} — live now`;
  const description =
    payload.seo.meta_description ||
    `${payload.name} is live. The doors are open — shop the drop before the clock runs out.`;
  const ogImage =
    payload.seo.og_image_url ||
    payload.hero?.image_url ||
    brandConfig.seo.ogImageUrl ||
    brandConfig.hero.imageUrl ||
    null;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      url: `https://${brandConfig.domain}/sale/${params.slug}`,
      images: ogImage ? [{ url: ogImage, width: 1200, height: 630 }] : undefined,
    },
    twitter: { card: "summary_large_image", title, description },
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
  if (state !== "live") redirect(`/sale/${params.slug}/${state}`);

  const brandConfig = withDefaults(brand, raw as Partial<LandingConfig> | null);
  return <LiveShell payload={payload} brandConfig={brandConfig} />;
}
