"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { LandingPayload } from "@/lib/types";
import { deriveState } from "@/lib/state-engine";
import { useCart } from "@/lib/cart-store";
import { cn } from "@/lib/cn";
import {
  Hero,
  Countdown,
  BeforeReveal,
  EndedFarewell,
} from "./blocks/HeroAndCountdown";
import { BundleShowcase } from "./blocks/BundleShowcase";
import { QuantityTierVisualizer } from "./blocks/QuantityTierVisualizer";
import { FeaturedProducts } from "./blocks/FeaturedProducts";
import { LookbookCarousel } from "./blocks/LookbookCarousel";
import { StockCounter } from "./blocks/StockCounter";
import {
  BrandStory,
  FounderQuote,
  WhyBuy,
  Testimonials,
  Faq,
  WigCare,
  StylistSpotlight,
  ShippingReturns,
} from "./blocks/Narrative";
import { ResellerBulkSection } from "./blocks/ResellerBulkSection";
import { DiscountSummaryBanner } from "./blocks/DiscountSummaryBanner";
import { NewsletterCapture, VipSignup } from "./blocks/Signup";
import { UgcCarousel } from "./blocks/UgcCarousel";
import { CartButton } from "./cart/CartButton";
import { CartDrawer } from "./cart/CartDrawer";
import { CartUpsellModal } from "./cart/CartUpsellModal";
import { ExitIntent } from "./cart/ExitIntent";
import { HowToShop } from "./HowToShop";
import { ViewerTicker } from "./social-proof/ViewerTicker";
import { JustBoughtTicker } from "./social-proof/JustBoughtTicker";

const NULL_RENDERERS: Record<string, () => null> = {};

export function LandingShell({
  payload,
  omitHero = false,
}: {
  payload: LandingPayload;
  /** When true the built-in <Hero> is skipped so a host (the live-state page)
   *  can mount its own Atelier hero above this commerce body. All blocks and
   *  the live overlays render exactly as before. */
  omitHero?: boolean;
}) {
  const { state, derived, msToEnd } = useMemo(
    () => deriveState(payload),
    [payload],
  );
  const init = useCart((s) => s.init);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    init(payload.slug);
  }, [init, payload.slug]);
  // Re-derive the state every second so countdown transitions are smooth
  // (Before → Live → Last Call → Ended).
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  void tick;

  const business = payload.brand?.business_key || "pixiegirl";
  useEffect(() => {
    document.documentElement.setAttribute("data-business", business);
  }, [business]);

  const blocks = (payload.blocks || []).filter((b) => b.enabled !== false);
  const isEnded = state === "ended";

  return (
    <main
      className={cn(
        "min-h-screen relative pb-[120px]",
        isEnded && "ended-fade",
      )}
    >
      {/* Hero is always first — its variant depends on the derived state.
          The live-state page omits it and mounts its own Atelier hero. */}
      {!omitHero && (
        <Hero payload={payload} derived={derived} msToEnd={msToEnd} />
      )}

      {/* Red discount summary banner — only when the sale is live. */}
      {state === "live" && <DiscountSummaryBanner payload={payload} />}

      {/* Before-state cinematic reveal (animated curtain on first load). */}
      <AnimatePresence>
        {derived === "before" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
          >
            <BeforeReveal payload={payload} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Block renderers — order is whatever the campaign builder set. */}
      {blocks.map((b, i) => (
        <BlockRouter
          key={`${b.key}-${i}`}
          block={b}
          payload={payload}
          state={state}
          derived={derived}
        />
      ))}

      {isEnded && <EndedFarewell payload={payload} />}

      {/* The footer is rendered by the host (LiveShell) using the shared
          landing-kit <LandingFooter>, so the live drop carries the SAME
          "house" footer the owner authors on the apex page — consistent
          across the before / live / ended states. */}

      {/* Live-state overlays. */}
      {state === "live" && (
        <>
          <CartButton />
          <CartDrawer payload={payload} />
          <CartUpsellModal payload={payload} />
          {payload.exit_intent_enabled && <ExitIntent payload={payload} />}
          <ViewerTicker payload={payload} />
          <JustBoughtTicker payload={payload} />
          <HowToShop />
        </>
      )}
    </main>
  );
}

function BlockRouter({
  block,
  payload,
  state,
  derived,
}: {
  block: {
    key: string;
    props?: Record<string, unknown>;
    drafted_by_ai?: boolean;
    rationale?: string;
  };
  payload: LandingPayload;
  state: "before" | "live" | "ended";
  derived: ReturnType<typeof deriveState>["derived"];
}) {
  const onlyOn = block.props?.only_on as
    | "before"
    | "live"
    | "ended"
    | undefined;
  if (onlyOn && onlyOn !== state) return null;
  switch (block.key) {
    case "countdown":
      return <Countdown payload={payload} derived={derived} />;
    case "bundle_showcase":
      return <BundleShowcase payload={payload} state={state} />;
    case "quantity_tier_visualiser":
    case "quantity_tier_visualizer":
      return <QuantityTierVisualizer payload={payload} state={state} />;
    case "featured_products":
      return <FeaturedProducts payload={payload} state={state} />;
    case "lookbook_carousel":
      return <LookbookCarousel payload={payload} />;
    case "stock_counter":
      return <StockCounter payload={payload} state={state} />;
    case "brand_story":
      return <BrandStory payload={payload} />;
    case "founder_quote":
      return <FounderQuote payload={payload} />;
    case "why_buy":
      return <WhyBuy payload={payload} />;
    case "testimonials":
      return <Testimonials payload={payload} />;
    case "ugc_carousel":
      return <UgcCarousel payload={payload} />;
    case "faq":
      return <Faq payload={payload} />;
    case "wig_care":
      return <WigCare payload={payload} />;
    case "stylist_spotlight":
      return <StylistSpotlight payload={payload} />;
    case "shipping_returns":
      return <ShippingReturns payload={payload} />;
    case "reseller_bulk":
      return <ResellerBulkSection payload={payload} />;
    case "newsletter_capture":
      return state === "before" ? (
        <NewsletterCapture payload={payload} />
      ) : null;
    case "vip_signup":
      return state === "before" ? <VipSignup payload={payload} /> : null;
    default: {
      // Unknown block keys render nothing rather than crashing — let the
      // campaign builder be forward-compatible. Memoise the no-op to avoid
      // re-renders.
      if (!NULL_RENDERERS[block.key]) {
        NULL_RENDERERS[block.key] = () => null;
      }
      return null;
    }
  }
}
