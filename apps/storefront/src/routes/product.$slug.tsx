import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Sparkles, ExternalLink } from "lucide-react";
import {
  addCartItem,
  priceFor,
  type ProductDetail,
  type Currency,
} from "@/lib/storefront";
import { ssrProduct } from "@/lib/server";
import { useCurrency, notifyCartChanged } from "@/lib/useStore";
import { usePageSlots, withSlots } from "@/lib/site-config";
import { Section, ErrorState } from "@/components/parts";
import { PreorderNotice } from "@/components/availability";
import { YouTubeFacade, youtubeId } from "@/components/site/VideoEmbed";
import { ProductGallery } from "@/components/site/ProductGallery";
import { ProductReviews } from "@/components/site/ProductReviews";
import { YouMayAlsoLove } from "@/components/site/YouMayAlsoLove";

export const Route = createFileRoute("/product/$slug")({
  loader: async ({ params }) => ssrProduct({ data: { slug: params.slug } }),
  component: ProductPage,
});

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
};

/** Social proof loop: this product was actually posted and proven in Social
 *  Studio — link back to the live post. */
function SocialProofBadge({
  proof,
  prefix,
}: {
  proof: NonNullable<ProductDetail["social_proof"]>;
  prefix: string;
}) {
  return (
    <a
      href={proof.url}
      target="_blank"
      rel="noreferrer"
      className="mt-3 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-body-sm text-muted-foreground transition hover:border-primary hover:text-primary"
    >
      <Sparkles className="h-3.5 w-3.5" />
      {prefix} {PLATFORM_LABEL[proof.platform] ?? proof.platform}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function priceOfVariant(
  p: ProductDetail,
  variantId: string | null,
  unstyled: boolean,
  currency: Currency,
): string | null {
  // The picked variant's (or unstyled anchor's) own ₦ + catalogue $ prices,
  // rendered by priceFor: USD shows the catalogue USD price — exactly what
  // checkout charges for this variant.
  if (unstyled) {
    if (p.retail_price_ngn == null) return null;
    return priceFor(
      { retail_price_ngn: p.retail_price_ngn, retail_price_usd: p.retail_price_usd },
      currency,
    );
  }
  const v = p.variants.find((x) => x.styled_variant_id === variantId);
  if (!v || v.effective_price_ngn == null) return null;
  return priceFor(
    { effective_price_ngn: v.effective_price_ngn, effective_price_usd: v.effective_price_usd },
    currency,
  );
}

function ProductPage() {
  const { product } = Route.useLoaderData();
  const [currency] = useCurrency();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  // Pre-order (000086): an out-of-stock item is offered as a pre-order; tapping
  // "Add to bag" first opens a confirm dialog so the buyer knows it's made to
  // order before it lands in the bag. A truly sold-out (opted-out) item can't
  // be added at all.
  const availability = product?.availability ?? null;
  const isPreorder = availability?.state === "preorder";
  const soldOut = availability?.state === "out_of_stock";
  const [confirmPreorder, setConfirmPreorder] = useState(false);
  // Named `copy` (not `s`) — `s` is used as a size map param further down.
  const copy = withSlots(
    {
      colourLabel: "Colour",
      sizeLabel: "Cap size",
      laceLabel: "Lace",
      unstyledLabel: "Buy unstyled (raw)",
      addCta: "Add to bag",
      addBusyLabel: "Adding...",
      viewBagCta: "View bag",
      chooseVariantError: "Please choose colour, size and lace.",
      addedToast: "Added to bag",
      addErrorToast: "Couldn't add to bag. Please try again.",
      preorderCta: "Pre-order",
      preorderTitle: "This is a pre-order",
      preorderConfirm: "Add pre-order",
      preorderCancel: "Not now",
      preorderAddedToast: "Pre-order added — we'll craft it just for you.",
      soldOutCta: "Sold out",
      socialProofPrefix: "As seen on",
      sizeGuideFallbackTitle: "Head size guide",
    },
    usePageSlots("product_detail"),
  );

  const colours = product?.colours ?? [];
  const sizes = product?.size_tiers ?? [];
  const laces = product?.lace_sizes ?? [];

  const [colourId, setColourId] = useState<string | null>(
    colours.find((c) => c.is_default)?.colour_id ?? colours[0]?.colour_id ?? null,
  );
  const [sizeCode, setSizeCode] = useState<string | null>(
    sizes[0]?.size_code ?? null,
  );
  const [laceCode, setLaceCode] = useState<string | null>(
    laces[0]?.lace_code ?? null,
  );
  const [unstyled, setUnstyled] = useState(false);

  const selectedVariant = useMemo(() => {
    if (!product) return null;
    return (
      product.variants.find(
        (v) =>
          v.colour_id === colourId &&
          v.size_code === sizeCode &&
          (laces.length === 0 || v.lace_code === laceCode),
      ) ?? null
    );
  }, [product, colourId, sizeCode, laceCode, laces.length]);

  if (!product) {
    return (
      <Section>
        <ErrorState />
      </Section>
    );
  }

  const gallery =
    colourId && product.gallery.some((g) => g.styled_colour_id === colourId)
      ? product.gallery.filter(
          (g) => !g.styled_colour_id || g.styled_colour_id === colourId,
        )
      : product.gallery;
  // Fall back to the cover image when the product has no gallery rows yet, so
  // the media rail is never blank.
  const galleryImages =
    gallery.length > 0
      ? gallery
      : product.cover_image_url
        ? [{ url: product.cover_image_url, alt_text: product.name }]
        : [];

  // Videos follow the same swatch scoping as pictures: base-product videos
  // (styled_colour_id null) always show; a colour's own video shows only while
  // that colour is selected.
  const galleryVideos = product.videos.filter(
    (v) => !v.styled_colour_id || v.styled_colour_id === colourId,
  );

  const price = priceOfVariant(
    product,
    selectedVariant?.styled_variant_id ?? null,
    unstyled,
    currency,
  );

  // Head-size video: YouTube URLs get the lazy branded facade player (same
  // engineering as the live sales landing); anything else falls back to a
  // native <video>. Null when the brand set no video for this product.
  const videoUrl = product.size_guide?.video_url ?? null;
  const videoId = videoUrl ? youtubeId(videoUrl) : null;

  async function add() {
    if (!unstyled && !selectedVariant) {
      toast.error(copy.chooseVariantError);
      return;
    }
    setBusy(true);
    try {
      await addCartItem({
        styled_variant_id: selectedVariant?.styled_variant_id,
        unstyled,
        quantity: 1,
        display_currency: currency,
      });
      notifyCartChanged();
      setConfirmPreorder(false);
      toast.success(isPreorder ? copy.preorderAddedToast : copy.addedToast);
    } catch {
      toast.error(copy.addErrorToast);
    } finally {
      setBusy(false);
    }
  }

  // Tap "Add" → validate the variant choice first, then either open the
  // pre-order confirm dialog (out of stock) or add straight to the bag.
  function onAddClick() {
    if (!unstyled && !selectedVariant) {
      toast.error(copy.chooseVariantError);
      return;
    }
    if (isPreorder) {
      setConfirmPreorder(true);
      return;
    }
    void add();
  }

  const Box = ({
    active,
    onClick,
    children,
  }: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
  }) => (
    <button
      onClick={onClick}
      className={`rounded-md border px-3 py-2 text-body-sm transition ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border hover:border-primary"
      }`}
    >
      {children}
    </button>
  );

  return (
    <Section className="grid gap-10 md:grid-cols-2">
      {/* Gallery */}
      <ProductGallery
        images={galleryImages}
        videos={galleryVideos}
        productName={product.name}
      />

      {/* Detail */}
      <div>
        <h1 className="text-h3 font-display">{product.name}</h1>
        <p className="mt-3 font-mono text-h5">
          {price ?? "-"}
        </p>
        {product.social_proof ? (
          <SocialProofBadge proof={product.social_proof} prefix={copy.socialProofPrefix} />
        ) : null}
        {product.short_description ? (
          <p className="mt-4 text-body text-muted-foreground">
            {product.short_description}
          </p>
        ) : null}

        {/* Colour */}
        {colours.length > 0 ? (
          <div className="mt-8">
            <p className="text-caption">{copy.colourLabel}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {colours.map((c) => (
                <button
                  key={c.colour_id}
                  onClick={() => setColourId(c.colour_id)}
                  title={c.name}
                  className={`h-9 w-9 rounded-full border-2 ${colourId === c.colour_id ? "border-primary" : "border-border"}`}
                  style={{ background: c.hex }}
                />
              ))}
            </div>
          </div>
        ) : null}

        {/* Size */}
        {sizes.length > 0 ? (
          <div className="mt-6">
            <p className="text-caption">{copy.sizeLabel}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {sizes.map((s) => (
                <Box
                  key={s.size_code}
                  active={sizeCode === s.size_code}
                  onClick={() => setSizeCode(s.size_code)}
                >
                  {s.label}
                  {s.circumference_in ? (
                    <span className="ml-1 text-muted-foreground">{s.circumference_in}</span>
                  ) : null}
                </Box>
              ))}
            </div>
          </div>
        ) : null}

        {/* Lace */}
        {laces.length > 0 ? (
          <div className="mt-6">
            <p className="text-caption">{copy.laceLabel}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {laces.map((l) => (
                <Box
                  key={l.lace_code}
                  active={laceCode === l.lace_code}
                  onClick={() => setLaceCode(l.lace_code)}
                >
                  {l.label}
                </Box>
              ))}
            </div>
          </div>
        ) : null}

        <label className="mt-6 flex items-center gap-2 text-body-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={unstyled}
            onChange={(e) => setUnstyled(e.target.checked)}
          />
          {copy.unstyledLabel}
        </label>

        <PreorderNotice availability={availability} className="mt-6" />

        <div className="mt-8 flex gap-3">
          <button
            onClick={onAddClick}
            disabled={busy || soldOut}
            className="rounded-full bg-primary px-8 py-3 text-body text-primary-foreground disabled:opacity-60"
          >
            {soldOut
              ? copy.soldOutCta
              : busy
                ? copy.addBusyLabel
                : isPreorder
                  ? copy.preorderCta
                  : copy.addCta}
          </button>
          <button
            onClick={() => navigate({ to: "/cart" })}
            className="rounded-full border border-border px-6 py-3 text-body hover:bg-secondary"
          >
            {copy.viewBagCta}
          </button>
        </div>

        {confirmPreorder ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-6 backdrop-blur-sm"
            onClick={() => setConfirmPreorder(false)}
          >
            <div
              className="w-full max-w-sm rounded-2xl border border-taupe/25 bg-card p-6 text-center shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-[0.62rem] font-medium uppercase tracking-[0.24em] text-taupe">
                Pre-order
              </p>
              <h3 className="mt-2 font-display text-2xl">
                {copy.preorderTitle}
              </h3>
              <p className="mt-3 text-body-sm text-foreground/75">
                {availability?.message ||
                  (availability?.window_label
                    ? `This piece is made to order and ships in about ${availability.window_label}.`
                    : "This piece is made to order and crafted just for you.")}
              </p>
              <div className="mt-6 flex flex-col gap-2">
                <button
                  onClick={add}
                  disabled={busy}
                  className="rounded-full bg-primary px-8 py-3 text-body text-primary-foreground disabled:opacity-60"
                >
                  {busy ? copy.addBusyLabel : copy.preorderConfirm}
                </button>
                <button
                  onClick={() => setConfirmPreorder(false)}
                  className="rounded-full px-6 py-2.5 text-body-sm text-muted-foreground hover:text-foreground"
                >
                  {copy.preorderCancel}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {product.size_guide &&
        (product.size_guide.guide_md || videoUrl) ? (
          <details className="mt-8 border-t border-border pt-4">
            <summary className="cursor-pointer text-body-sm">
              {product.size_guide.title}
            </summary>
            {videoId ? (
              <div className="mt-3">
                <YouTubeFacade
                  videoId={videoId}
                  title={product.size_guide.title || copy.sizeGuideFallbackTitle}
                />
              </div>
            ) : videoUrl ? (
              <video
                src={videoUrl}
                controls
                className="mt-3 max-h-[420px] w-full rounded-md bg-secondary"
              />
            ) : null}
            {product.size_guide.guide_md ? (
              <p className="mt-2 whitespace-pre-wrap text-body-sm text-muted-foreground">
                {product.size_guide.guide_md}
              </p>
            ) : null}
          </details>
        ) : null}
      </div>

      {/* You May Also Love */}
      {product.related_products.length > 0 ? (
        <div className="md:col-span-2 mt-8 border-t border-border pt-12">
          <YouMayAlsoLove products={product.related_products} currency={currency} />
        </div>
      ) : null}

      {/* Reviews */}
      <div className="md:col-span-2 border-t border-border pt-12">
        <ProductReviews slug={product.slug} />
      </div>
    </Section>
  );
}
