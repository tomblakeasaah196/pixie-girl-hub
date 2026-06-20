import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { fetchSalesIndex, fetchPublishedLanding } from "@/lib/api";
import { getBrand } from "@/lib/brand";
import { withDefaults } from "@landing-kit";
import { PublicLanding } from "@/components/PublicLanding";
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
  let raw: Partial<LandingConfig> | null = null;
  try {
    raw = (await fetchPublishedLanding(brand)) as Partial<LandingConfig> | null;
  } catch {
    // fall through to brand defaults
  }
  // Merge over brand defaults so the SEO block is always present, even before
  // a brand has published (or for a snapshot saved before SEO existed).
  const config = withDefaults(brand, raw);
  const { seo } = config;

  const title = seo.metaTitle || config.brandName;
  const description = seo.metaDescription || config.tagline;
  // The composed 1200×630 banner is preferred; fall back to the hero, then logo.
  const ogImage = seo.ogImageUrl || config.hero.imageUrl || config.logo.url || null;
  const favicon = seo.faviconUrl || config.logo.url || null;

  return {
    title,
    description,
    icons: favicon ? { icon: favicon, apple: favicon } : undefined,
    openGraph: {
      title,
      description,
      type: "website",
      url: `https://${config.domain}`,
      siteName: config.brandName,
      images: ogImage ? [{ url: ogImage, width: 1200, height: 630, alt: title }] : undefined,
    },
    twitter: {
      card: ogImage ? "summary_large_image" : "summary",
      title,
      description,
      site: seo.twitterHandle || undefined,
      images: ogImage ? [ogImage] : undefined,
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

  // Hydrate with brand defaults (same merge the studio uses) so the live page
  // is a field-for-field match with the studio preview.
  return <PublicLanding config={withDefaults(brand, config)} />;
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
