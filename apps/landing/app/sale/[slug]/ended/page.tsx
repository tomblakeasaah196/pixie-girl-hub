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
  const title = payload.seo.meta_title || `${payload.name} — ended`;
  const description =
    payload.seo.meta_description ||
    `${payload.name} has ended. Visit our storefront for the full collection.`;
  return {
    title,
    description,
    robots: { index: false, follow: true },
    openGraph: { title, description, type: "website" },
  };
}

export default async function Page({ params }: { params: Params }) {
  const payload = await fetchCampaign(params.slug);
  if (!payload) notFound();
  const { state } = deriveState(payload);
  if (state !== "ended") redirect(`/sale/${params.slug}/${state}`);
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
