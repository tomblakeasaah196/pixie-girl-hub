import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  addCartItem,
  fmt,
  type ProductDetail,
  type Currency,
} from "@/lib/storefront";
import { ssrProduct } from "@/lib/server";
import { useCurrency, notifyCartChanged } from "@/lib/useStore";
import { Section, ErrorState } from "@/components/parts";

export const Route = createFileRoute("/product/$slug")({
  loader: async ({ params }) => ssrProduct({ data: { slug: params.slug } }),
  component: ProductPage,
});

function priceOfVariant(
  p: ProductDetail,
  variantId: string | null,
  unstyled: boolean,
  currency: Currency,
): number | null {
  if (unstyled) {
    const raw =
      currency === "USD" ? p.retail_price_usd : p.retail_price_ngn;
    return raw == null ? null : Number(raw);
  }
  const v = p.variants.find((x) => x.styled_variant_id === variantId);
  if (!v) return null;
  const raw = currency === "USD" ? v.effective_price_usd : v.effective_price_ngn;
  return raw == null ? null : Number(raw);
}

function ProductPage() {
  const { product } = Route.useLoaderData();
  const [currency] = useCurrency();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

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
  const hero = gallery[0]?.url || product.cover_image_url || null;

  const price = priceOfVariant(
    product,
    selectedVariant?.styled_variant_id ?? null,
    unstyled,
    currency,
  );

  async function add() {
    if (!unstyled && !selectedVariant) {
      toast.error("Please choose colour, size and lace.");
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
      toast.success("Added to bag");
    } catch {
      toast.error("Couldn't add to bag. Please try again.");
    } finally {
      setBusy(false);
    }
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
      <div>
        <div className="aspect-[3/4] overflow-hidden rounded-md bg-secondary">
          {hero ? (
            <img src={hero} alt={product.name} className="h-full w-full object-cover" />
          ) : null}
        </div>
        {gallery.length > 1 ? (
          <div className="mt-3 grid grid-cols-5 gap-2">
            {gallery.slice(0, 5).map((g, i) => (
              <div key={i} className="aspect-square overflow-hidden rounded bg-secondary">
                <img src={g.url} alt="" className="h-full w-full object-cover" />
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Detail */}
      <div>
        <h1 className="text-h3 font-display">{product.name}</h1>
        <p className="mt-3 font-mono text-h5">
          {price == null ? "—" : fmt(price, currency)}
        </p>
        {product.short_description ? (
          <p className="mt-4 text-body text-muted-foreground">
            {product.short_description}
          </p>
        ) : null}

        {/* Colour */}
        {colours.length > 0 ? (
          <div className="mt-8">
            <p className="text-caption">Colour</p>
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
            <p className="text-caption">Cap size</p>
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
            <p className="text-caption">Lace</p>
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
          Buy unstyled (raw)
        </label>

        <div className="mt-8 flex gap-3">
          <button
            onClick={add}
            disabled={busy}
            className="rounded-full bg-primary px-8 py-3 text-body text-primary-foreground disabled:opacity-60"
          >
            {busy ? "Adding…" : "Add to bag"}
          </button>
          <button
            onClick={() => navigate({ to: "/cart" })}
            className="rounded-full border border-border px-6 py-3 text-body hover:bg-secondary"
          >
            View bag
          </button>
        </div>

        {product.size_guide ? (
          <details className="mt-8 border-t border-border pt-4">
            <summary className="cursor-pointer text-body-sm">
              {product.size_guide.title}
            </summary>
            {product.size_guide.guide_md ? (
              <p className="mt-2 whitespace-pre-wrap text-body-sm text-muted-foreground">
                {product.size_guide.guide_md}
              </p>
            ) : null}
          </details>
        ) : null}
      </div>
    </Section>
  );
}
