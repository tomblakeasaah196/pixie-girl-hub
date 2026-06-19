import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { fetchSalesIndex } from "@/lib/api";
import { getBrand } from "@/lib/brand";
import { JoinTheListForm } from "@/components/JoinTheListForm";
import { IntroOverlay } from "@/components/IntroOverlay";
import { ScrollIndicator } from "@/components/ScrollIndicator";

/**
 * Root index for the sales subdomain (apex page).
 *
 * When there's no active sale, renders a rich empty-state that:
 * - Shows upcoming drop previews with countdowns
 * - Archives past drops with a gallery
 * - Offers a "Join the list" form to catch interested visitors
 * - Routes to the brand's main storefront for ongoing shopping
 *
 * Brand-aware: storefront link and colors adapt per business_key.
 */

interface SalesSummary {
  slug: string;
  name: string;
  hero_image_url?: string;
  state: "before" | "live" | "ended";
  starts_at?: string;
  ends_at?: string;
}

interface IndexPayload {
  brand: string;
  active: SalesSummary | null;
  upcoming: SalesSummary[];
  past: SalesSummary[];
}

export const metadata = {
  title: "Sales",
  description: "Coming soon. Join the list to be first when doors open.",
};

async function IndexContent() {
  let index: IndexPayload | null = null;
  try {
    index = await fetchSalesIndex();
  } catch (err) {
    console.error("Failed to load sales index:", err);
  }

  // If there's an active sale, this page shouldn't be displayed; the app
  // should route to /sale/[slug]. But if we land here anyway, gracefully
  // show the storefront link.
  if (!index || index.active) {
    return <DefaultFallback />;
  }

  const storefrontUrl = getStorefrontUrl(index.brand);
  const hasUpcoming = index.upcoming && index.upcoming.length > 0;
  const hasPast = index.past && index.past.length > 0;

  return (
    <main className="min-h-screen">
      {/* Hero: "Between drops" messaging */}
      <section className="relative overflow-hidden min-h-[40vh] flex items-center justify-center px-6 py-10 md:py-0">
        <div
          className="absolute inset-0 -z-10"
          style={{
            background: "radial-gradient(ellipse at 50% 0%, rgb(var(--accent)/0.25), transparent 60%)",
          }}
        />
        <div className="mx-auto max-w-[720px] text-center space-y-6">
          <div className="micro">Between drops</div>
          <h1 className="font-display leading-[1.02] text-[clamp(40px,7vw,72px)] tracking-tight">
            The doors are <span className="italic text-[rgb(var(--accent-glow))]">closed</span>.
          </h1>
          <p className="text-[rgb(var(--text-muted))] text-lg leading-relaxed max-w-[560px] mx-auto">
            {hasUpcoming ? (
              <>A new drop is coming soon. Get on the list to be first in when doors open.</>
            ) : (
              <>
                We&apos;re planning the next drop. Join below to be first to know when we&apos;re
                live again.
              </>
            )}
          </p>
        </div>
      </section>

      {/* Join the list form */}
      <section className="px-6 py-8 md:py-10">
        <div className="mx-auto max-w-[480px]">
          <JoinTheListForm />
        </div>
      </section>

      {/* Upcoming campaigns */}
      {hasUpcoming && (
        <section className="px-6 py-8 md:py-10 border-t border-[rgb(var(--border-c)/0.1)]">
          <div className="mx-auto max-w-[1200px]">
            <div className="mb-12">
              <div className="micro mb-2">Next up</div>
              <h2 className="font-display text-[clamp(28px,5vw,48px)] leading-tight">
                Coming soon.
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {index.upcoming.slice(0, 2).map((campaign) => (
                <Link
                  key={campaign.slug}
                  href={`/sale/${campaign.slug}`}
                  className="group glass rounded-[var(--radius)] overflow-hidden hover:border-[rgb(var(--accent)/0.5)] transition-colors"
                >
                  {campaign.hero_image_url && (
                    <div className="relative w-full h-56 overflow-hidden bg-[rgb(var(--text)/0.04)]">
                      <Image
                        src={campaign.hero_image_url}
                        alt={campaign.name}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[rgb(var(--bg))] via-transparent" />
                    </div>
                  )}
                  <div className="p-6">
                    <div className="micro mb-2 text-[rgb(var(--warn))]">Coming soon</div>
                    <h3 className="font-display text-xl leading-tight">{campaign.name}</h3>
                    {campaign.starts_at && (
                      <p className="text-[12px] text-[rgb(var(--text-muted))] mt-3">
                        {new Date(campaign.starts_at).toLocaleDateString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })}
                      </p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Past campaigns archive */}
      {hasPast && (
        <section className="px-6 py-8 md:py-10 border-t border-[rgb(var(--border-c)/0.1)]">
          <div className="mx-auto max-w-[1200px]">
            <div className="mb-12">
              <div className="micro mb-2">Past drops</div>
              <h2 className="font-display text-[clamp(28px,5vw,48px)] leading-tight">
                Flashback.
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {index.past.slice(0, 6).map((campaign) => (
                <Link
                  key={campaign.slug}
                  href={`/sale/${campaign.slug}`}
                  className="group relative aspect-square rounded-lg overflow-hidden"
                >
                  {campaign.hero_image_url ? (
                    <>
                      <Image
                        src={campaign.hero_image_url}
                        alt={campaign.name}
                        fill
                        className="object-cover group-hover:scale-110 transition-transform duration-500 ended-fade"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[rgb(var(--bg))] via-transparent" />
                    </>
                  ) : (
                    <div className="w-full h-full bg-[rgb(var(--text)/0.04)]" />
                  )}
                  <div className="absolute inset-0 flex items-end p-4">
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-[rgb(var(--text-faint))] mb-1">
                        Ended
                      </div>
                      <h3 className="font-display text-sm leading-tight text-[rgb(var(--text))]">
                        {campaign.name}
                      </h3>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* CTA: Visit storefront */}
      <section className="px-6 py-8 md:py-10 border-t border-[rgb(var(--border-c)/0.1)] text-center">
        <div className="mx-auto max-w-[560px]">
          <p className="text-[rgb(var(--text-muted))] mb-6">
            In the meantime, shop our full collection on the main storefront.
          </p>
          <Link
            href={storefrontUrl}
            className="inline-flex items-center justify-center h-12 px-6 rounded-xl bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))] font-semibold cta-sheen"
          >
            Visit the storefront →
          </Link>
        </div>
      </section>
    </main>
  );
}

function DefaultFallback() {
  return (
    <main className="min-h-screen grid place-items-center px-6 py-10">
      <div className="glass rounded-[var(--radius)] p-8 max-w-md text-center space-y-4">
        <div className="micro">No live sale right now</div>
        <h1 className="font-display text-3xl leading-tight">
          The doors are{" "}
          <span className="italic text-[rgb(var(--accent-glow))]">closed</span>{" "}
          — for now.
        </h1>
        <p className="text-[rgb(var(--text-muted))] text-sm">
          When a new sale opens we&apos;ll meet you back here. In the meantime, shop our full collection on
          the main storefront.
        </p>
        <Link
          href={getStorefrontUrl(getBrand())}
          className="inline-flex items-center justify-center h-11 px-5 rounded-xl bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))] font-semibold cta-sheen"
        >
          Visit the storefront →
        </Link>
      </div>
    </main>
  );
}

function getStorefrontUrl(brand: string): string {
  if (brand === "faitlynhair") return "https://thefaitlynbrand.com";
  return "https://pixiegirlglobal.com";
}

export default function Page() {
  return (
    <>
      <IntroOverlay brand={getBrand()} />
      <Suspense fallback={<DefaultFallback />}>
        <IndexContent />
      </Suspense>
      <ScrollIndicator />
    </>
  );
}
