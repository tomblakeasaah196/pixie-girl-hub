/**
 * Public sales-campaign landing page — /sale/:slug (no auth).
 *
 * Served at the sales subdomain (Host → brand) or, when previewed from the
 * admin, with an explicit ?brand= hint. Every state (before / live / ended)
 * renders the shared @landing-kit Atelier composition — the exact same
 * components the live sales site uses — so the admin preview is true WYSIWYG,
 * drafts included. LandingRender remains only as an unresolved-brand fallback.
 */

import { useCallback, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import {
  type LandingBlock,
  usePublicLanding,
  usePublicLandingConfig,
} from "@/lib/campaigns";
import {
  BeforeState,
  LiveState,
  EndedState,
  withDefaults,
  hexToTriplet,
  type LandingPayload,
  type LandingSubmit,
} from "@landing-kit";
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

  // Resolve the brand so the page renders in the brand's palette (banner,
  // fonts, surfaces) — without it LandingRender falls back to the platform's
  // default oxblood, which is wrong for every brand but Pixie Girl. Prefer the
  // explicit ?brand= hint, then the brand the API resolved onto the payload.
  const brandKey = brand || q.data?.brand?.business_key;
  const cfgQ = usePublicLandingConfig(brandKey);
  // Merge the published Studio config over the brand defaults; when nothing is
  // published yet we still get a complete, on-brand theme (never the default).
  const brandConfig = useMemo(
    () => (brandKey ? withDefaults(brandKey, cfgQ.data ?? null) : null),
    [brandKey, cfgQ.data],
  );

  // Map the platform skin tokens to the brand palette so even the brief intro
  // curtain (which reads --accent-deep/--bg) is on-brand, not the admin's
  // default oxblood. The Atelier hero/body theme themselves from brandConfig.
  const tokenVars = useMemo(() => {
    if (!brandConfig) return undefined;
    const t = brandConfig.theme;
    return {
      "--bg": hexToTriplet(t.ink),
      "--text": hexToTriplet(t.paper),
      "--accent": hexToTriplet(t.primary),
      "--accent-deep": hexToTriplet(t.primaryDeep),
      "--accent-glow": hexToTriplet(t.glow),
    } as React.CSSProperties;
  }, [brandConfig]);

  // Live signup handler for the Atelier invitation form (mirrors the public
  // site): POST to the campaign-scoped signup endpoint, return a sample code.
  const onSignup: LandingSubmit = useCallback(
    async ({ name, email, whatsapp, channel }) => {
      const notify_via =
        channel === "whatsapp"
          ? "whatsapp"
          : channel === "both"
            ? "both"
            : "email";
      const res = await fetch(
        `/api/public/sale/${encodeURIComponent(slug || "")}/signup`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email || undefined,
            phone: whatsapp || undefined,
            notify_via,
            source: "before",
          }),
        },
      );
      if (!res.ok) throw new Error(`Signup failed: ${res.status}`);
      const prefix =
        (name || "FRIEND").replace(/[^A-Za-z]/g, "").slice(0, 6).toUpperCase() ||
        "FRIEND";
      return { code: `${prefix}-${Math.floor(100 + Math.random() * 900)}` };
    },
    [slug],
  );

  // Ended state: the campaign is closed, so its "hear first" form joins the
  // brand newsletter (mirrors the live AfterShell).
  const onNewsletterSignup: LandingSubmit = useCallback(
    async ({ name, email, whatsapp, referral, channel }) => {
      const res = await fetch(
        `/api/public/landing/signup${brandKey ? `?brand=${encodeURIComponent(brandKey)}` : ""}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, whatsapp, referral, channel }),
        },
      );
      if (!res.ok) throw new Error(`Signup failed: ${res.status}`);
      const json = await res.json().catch(() => null);
      return { code: json?.data?.code ?? "" };
    },
    [brandKey],
  );

  const model: LandingModel | null = useMemo(() => {
    if (!q.data) return null;
    const d = q.data;
    return {
      slug: d.slug,
      name: d.name,
      state: d.state,
      hero: d.hero,
      countdown_to: d.countdown_to,
      countdown_message: d.countdown_message,
      signup_for_notifications: d.signup_for_notifications,
      blocks: d.blocks,
      products: (d.products || []) as LandingProduct[],
      ended: d.ended,
      gallery: galleryFromBlocks(d.blocks),
    };
  }, [q.data]);

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

  // Render the exact shared Atelier composition the live site renders, per
  // state, so the admin preview is true WYSIWYG (drafts included). LandingRender
  // remains only as a fallback when the brand/theme can't be resolved.
  if (brandConfig) {
    const payload = q.data as unknown as LandingPayload;
    if (model.state === "before") {
      return (
        <div style={tokenVars}>
          <BeforeState
            payload={payload}
            brandConfig={brandConfig}
            onSignup={onSignup}
          />
        </div>
      );
    }
    if (model.state === "ended") {
      return (
        <div style={tokenVars}>
          <EndedState
            payload={payload}
            brandConfig={brandConfig}
            onSignup={onNewsletterSignup}
          />
        </div>
      );
    }
    // live (and any in-between)
    return (
      <div style={tokenVars}>
        <LiveState payload={payload} brandConfig={brandConfig} />
      </div>
    );
  }

  return (
    <LandingRender
      model={model}
      brandConfig={brandConfig}
      scrollable={false}
      className="min-h-screen"
    />
  );
}
