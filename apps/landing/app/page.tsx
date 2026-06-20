import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { fetchSalesIndex, fetchPublishedLanding } from "@/lib/api";
import { getBrand } from "@/lib/brand";
import { LandingPreview } from "@/components/LandingPreview";
import type { LandingConfig } from "@/lib/types";

/**
 * Root index for the sales subdomain (apex page).
 *
 * Behaviour:
 * - If a sale is currently live, redirect straight to /sale/[slug].
 * - Otherwise render the brand's published "no active sale" landing page —
 *   the design authored in the Landing Studio (shared.landing_pages →
 *   /api/public/landing). This is the single source of truth for the
 *   between-drops experience; there is no hardcoded fallback design.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const brand = getBrand();
  let config: LandingConfig | null = null;
  try {
    config = (await fetchPublishedLanding(brand)) as LandingConfig | null;
  } catch {
    // use defaults below
  }

  const title = config?.brandName ?? (brand === "faitlynhair" ? "Faitlyn Hair" : "Pixie Girl Global");
  const description = config?.tagline ?? "Join the list to be first when the doors open.";
  const domain = config?.domain ?? (brand === "faitlynhair" ? "sales.thefaitlynbrand.com" : "sales.pixiegirlglobal.com");
  const logoUrl = config?.logo?.url ?? null;

  return {
    title,
    description,
    icons: logoUrl ? { icon: logoUrl } : undefined,
    openGraph: {
      title,
      description,
      type: "website",
      url: `https://${domain}`,
      siteName: title,
      images: logoUrl ? [{ url: logoUrl, width: 200, height: 200, alt: title }] : undefined,
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: logoUrl ? [logoUrl] : undefined,
    },
  };
}

export default async function Page() {
  const brand = getBrand();

  // A live sale takes over the apex — send visitors straight to it.
  let activeSlug: string | null = null;
  try {
    const index = await fetchSalesIndex();
    activeSlug = index?.active?.slug ?? null;
  } catch (err) {
    console.error("Failed to load sales index:", err);
  }
  if (activeSlug) redirect(`/sale/${activeSlug}`);

  // Otherwise: the published brand landing (authored in the Studio).
  let config: LandingConfig | null = null;
  try {
    config = (await fetchPublishedLanding(brand)) as LandingConfig | null;
  } catch (err) {
    console.error("Failed to load published landing config:", err);
  }

  if (!config) {
    return <OpeningSoon brand={brand} />;
  }

  return <LandingPreview config={config} />;
}

/**
 * Neutral holding screen shown only if a brand has never published a landing
 * page yet. Deliberately minimal and on-brand — never the old design.
 */
function OpeningSoon({ brand }: { brand: string }) {
  const storefront =
    brand === "faitlynhair"
      ? "https://thefaitlynbrand.com"
      : "https://pixiegirlglobal.com";
  return (
    <main className="min-h-screen grid place-items-center px-6 py-16">
      <div className="text-center space-y-5 max-w-md">
        <div className="text-[11px] tracking-[0.4em] uppercase text-[rgb(var(--text-muted))]">
          Opening soon
        </div>
        <h1 className="font-display text-[clamp(32px,6vw,56px)] leading-tight">
          Something is being prepared.
        </h1>
        <p className="text-[rgb(var(--text-muted))] leading-relaxed">
          The next chapter is on its way. In the meantime, explore the full
          collection on our storefront.
        </p>
        <a
          href={storefront}
          className="inline-flex items-center justify-center h-11 px-6 rounded-xl bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))] font-semibold"
        >
          Visit the storefront →
        </a>
      </div>
    </main>
  );
}
