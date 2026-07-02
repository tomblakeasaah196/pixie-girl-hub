import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, ShieldAlert, Star } from "lucide-react";
import { publicApi } from "@/lib/api";

/**
 * Public badge verification (§6.26 section B). The QR on every badge card
 * encodes this URL — tier, status and expiry are read live, so revocation
 * and lapses show the instant they happen. This page IS the anti-fake.
 */
export const Route = createFileRoute("/verify/badge/$token")({
  head: () => ({
    meta: [{ title: "Verify a Pixie Girl partner badge" }],
  }),
  component: VerifyBadge,
});

function VerifyBadge() {
  const { token } = Route.useParams();
  const q = useQuery({
    queryKey: ["verify", token],
    queryFn: () => publicApi.verifyBadge(token),
  });

  if (q.isLoading)
    return (
      <div className="mx-auto max-w-md px-5 py-24">
        <div className="glass rounded-xl2 p-8 space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-6 rounded-lg bg-cream/5 animate-pulse" />
          ))}
        </div>
      </div>
    );

  if (q.isError)
    return (
      <div className="mx-auto max-w-md px-5 py-24 text-center">
        <p className="text-danger text-[14px] mb-4">
          We couldn't check this badge right now.
        </p>
        <button className="btn-ghost" onClick={() => q.refetch()}>
          Try again
        </button>
      </div>
    );

  const v = q.data!;

  if (!v.valid)
    return (
      <div className="mx-auto max-w-md px-5 py-24">
        <div className="glass rounded-xl2 p-8 text-center border !border-danger/40">
          <ShieldAlert className="w-10 h-10 mx-auto text-danger mb-4" />
          <h1 className="font-display text-[26px] mb-2">Not a valid badge.</h1>
          <p className="text-[13.5px] text-cream-muted leading-relaxed">
            This badge is revoked, suspended or does not exist. The stylist
            presenting it is <strong>not currently</strong> a certified Pixie
            Girl partner.
          </p>
          <Link to="/stylists" className="btn-ghost no-underline mt-6 inline-flex">
            Find a certified stylist
          </Link>
        </div>
      </div>
    );

  const tierColor = v.tier_color ?? "var(--accent)";
  return (
    <div className="mx-auto max-w-md px-5 py-24">
      <div className="glass rounded-xl2 p-8 text-center">
        <BadgeCheck className="w-10 h-10 mx-auto text-success mb-4" />
        <p className="micro mb-2">Verified Pixie Girl partner</p>
        <h1 className="font-display text-[30px] leading-tight mb-1">
          {v.display_name}
        </h1>
        <p className="font-mono text-[12px] text-cream-faint mb-5">
          {v.partner_code} · {v.city}, {v.country_code}
        </p>

        <div className="flex justify-center gap-2 flex-wrap mb-6">
          {v.tier_label && (
            <span
              className="px-3 py-1.5 rounded-full text-[10.5px] font-bold tracking-[0.16em] uppercase border"
              style={{ borderColor: tierColor, color: "var(--cream)" }}
            >
              {v.tier_label}
            </span>
          )}
          {v.on_probation && (
            <span className="px-3 py-1.5 rounded-full text-[10.5px] font-bold tracking-[0.16em] uppercase border border-warn/50 text-warn">
              Probation
            </span>
          )}
          <span className="px-3 py-1.5 rounded-full text-[10.5px] font-bold tracking-[0.16em] uppercase border border-success/40 text-success">
            {v.status}
          </span>
        </div>

        <div className="text-left space-y-0 text-[13px]">
          {v.rating_count! > 0 && (
            <div className="flex justify-between py-2.5 border-b border-line">
              <span className="micro pt-0.5">Verified rating</span>
              <span className="inline-flex items-center gap-1.5">
                <Star className="w-3.5 h-3.5 text-warn" />
                {Number(v.avg_rating).toFixed(2)} ({v.rating_count})
              </span>
            </div>
          )}
          {v.tier_expires_at && (
            <div className="flex justify-between py-2.5 border-b border-line">
              <span className="micro pt-0.5">Tier valid to</span>
              <span className="tabular-nums">
                {new Date(v.tier_expires_at).toLocaleDateString(undefined, {
                  month: "long",
                  year: "numeric",
                })}
              </span>
            </div>
          )}
          {v.portfolio_url && (
            <div className="flex justify-between py-2.5">
              <span className="micro pt-0.5">Portfolio</span>
              <a
                href={v.portfolio_url}
                target="_blank"
                rel="noreferrer"
                className="text-accent-glow no-underline hover:underline truncate max-w-[220px]"
              >
                {v.portfolio_url.replace(/^https?:\/\//, "")}
              </a>
            </div>
          )}
        </div>

        <p className="text-[11px] text-cream-faint mt-6">
          Checked live against the Pixie Girl Hub — status changes reflect here
          instantly. Ratings come only from customers routed through the
          platform.
        </p>
      </div>
    </div>
  );
}
