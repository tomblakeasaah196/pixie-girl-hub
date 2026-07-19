import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import { usePageSlots, withSlots } from "@/lib/site-config";
import { Section } from "@/components/parts";

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
