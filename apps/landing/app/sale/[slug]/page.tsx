import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchCampaign } from "@/lib/api";
import { LandingShell } from "@/components/LandingShell";

interface Params {
  slug: string;
}

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const payload = await fetchCampaign(params.slug).catch(() => null);
  if (!payload) {
    return { title: "Sale not found" };
  }
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
  return <LandingShell payload={payload} />;
}
