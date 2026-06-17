import { fetchCampaign } from "@/lib/api";

/**
 * Dynamic PWA manifest — reads the host's brand (resolved upstream) and
 * personalises the manifest with the brand display name + theme.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");
  let brandName = "Sales";
  let themeColor = "#0F0809";
  if (slug) {
    try {
      const p = await fetchCampaign(slug);
      if (p?.brand?.display_name) brandName = `${p.brand.display_name} · Sale`;
    } catch {
      /* fall through */
    }
  }
  const manifest = {
    name: brandName,
    short_name: brandName.split("·")[0].trim(),
    start_url: slug ? `/sale/${slug}` : "/",
    display: "standalone",
    background_color: themeColor,
    theme_color: themeColor,
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any maskable",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
    ],
  };
  return Response.json(manifest);
}
