import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { usePageSlots, withSlots } from "@/lib/site-config";
import { Section } from "@/components/parts";
import type { PreorderNoticeData } from "@/lib/storefront";

export const Route = createFileRoute("/checkout/thank-you")({
  validateSearch: (s: Record<string, unknown>) => ({
    order_id: typeof s.order_id === "string" ? s.order_id : undefined,
    ref: typeof s.ref === "string" ? s.ref : undefined,
    token: typeof s.token === "string" ? s.token : undefined,
  }),
  component: ThankYou,
});

function ThankYou() {
  const { token } = Route.useSearch();
  // Pre-order (000086): the checkout stashed the notice before redirecting to
  // the gateway — pick it up once, show it, then clear it.
  const [preorder, setPreorder] = useState<PreorderNoticeData | null>(null);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("pgh_preorder");
      if (raw) {
        setPreorder(JSON.parse(raw) as PreorderNoticeData);
        sessionStorage.removeItem("pgh_preorder");
      }
    } catch {
      /* storage unavailable */
    }
  }, []);
  const s = withSlots(
    {
      heading: "Thank you",
      body: "Your order has been received. A confirmation is on its way to your email, and we've started preparing your order.",
      trackCta: "Track your order",
      continueCta: "Continue shopping",
    },
    usePageSlots("checkout_thank_you"),
  );
  return (
    <Section className="max-w-xl text-center">
      <CheckCircle2 className="mx-auto text-gold" size={48} />
      <h1 className="mt-6 text-h3 font-display">{s.heading}</h1>
      <p className="mt-3 text-body text-muted-foreground">{s.body}</p>
      {preorder?.is_preorder ? (
        <div className="mt-6 rounded-lg border border-taupe/30 bg-taupe/10 px-4 py-3 text-left">
          <span className="text-[0.62rem] font-medium uppercase tracking-[0.22em] text-taupe">
            Pre-order
          </span>
          <p className="mt-1 text-body-sm text-foreground/80">
            {preorder.message ||
              (preorder.window_label
                ? `Some of your items are made to order and ship in about ${preorder.window_label}. We'll keep you posted.`
                : "Some of your items are made to order. We'll keep you posted as they're crafted.")}
          </p>
        </div>
      ) : null}
      <div className="mt-8 flex justify-center gap-3">
        {token ? (
          <Link
            to="/track/$token"
            params={{ token }}
            className="rounded-full bg-primary px-6 py-2.5 text-body-sm text-primary-foreground"
          >
            {s.trackCta}
          </Link>
        ) : null}
        <Link
          to="/shop"
          className="rounded-full border border-border px-6 py-2.5 text-body-sm hover:bg-secondary"
        >
          {s.continueCta}
        </Link>
      </div>
    </Section>
  );
}
