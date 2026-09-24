import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { usePageSlots, withSlots } from "@/lib/site-config";
import { Section } from "@/components/parts";
import type { PreorderNoticeData } from "@/lib/storefront";
import { CareDeliveryNotice } from "@/components/care";

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
  // Care & Accessories (PR 2/3): the checkout stashed the delivery disclosure
  // so the confirmation repeats it wherever the order's delivery amount shows.
  const [careNotice, setCareNotice] = useState<string | null>(null);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("pgh_preorder");
      if (raw) {
        setPreorder(JSON.parse(raw) as PreorderNoticeData);
        sessionStorage.removeItem("pgh_preorder");
      }
      const notice = sessionStorage.getItem("pgh_care_notice");
      if (notice) {
        setCareNotice(notice);
        sessionStorage.removeItem("pgh_care_notice");
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
      {careNotice ? (
        <div className="mt-6 rounded-lg border border-taupe/30 bg-taupe/10 px-4 py-3 text-left">
          <span className="text-[0.62rem] font-medium uppercase tracking-[0.22em] text-taupe">
            Delivery
          </span>
          <CareDeliveryNotice
            notice={careNotice}
            className="mt-1.5 text-[0.68rem] leading-relaxed text-foreground/85"
          />
          <p className="mt-1.5 text-body-sm text-foreground/70">
            If your order is being delivered, our team will confirm the final
            delivery fee with you before it ships — you'll never be charged an
            unagreed amount.
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
