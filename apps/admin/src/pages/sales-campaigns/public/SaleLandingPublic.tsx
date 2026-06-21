/**
 * Public sales-campaign landing page — /sale/:slug (no auth).
 *
 * Served at the sales subdomain (Host → brand) or, when previewed from the
 * admin, with an explicit ?brand= hint. Renders the same LandingRender the
 * Studio previews, so the admin sees exactly what the customer will.
 */

import { useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { type LandingBlock, usePublicLanding } from "@/lib/campaigns";
import {
  LandingRender,
  type LandingModel,
  type LandingProduct,
} from "../landing/LandingRender";

function galleryFromBlocks(blocks: LandingBlock[]): string[] {
  const lb = (blocks || []).find(
    (b) => (b.key || b.type) === "lookbook_carousel",
  );
  const imgs = lb?.props?.images;
  return Array.isArray(imgs) ? (imgs as string[]) : [];
}

export function SaleLandingPublic() {
  const { slug } = useParams<{ slug: string }>();
  const [params] = useSearchParams();
  const brand = params.get("brand") || undefined;
  const q = usePublicLanding(slug, brand);

  const model: LandingModel | null = useMemo(() => {
    if (!q.data) return null;
    const d = q.data;
    return {
      slug: d.slug,
      name: d.name,
      state: d.state,
      brand,
      hero: d.hero,
      countdown_to: d.countdown_to,
      countdown_message: d.countdown_message,
      signup_for_notifications: d.signup_for_notifications,
      blocks: d.blocks,
      products: (d.products || []) as LandingProduct[],
      ended: d.ended,
      gallery: galleryFromBlocks(d.blocks),
    };
  }, [q.data, brand]);

  if (q.isLoading) {
    return (
      <div className="min-h-screen bg-bg grid place-items-center text-text-muted">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (q.isError || !model) {
    return (
      <div className="min-h-screen bg-bg grid place-items-center px-6 text-center">
        <div className="max-w-[460px]">
          <div className="text-[11px] tracking-[0.3em] uppercase text-accent-glow/90 font-semibold mb-4">
            Between drops
          </div>
          <h1 className="font-display text-[32px] md:text-[40px] leading-tight mb-4">
            This chapter is being prepared
          </h1>
          <p className="text-text-muted leading-relaxed">
            The page you're looking for isn't open right now. Follow us, or join
            the list, to be the first to know the moment it opens.
          </p>
        </div>
      </div>
    );
  }

  return (
    <LandingRender model={model} scrollable={false} className="min-h-screen" />
  );
}
