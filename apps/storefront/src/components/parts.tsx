import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { priceFor, type Currency, type ProductCard } from "@/lib/storefront";

/** Product card — links to the detail page, shows the display-currency price. */
export function ProductCardLink({
  p,
  currency,
}: {
  p: ProductCard;
  currency: Currency;
}) {
  return (
    <Link
      to="/product/$slug"
      params={{ slug: p.slug }}
      className="group block"
    >
      <div className="aspect-[3/4] overflow-hidden rounded-md bg-secondary">
        {p.cover_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.cover_image_url}
            alt={p.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-caption text-muted-foreground">
            No image
          </div>
        )}
      </div>
      <div className="mt-3">
        <h3 className="text-body font-display">{p.name}</h3>
        <p className="mt-1 font-mono text-body-sm text-muted-foreground">
          {priceFor(p, currency)}
        </p>
      </div>
    </Link>
  );
}

export function Section({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mx-auto max-w-6xl px-4 py-10 md:px-6 ${className}`}>
      {children}
    </section>
  );
}

export function LoadingGrid() {
  return (
    <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="animate-pulse">
          <div className="aspect-[3/4] rounded-md bg-secondary" />
          <div className="mt-3 h-4 w-2/3 rounded bg-secondary" />
          <div className="mt-2 h-3 w-1/3 rounded bg-secondary" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  cta,
}: {
  title: string;
  cta?: ReactNode;
}) {
  return (
    <div className="py-20 text-center">
      <p className="text-body text-muted-foreground">{title}</p>
      {cta ? <div className="mt-6">{cta}</div> : null}
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="py-20 text-center">
      <p className="text-body text-destructive">
        Something went wrong loading this page.
      </p>
      {onRetry ? (
        <button
          onClick={onRetry}
          className="mt-6 rounded-full border border-border px-5 py-2 text-body-sm hover:bg-secondary"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
