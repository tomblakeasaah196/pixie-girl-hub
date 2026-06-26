import { Link, useNavigate } from "@tanstack/react-router";
import { Heart } from "lucide-react";
import { Reveal } from "@/components/site/Reveal";
import { Price } from "@/components/site/Price";
import { useCart } from "@/lib/cart";
import { useAuth } from "@/lib/auth";
import { useWishlist } from "@/lib/wishlist";
import type { Product } from "@/lib/products";

export function ProductCard({ product, index = 0 }: { product: Product; index?: number }) {
  const { add } = useCart();
  const { user } = useAuth();
  const { isSaved, toggle } = useWishlist();
  const navigate = useNavigate();
  const saved = isSaved(product.slug);

  function onHeart(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!user) return navigate({ to: "/auth" });
    toggle.mutate({ slug: product.slug, on: !saved });
  }

  return (
    <Reveal as="article" index={index} className="group">
      <Link to="/product/$slug" params={{ slug: product.slug }} className="block">
        <div className="relative aspect-[4/5] overflow-hidden bg-card mb-5">
          <img src={product.images[0]} alt={product.name} loading="lazy" className="absolute inset-0 w-full h-full object-cover transition-opacity duration-700 group-hover:opacity-0" />
          <img src={product.images[1] ?? product.images[0]} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-0 transition-opacity duration-700 group-hover:opacity-100 scale-[1.02]" />
          <button
            onClick={onHeart}
            aria-label={saved ? "Remove from saved" : "Save piece"}
            className={`absolute top-4 right-4 w-10 h-10 grid place-items-center rounded-full backdrop-blur-md transition-all ${
              saved ? "bg-burgundy/80 text-cream" : "bg-ink/40 text-cream hover:bg-ink/70"
            }`}
          >
            <Heart className="w-4 h-4" fill={saved ? "currentColor" : "none"} />
          </button>
          <button
            onClick={(e) => {
              e.preventDefault();
              add({
                slug: product.slug,
                name: product.name,
                image: product.images[0],
                price: product.price,
                variant: `${product.lengths[0]} · ${product.lace[0]} · Size ${product.headSizes[0]}`,
              });
            }}
            className="absolute bottom-4 inset-x-4 py-3 bg-cream text-ink text-[0.65rem] tracking-[0.4em] uppercase opacity-0 translate-y-4 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-500 hover:bg-taupe"
          >
            Quick add · <Price usd={product.price} slug={product.slug} />
          </button>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h3 className="font-display text-2xl text-cream group-hover:text-taupe transition-colors">{product.name}</h3>
            <p className="text-xs text-muted-foreground mt-1">{product.tagline}</p>
          </div>
          <Price usd={product.price} slug={product.slug} className="text-sm text-taupe whitespace-nowrap" />
        </div>
      </Link>
    </Reveal>
  );
}
