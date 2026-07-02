import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Link2 } from "lucide-react";
import { portalApi, type ApiError } from "@/lib/api";

/** Two-way earnings (§6.26 Q17): links, clicks, attributed commissions. */
export const Route = createFileRoute("/dashboard/referrals")({
  component: Referrals,
});

const ngn = (v: string | number) => `₦${Number(v).toLocaleString()}`;

function Referrals() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["portal-referrals"],
    queryFn: portalApi.referrals,
  });
  const create = useMutation({
    mutationFn: ([label, path]: [string | undefined, string | undefined]) =>
      portalApi.createReferralLink(label, path),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal-referrals"] }),
  });
  const [label, setLabel] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  if (q.isLoading)
    return <div className="h-48 rounded-xl2 bg-cream/5 animate-pulse" />;
  if (q.isError)
    return (
      <div className="text-center py-16">
        <p className="text-danger text-[14px] mb-4">
          {(q.error as ApiError).userMessage}
        </p>
        <button className="btn-ghost" onClick={() => q.refetch()}>
          Retry
        </button>
      </div>
    );

  const r = q.data!;
  const shareUrl = (code: string) =>
    `${typeof window !== "undefined" ? window.location.origin : ""}/api/public/stylist-programme/r/${code}`;

  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-3 gap-4">
        {[
          ["On hold", r.totals.pending_ngn],
          ["Payable", r.totals.payable_ngn],
          ["Paid", r.totals.paid_ngn],
        ].map(([l, v]) => (
          <div key={l as string} className="glass rounded-xl2 p-5">
            <p className="micro mb-2">{l}</p>
            <p className="font-display text-[24px] tabular-nums">{ngn(v as string)}</p>
          </div>
        ))}
      </div>

      <section>
        <h2 className="micro mb-3">Your links</h2>
        <p className="text-[13px] text-cream-muted mb-4">
          Share a link; when a customer buys Pixie hair through it, your
          commission accrues automatically and rides your normal payout.
        </p>
        <div className="space-y-2 mb-4">
          {r.links.map((l) => (
            <div key={l.link_id} className="glass rounded-xl2 p-4 flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[13px] truncate">{l.code}</p>
                <p className="text-[11.5px] text-cream-faint">
                  {l.label ?? "General"} · {l.clicks} click{l.clicks === 1 ? "" : "s"}
                  {l.target_path && ` · lands on ${l.target_path}`}
                </p>
              </div>
              <button
                className="btn-ghost !py-2 !px-4 !text-[12px]"
                onClick={async () => {
                  await navigator.clipboard.writeText(shareUrl(l.code));
                  setCopied(l.link_id);
                  setTimeout(() => setCopied(null), 1500);
                }}
              >
                <Copy className="w-3.5 h-3.5" />
                {copied === l.link_id ? "Copied!" : "Copy link"}
              </button>
            </div>
          ))}
          {r.links.length === 0 && (
            <p className="text-[12.5px] text-cream-faint">
              No labelled links yet — your partner code works as a referral
              code out of the box; add labelled links to track campaigns.
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <input
            className="input max-w-xs"
            placeholder="Label (e.g. Instagram bio)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button
            className="btn-primary !py-2.5"
            disabled={create.isPending}
            onClick={() =>
              create.mutate([label || undefined, undefined], {
                onSuccess: () => setLabel(""),
              })
            }
          >
            <Link2 className="w-4 h-4" /> New link
          </button>
        </div>
        {create.isError && (
          <p className="text-danger text-[12.5px] mt-2">
            {(create.error as ApiError).userMessage}
          </p>
        )}
      </section>

      <section>
        <h2 className="micro mb-3">Attributed orders</h2>
        {r.attributions.length === 0 ? (
          <p className="text-[12.5px] text-cream-faint">
            Nothing attributed yet — share your link and watch this fill.
          </p>
        ) : (
          <div className="space-y-1.5">
            {r.attributions.map((a) => (
              <div key={a.attribution_id} className="glass rounded-xl2 p-4 flex items-center justify-between gap-4 text-[13px]">
                <div>
                  <p className="font-mono text-[12.5px]">{a.order_number ?? "Order"}</p>
                  <p className="text-[11px] text-cream-faint tabular-nums">
                    {new Date(a.created_at).toLocaleDateString()} · order {ngn(a.order_total_ngn)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-display tabular-nums">{ngn(a.commission_amount_ngn)}</p>
                  <p className={`text-[10px] font-bold uppercase tracking-wider ${a.status === "paid" ? "text-success" : a.status === "payable" ? "text-info" : "text-warn"}`}>
                    {a.status === "pending" ? "on hold" : a.status}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
