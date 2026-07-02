import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { portalApi, type ApiError } from "@/lib/api";

/** Earnings + payout statements (§6.26: "earnings, payout statements"). */
export const Route = createFileRoute("/dashboard/earnings")({
  component: Earnings,
});

const ngn = (v: string | number) => `₦${Number(v).toLocaleString()}`;

function Statement({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["portal-payout", id],
    queryFn: () => portalApi.payout(id),
  });
  const p = q.data;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-5" onClick={onClose}>
      <div className="glass rounded-xl2 p-7 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        {q.isLoading && <div className="h-40 rounded-xl bg-cream/5 animate-pulse" />}
        {p && (
          <>
            <p className="micro mb-1">Payout statement</p>
            <p className="font-display text-[22px] mb-1">{p.payout_number}</p>
            <p className="text-[12px] text-cream-faint mb-5 tabular-nums">
              {new Date(p.period_start).toLocaleDateString()} →{" "}
              {new Date(p.period_end).toLocaleDateString()} · {p.status}
            </p>
            <div className="space-y-1.5 mb-5">
              {(p.lines ?? []).map((l) => (
                <div key={l.line_id} className="flex justify-between gap-4 text-[13px] py-1.5 border-b border-line last:border-0">
                  <span className="text-cream-muted min-w-0 truncate">
                    <span className="micro mr-2">{l.line_kind}</span>
                    {l.description}
                  </span>
                  <span className="font-mono tabular-nums shrink-0">{ngn(l.net_amount)}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between font-display text-[19px]">
              <span>Net paid</span>
              <span className="tabular-nums">{ngn(p.net_amount)}</span>
            </div>
          </>
        )}
        <button className="btn-ghost w-full mt-6" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

function Earnings() {
  const earnings = useQuery({
    queryKey: ["portal-earnings"],
    queryFn: portalApi.earnings,
  });
  const payouts = useQuery({
    queryKey: ["portal-payouts"],
    queryFn: portalApi.payouts,
  });
  const [openId, setOpenId] = useState<string | null>(null);

  if (earnings.isError)
    return (
      <div className="text-center py-16">
        <p className="text-danger text-[14px] mb-4">
          {(earnings.error as ApiError).userMessage}
        </p>
        <button className="btn-ghost" onClick={() => earnings.refetch()}>
          Retry
        </button>
      </div>
    );

  const e = earnings.data;

  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-3 gap-4">
        {[
          ["Payable now", e?.assignments_payable_ngn, "Joins your next payout"],
          ["On quality hold", e?.assignments_on_hold_ngn, "Awaiting confirmation / window"],
          ["Paid out to date", e?.paid_out_ngn, undefined],
        ].map(([label, v, sub]) => (
          <div key={label as string} className="glass rounded-xl2 p-5">
            <p className="micro mb-2">{label}</p>
            <p className="font-display text-[24px] tabular-nums">
              {v !== undefined ? ngn(v as string) : "—"}
            </p>
            {sub && <p className="text-[11px] text-cream-faint mt-1">{sub}</p>}
          </div>
        ))}
      </div>

      {e && (
        <div className="glass rounded-xl2 p-5 text-[13px] flex flex-wrap gap-x-8 gap-y-2">
          <span className="micro pt-1">Referral commission</span>
          <span>On hold {ngn(e.referral_totals.pending_ngn)}</span>
          <span>Payable {ngn(e.referral_totals.payable_ngn)}</span>
          <span>Paid {ngn(e.referral_totals.paid_ngn)}</span>
          <span className="text-cream-faint">
            {e.referral_totals.orders} attributed orders
          </span>
        </div>
      )}

      <section>
        <h2 className="micro mb-3">Payout statements</h2>
        {payouts.isLoading && (
          <div className="h-16 rounded-xl2 bg-cream/5 animate-pulse" />
        )}
        {(payouts.data ?? []).map((p) => (
          <button
            key={p.payout_id}
            className="w-full glass rounded-xl2 p-4 mb-2 flex items-center justify-between gap-4 text-left"
            onClick={() => setOpenId(p.payout_id)}
          >
            <div>
              <p className="font-mono text-[12.5px]">{p.payout_number}</p>
              <p className="text-[11.5px] text-cream-faint tabular-nums">
                {new Date(p.period_start).toLocaleDateString()} →{" "}
                {new Date(p.period_end).toLocaleDateString()}
              </p>
            </div>
            <div className="text-right">
              <p className="font-display tabular-nums">{ngn(p.net_amount)}</p>
              <p className={`text-[10.5px] font-bold uppercase tracking-wider ${p.status === "paid" ? "text-success" : "text-warn"}`}>
                {p.status.replace("_", " ")}
              </p>
            </div>
          </button>
        ))}
        {payouts.data && payouts.data.length === 0 && (
          <div className="text-center py-14">
            <Wallet className="w-7 h-7 mx-auto text-cream-faint mb-3" />
            <p className="text-[13px] text-cream-muted">
              No payouts yet — payable work rolls into your first batch.
            </p>
          </div>
        )}
      </section>

      {openId && <Statement id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
