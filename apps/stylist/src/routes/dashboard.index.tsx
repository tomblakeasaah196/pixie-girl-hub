import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Star } from "lucide-react";
import { portalApi } from "@/lib/api";

/** Overview: the numbers a partner actually checks daily. */
export const Route = createFileRoute("/dashboard/")({
  component: Overview,
});

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="glass rounded-xl2 p-5 border-l-[3px]" style={{ borderLeftColor: "var(--accent)" }}>
      <p className="micro mb-2">{label}</p>
      <p className="font-display text-[26px] tabular-nums leading-none">{value}</p>
      {sub && <p className="text-[11px] text-cream-faint mt-1.5">{sub}</p>}
    </div>
  );
}

const ngn = (v: string | number) => `₦${Number(v).toLocaleString()}`;

function Overview() {
  const me = useQuery({ queryKey: ["portal-me"], queryFn: portalApi.me });
  const earnings = useQuery({
    queryKey: ["portal-earnings"],
    queryFn: portalApi.earnings,
  });
  const offers = useQuery({
    queryKey: ["portal-offers"],
    queryFn: portalApi.offers,
  });

  const e = earnings.data;
  const p = me.data;

  return (
    <div className="space-y-6">
      {offers.data && offers.data.length > 0 && (
        <Link
          to="/dashboard/offers"
          className="flex items-center justify-between glass rounded-xl2 p-5 no-underline border !border-accent/50"
        >
          <div>
            <p className="font-display text-[18px]">
              {offers.data.length} open offer{offers.data.length === 1 ? "" : "s"} waiting
            </p>
            <p className="text-[12.5px] text-cream-muted">
              First to accept wins — offers expire.
            </p>
          </div>
          <ArrowRight className="w-5 h-5 text-accent-glow" />
        </Link>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi
          label="Payable now"
          value={e ? ngn(e.assignments_payable_ngn) : "—"}
          sub="Confirmed or hold lapsed"
        />
        <Kpi
          label="On quality hold"
          value={e ? ngn(e.assignments_on_hold_ngn) : "—"}
          sub="Releases on customer confirmation"
        />
        <Kpi
          label="Referral earnings"
          value={
            e
              ? ngn(
                  Number(e.referral_totals.payable_ngn) +
                    Number(e.referral_totals.pending_ngn),
                )
              : "—"
          }
          sub={e ? `${e.referral_totals.orders} attributed orders` : undefined}
        />
        <Kpi label="Paid out to date" value={e ? ngn(e.paid_out_ngn) : "—"} />
      </div>

      {p && (
        <div className="glass rounded-xl2 p-5 flex flex-wrap items-center gap-x-8 gap-y-3 text-[13px]">
          <span className="inline-flex items-center gap-1.5">
            <Star className="w-4 h-4 text-warn" />
            {p.rating_count > 0
              ? `${Number(p.avg_rating).toFixed(2)} verified (${p.rating_count})`
              : "No verified reviews yet"}
          </span>
          <span className="text-cream-muted">
            Capacity {p.current_active_count}/{p.max_active_assignments} jobs
          </span>
          {p.current_tier_expires_at && (
            <span className="text-cream-muted">
              Tier valid to{" "}
              {new Date(p.current_tier_expires_at).toLocaleDateString(undefined, {
                month: "short",
                year: "numeric",
              })}
            </span>
          )}
          {!p.contract_signed_at && (
            <Link
              to="/dashboard/contract"
              className="text-accent-glow no-underline hover:underline font-semibold"
            >
              Contract awaiting signature →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
