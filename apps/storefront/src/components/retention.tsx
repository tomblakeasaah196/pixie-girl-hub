/**
 * Storefront retention surface (§6.23) — the shopper's own loyalty, referral
 * code, and rewards, shown on the account page. Self-contained: fetches its
 * data client-side (the customer access token is already in memory after the
 * account page's auth bootstrap) and refreshes after a redemption.
 */

import { useEffect, useState, useCallback } from "react";
import {
  getLoyalty,
  getReferral,
  getRewards,
  redeemReward,
  type LoyaltyStatus,
  type ReferralInfo,
  type RewardItem,
} from "@/lib/auth";
import { fmt } from "@/lib/storefront";

export function RetentionPanel() {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [loyalty, setLoyalty] = useState<LoyaltyStatus | null>(null);
  const [referral, setReferral] = useState<ReferralInfo | null>(null);
  const [rewards, setRewards] = useState<RewardItem[]>([]);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [voucher, setVoucher] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [l, ref, rw] = await Promise.all([getLoyalty(), getReferral(), getRewards()]);
      setLoyalty(l);
      setReferral(ref);
      setRewards(rw);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onRedeem(r: RewardItem) {
    setRedeeming(r.reward_id);
    setNotice(null);
    setVoucher(null);
    try {
      const res = await redeemReward(r.reward_id);
      if (res.voucher_code) {
        setVoucher(res.voucher_code);
      } else {
        setNotice("Reward redeemed — our team will be in touch to arrange it.");
      }
      const [l, rw] = await Promise.all([getLoyalty(), getRewards()]);
      setLoyalty(l);
      setRewards(rw);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Couldn't redeem that reward.");
    } finally {
      setRedeeming(null);
    }
  }

  if (state === "loading") {
    return <p className="mt-6 text-body-sm text-muted-foreground">Loading your rewards…</p>;
  }
  if (state === "error" || !loyalty) return null; // account page still renders orders

  const balance = loyalty.balance;

  return (
    <div className="mt-8 space-y-6">
      {/* Loyalty */}
      <div className="rounded-lg border border-border p-5">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-caption">Loyalty</p>
            <p className="mt-1 font-mono text-h4">{balance.toLocaleString()} pts</p>
          </div>
          {loyalty.tier ? (
            <span className="rounded-full bg-secondary px-3 py-1 text-body-sm">{loyalty.tier.name}</span>
          ) : null}
        </div>
        {loyalty.next_tier ? (
          <p className="mt-3 text-body-sm text-muted-foreground">
            {loyalty.next_tier.points_to_go.toLocaleString()} pts to {loyalty.next_tier.name}
          </p>
        ) : null}
        {loyalty.ledger.length > 0 ? (
          <ul className="mt-4 divide-y divide-border">
            {loyalty.ledger.map((e, i) => (
              <li key={i} className="flex items-center justify-between py-2 text-body-sm">
                <span className="text-muted-foreground">
                  {e.notes || e.transaction_type.replace(/_/g, " ")}
                </span>
                <span className={`font-mono ${e.points < 0 ? "text-muted-foreground" : ""}`}>
                  {e.points > 0 ? "+" : ""}
                  {e.points}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* Referral */}
      {referral ? (
        <div className="rounded-lg border border-border p-5">
          <p className="text-caption">Refer a friend</p>
          <p className="mt-1 text-body-sm text-muted-foreground">
            Share your code — you both get rewarded when they shop.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <code className="rounded-md bg-secondary px-3 py-1.5 font-mono text-body">{referral.referral_code}</code>
            <CopyButton value={referral.referral_code} />
          </div>
          {referral.successful_count > 0 ? (
            <p className="mt-3 text-body-sm text-muted-foreground">
              {referral.successful_count} friend{referral.successful_count === 1 ? "" : "s"} referred so far.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Rewards */}
      {rewards.length > 0 ? (
        <div className="rounded-lg border border-border p-5">
          <p className="text-caption">Redeem your points</p>
          {voucher ? (
            <div className="mt-3 rounded-md border border-border bg-secondary p-3">
              <p className="text-body-sm">Your voucher code — apply it at checkout:</p>
              <code className="mt-1 block font-mono text-h5">{voucher}</code>
            </div>
          ) : null}
          {notice ? <p className="mt-3 text-body-sm text-muted-foreground">{notice}</p> : null}
          <ul className="mt-4 divide-y divide-border">
            {rewards.map((r) => {
              const affordable = balance >= r.points_cost;
              return (
                <li key={r.reward_id} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-body">{r.display_name}</p>
                    <p className="text-body-sm text-muted-foreground">
                      {r.points_cost.toLocaleString()} pts
                      {r.reward_type === "order_discount" && r.discount_value != null
                        ? r.discount_type === "percentage"
                          ? ` · ${Math.round(r.discount_value * 100)}% off`
                          : ` · ${fmt(String(r.discount_value), "NGN")} off`
                        : r.reward_type === "free_shipping"
                          ? " · free shipping"
                          : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => onRedeem(r)}
                    disabled={!affordable || redeeming === r.reward_id}
                    className="shrink-0 rounded-full bg-primary px-4 py-1.5 text-body-sm text-primary-foreground disabled:opacity-40"
                  >
                    {redeeming === r.reward_id ? "Redeeming…" : affordable ? "Redeem" : "Not enough"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable — no-op */
        }
      }}
      className="rounded-full border border-border px-4 py-1.5 text-body-sm hover:bg-secondary"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
