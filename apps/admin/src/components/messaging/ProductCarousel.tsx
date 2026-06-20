import { Package, ShoppingBag, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ProductCard } from "@/lib/smartcomm-types";

const ngn = (v: string | number | null | undefined) =>
  v == null ? "" : `₦${Number(v).toLocaleString()}`;

/** Horizontally scrollable carousel of product/service cards inside a bubble. */
export function ProductCarousel({
  intro,
  products,
  isOwn,
}: {
  intro?: string;
  products: ProductCard[];
  isOwn: boolean;
}) {
  return (
    <div className="space-y-2 mb-1 min-w-[260px]">
      <div className="flex items-center gap-1 text-[11px] opacity-80">
        <ShoppingBag className="w-3 h-3" /> Shared {products.length}{" "}
        {products.length === 1 ? "item" : "items"}
      </div>
      {intro && (
        <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed">
          {intro}
        </p>
      )}
      <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1 snap-x snap-mandatory">
        {products.map((p) => (
          <div
            key={`${p.kind}-${p.id}`}
            className={cn(
              "snap-start shrink-0 w-40 rounded-lg overflow-hidden border",
              isOwn ? "border-bg/25 bg-bg/10" : "hairline bg-panel",
            )}
          >
            <div className="aspect-square bg-panel-2 grid place-items-center text-text-faint relative">
              {p.image_url ? (
                <img
                  src={p.image_url}
                  alt={p.name}
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover"
                />
              ) : (
                <Package className="w-6 h-6" />
              )}
              <span
                className={cn(
                  "absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-full text-[9px] uppercase tracking-wide",
                  isOwn ? "bg-bg/30 text-bg" : "bg-panel/90 text-text-muted",
                )}
              >
                {p.kind}
              </span>
            </div>
            <div className="p-2">
              <div className="text-[12px] font-medium line-clamp-2">
                {p.name}
              </div>
              {p.price != null && (
                <div
                  className={cn(
                    "text-[11.5px] font-mono mt-0.5",
                    isOwn ? "text-bg/80" : "text-accent-glow",
                  )}
                >
                  {ngn(p.price)}
                </div>
              )}
              {p.capture_url ? (
                <a
                  href={p.capture_url}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    "mt-1.5 flex items-center justify-center gap-1 rounded-md py-1.5 text-[11px] font-medium transition-colors",
                    isOwn
                      ? "bg-bg/25 text-bg hover:bg-bg/35"
                      : "bg-accent text-bg hover:bg-accent-glow",
                  )}
                >
                  Tap to order <ChevronRight className="w-3 h-3" />
                </a>
              ) : (
                <div className="mt-1.5 text-center text-[10px] text-text-faint">
                  Browse only
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
