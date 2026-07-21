import type { Availability } from "@/lib/storefront";

/** Short label for a pre-order / sold-out state, or null when in stock. */
export function preorderText(a?: Availability | null): string | null {
  if (!a || a.state === "in_stock") return null;
  if (a.state === "out_of_stock") return "Sold out";
  return a.window_label ? `Pre-order · ships in ~${a.window_label}` : "Pre-order";
}

/** Corner pill overlaid on a product card. Renders nothing for in-stock. */
export function AvailabilityPill({
  availability,
}: {
  availability?: Availability | null;
}) {
  if (!availability || availability.state === "in_stock") return null;
  const soldOut = availability.state === "out_of_stock";
  return (
    <span
      className={`pointer-events-none absolute left-3 top-3 z-10 rounded-full px-2.5 py-1 text-[0.55rem] font-medium uppercase tracking-[0.22em] backdrop-blur ${
        soldOut ? "bg-ink/75 text-cream/70" : "bg-taupe/90 text-ink"
      }`}
    >
      {soldOut ? "Sold out" : "Pre-order"}
    </span>
  );
}

/** Inline callout for the product detail, cart and checkout. Nothing in-stock. */
export function PreorderNotice({
  availability,
  className = "",
}: {
  availability?: Availability | null;
  className?: string;
}) {
  if (!availability || availability.state === "in_stock") return null;
  if (availability.state === "out_of_stock") {
    return (
      <div
        className={`rounded-lg border border-border/60 bg-secondary/40 px-4 py-3 text-body-sm text-muted-foreground ${className}`}
      >
        This piece is sold out right now.
      </div>
    );
  }
  const msg =
    availability.message ||
    (availability.window_label
      ? `Made to order — ships in about ${availability.window_label}.`
      : "Made to order — crafted just for you.");
  return (
    <div
      className={`rounded-lg border border-taupe/30 bg-taupe/10 px-4 py-3 ${className}`}
    >
      <span className="text-[0.62rem] font-medium uppercase tracking-[0.22em] text-taupe">
        Pre-order
      </span>
      <p className="mt-1 text-body-sm text-foreground/80">{msg}</p>
    </div>
  );
}
