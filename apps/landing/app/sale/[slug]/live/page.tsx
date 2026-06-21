import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { fetchCampaign } from "@/lib/api";
import { deriveState } from "@/lib/state-engine";
import { LandingShell } from "@/components/LandingShell";
import { IntroOverlay } from "@/components/IntroOverlay";

interface Params {
  slug: string;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const payload = await fetchCampaign(params.slug).catch(() => null);
  if (!payload) return { title: "Sale not found" };
  const title = payload.seo.meta_title || payload.name;
  const description =
    payload.seo.meta_description ||
    `${payload.name} — a time-bound sale from ${payload.brand?.display_name || "us"}.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: payload.seo.og_image_url
        ? [{ url: payload.seo.og_image_url, width: 1200, height: 630 }]
        : undefined,
      type: "website",
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function Page({ params }: { params: Params }) {
  const payload = await fetchCampaign(params.slug);
  if (!payload) notFound();
  const { state } = deriveState(payload);
  if (state !== "live") redirect(`/sale/${params.slug}/${state}`);
  return (
    <>
      <IntroOverlay
        brand={payload.brand?.business_key}
        campaignName={payload.name}
        sessionKey={`pgh-intro-seen:${payload.slug}`}
      />
      <LandingShell payload={payload} />
    </>
  );
}
