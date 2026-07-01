import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getContentPost } from "@/lib/storefront";

export const Route = createFileRoute("/policies/$slug")({
  head: () => ({ meta: [{ title: "Policy — Faitlyn Hair" }] }),
  component: PolicyPage,
});

const TITLES: Record<string, string> = {
  privacy: "Privacy Policy",
  terms: "Terms of Service",
  returns: "Returns & Refunds",
  shipping: "Shipping Policy",
  cancellation: "Cancellation Policy",
};

// Fallback body for the cancellation policy (matches the reference) until a
// content post is published in the Hub.
function CancellationBody() {
  return (
    <div className="mt-12 space-y-10 text-cream/80 leading-relaxed">
      <section>
        <h2 className="font-display text-2xl text-cream mb-3">1. Cancellation windows</h2>
        <ul className="space-y-2 list-disc list-inside marker:text-taupe">
          <li><strong className="text-cream">Inquiry &amp; Confirmed</strong> — full cancellation, no obligation.</li>
          <li><strong className="text-cream">Preparing</strong> — cancellation accepted, but a 20% atelier fee may apply where materials have been cut or dyed.</li>
          <li><strong className="text-cream">Shipped &amp; Delivered</strong> — no longer eligible for cancellation. Please refer to our Returns policy.</li>
        </ul>
      </section>
      <section>
        <h2 className="font-display text-2xl text-cream mb-3">2. How a cancellation is processed</h2>
        <p>Submitting a cancellation moves your order into <em>cancellation requested</em> and notifies your concierge. A response is provided within 24 hours, after which the status transitions to <em>cancelled</em> (or back to its previous stage if the request is withdrawn).</p>
      </section>
      <section>
        <h2 className="font-display text-2xl text-cream mb-3">3. Bespoke &amp; limited drops</h2>
        <p>Pieces from limited drops or custom commissions are made-to-order. Once production begins (status <em>preparing</em>), the atelier fee above is applied to cover hand-finishing labour already invested.</p>
      </section>
      <section>
        <h2 className="font-display text-2xl text-cream mb-3">4. Refunds</h2>
        <p>Refunds are issued to the original payment method within 5–10 business days of cancellation confirmation. Concierge inquiries that never proceeded to payment incur no charges.</p>
      </section>
      <section>
        <h2 className="font-display text-2xl text-cream mb-3">5. Questions</h2>
        <p>Reach the concierge at <a className="text-taupe underline" href="mailto:concierge@faitlynhair.com">concierge@faitlynhair.com</a> for anything outside the windows above. We treat each commission as a relationship.</p>
      </section>
    </div>
  );
}

function PolicyPage() {
  const { slug } = Route.useParams();
  const { data } = useQuery({
    queryKey: ["policy", slug],
    queryFn: () => getContentPost("policy", slug),
    retry: false,
  });
  const title = data?.title || TITLES[slug] || slug.replace(/-/g, " ");

  return (
    <main className="min-h-screen bg-ink text-cream pt-32 md:pt-28 pb-24 px-6">
      <article className="mx-auto max-w-3xl">
        <p className="text-[0.62rem] tracking-[0.5em] uppercase text-taupe">Atelier policy</p>
        <h1 className="font-display text-5xl md:text-6xl mt-3 leading-[1.05] capitalize">{title}</h1>
        <p className="mt-6 text-sm text-cream/55">
          Last updated {new Date().toLocaleDateString(undefined, { dateStyle: "long" })}
        </p>

        {data?.body_html ? (
          <div className="prose mt-12 max-w-none text-cream/80" dangerouslySetInnerHTML={{ __html: data.body_html }} />
        ) : data?.body_md ? (
          <p className="mt-12 whitespace-pre-wrap text-cream/80 leading-relaxed">{data.body_md}</p>
        ) : slug === "cancellation" ? (
          <CancellationBody />
        ) : (
          <p className="mt-12 text-cream/70 leading-relaxed">
            This policy will be published shortly. For any questions in the
            meantime, please reach our concierge.
          </p>
        )}

        <div className="mt-16 border-t border-taupe/15 pt-8">
          <Link to="/account" className="text-[0.62rem] tracking-[0.4em] uppercase text-taupe hover:text-cream transition-colors">
            ← Back to account
          </Link>
        </div>
      </article>
    </main>
  );
}
