import { ProductCardLink } from "@/components/parts";
import { usePageSlots, withSlots } from "@/lib/site-config";
import type { Currency, ProductCard } from "@/lib/storefront";

/** "You May Also Love" — curated + auto-filled related products (see
 *  storefront.repo.js#listRelatedProducts). Renders nothing when the product
 *  has no live related items rather than showing an empty section. */
export function YouMayAlsoLove({
  products,
  currency,
}: {
  products: ProductCard[];
  currency: Currency;
}) {
  const copy = withSlots(
    { relatedHeading: "You May Also Love" },
    usePageSlots("product_detail"),
  );

  if (!products || products.length === 0) return null;

  return (
    <div>
      <h2 className="text-h4 font-display">{copy.relatedHeading}</h2>
      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
        {products.slice(0, 8).map((p) => (
          <ProductCardLink key={p.styled_id} p={p} currency={currency} />
        ))}
      </div>
    </div>
  );
}
