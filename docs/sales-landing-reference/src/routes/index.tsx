import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { BrandProvider, useBrand } from "@/components/brand/BrandProvider";
import { BrandToggle } from "@/components/brand/BrandToggle";
import { AtelierReveal } from "@/components/brand/AtelierReveal";
import { SalesLanding } from "@/components/brand/SalesLanding";

const SITE_URL = "https://velvet-drop-reveal.lovable.app";
const OG_IMAGE = "https://storage.googleapis.com/gpt-engineer-file-uploads/0ZYy4qVj6eNEaKsg5ZbDEvSuDi02/social-images/social-1781905381233-PXG_main_pixie_model_2.webp";
const TITLE = "Pixie Girl Global & Faitlyn — Join the Inner Circle | Private Hair Drop";
const DESCRIPTION = "Pixie Girl Global and Faitlyn open their next limited hair collection to a private list of 200. Early access, up to 30% off, curated launch gifts, and referral rewards. Reserve your invitation.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { name: "keywords", content: "luxury hair, lace wigs, Pixie Girl Global, Faitlyn, Nigerian hair brand, raw hair, hair drop, private launch, premium hair extensions, Lagos hair brand" },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: SITE_URL + "/" },
      { property: "og:image", content: OG_IMAGE },
      { property: "og:image:alt", content: "Pixie Girl Global — luxury hair editorial" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
      { name: "twitter:image", content: OG_IMAGE },
    ],
    links: [
      { rel: "canonical", href: SITE_URL + "/" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": SITE_URL + "/#pixie",
              name: "Pixie Girl Global",
              legalName: "Pixie Girl Global LLC",
              url: "https://pixiegirlglobal.com",
              logo: OG_IMAGE,
              address: {
                "@type": "PostalAddress",
                streetAddress: "30 N Gould St Ste R",
                addressLocality: "Sheridan",
                addressRegion: "WY",
                postalCode: "82801",
                addressCountry: "US",
              },
              sameAs: [
                "https://www.instagram.com/pixiegirlg",
                "https://www.tiktok.com/@pixiegirlg",
                "https://www.youtube.com/@PixieGirlG",
                "https://x.com/pixiegirlg",
                "https://www.pinterest.com/pixiegirlg",
              ],
            },
            {
              "@type": "Organization",
              "@id": SITE_URL + "/#faitlyn",
              name: "The Faitlyn Brand",
              address: {
                "@type": "PostalAddress",
                streetAddress: "10B Emma Abimbola Cole Street, Lekki Phase 1",
                addressLocality: "Lagos",
                addressCountry: "NG",
              },
              sameAs: [
                "https://web.facebook.com/faitlynhair/",
                "https://www.instagram.com/faitlynhair/",
                "https://twitter.com/Faitlynhair",
              ],
            },
            {
              "@type": "WebSite",
              url: SITE_URL + "/",
              name: "Sales Atelier — Pixie Girl Global & Faitlyn",
              description: DESCRIPTION,
              inLanguage: "en",
            },
          ],
        }),
      },
    ],
  }),
  component: Page,
});

function Inner() {
  const { brandId } = useBrand();
  const campaignName: string | null = null;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <>
      <SalesLanding campaignName={campaignName} />
      {mounted && (
        <AtelierReveal brandKey={brandId} campaignName={campaignName} />
      )}
      <BrandToggle />
      <Toaster position="top-center" theme="dark" />
    </>
  );
}

function Page() {
  return (
    <BrandProvider initial="pixie">
      <Inner />
    </BrandProvider>
  );
}
