import { Suspense } from "react";
import { fetchPublishedLanding } from "@/lib/api";
import { getBrand } from "@/lib/brand";
import { LandingPreview } from "@/components/LandingPreview";

interface PageProps {
  searchParams: Promise<{ brand?: string }>;
}

async function LandingContent({ brand }: { brand: string }) {
  let config = null;
  try {
    const response = await fetchPublishedLanding(brand);
    config = response.data || response;
  } catch (err) {
    console.error("Failed to load published landing config:", err);
  }

  if (!config) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <p className="text-[rgb(var(--text-muted))] mb-4">Landing page not yet published</p>
          <p className="text-sm">Check back soon.</p>
        </div>
      </div>
    );
  }

  return <LandingPreview config={config} />;
}

export const metadata = {
  title: "Landing",
  description: "Join our exclusive list",
};

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const brandOverride = params.brand;
  const brand = brandOverride || getBrand();

  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <LandingContent brand={brand} />
    </Suspense>
  );
}
