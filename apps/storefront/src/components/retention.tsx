/**
 * Storefront account retention surface (§6.23). Cutover: the shopper's Crowns
 * 👑 wallet (balance, tier, streaks, ways to earn, vouchers) plus their referral
 * code. The legacy loyalty-points balance + points-redemption catalogue are
 * retired — Crowns are status-only, so there is nothing to "spend".
 */

import { useEffect, useState } from "react";
import { getReferral, type ReferralInfo } from "@/lib/auth";
import { CrownWallet } from "./crowns";

export function RetentionPanel() {
  const [referral, setReferral] = useState<ReferralInfo | null>(null);

  useEffect(() => {
    let active = true;
    getReferral()
      .then((r) => active && setReferral(r))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return (
    <div>
      <CrownWallet />
      {referral ? (
        <div className="mt-6 rounded-lg border border-border p-5">
          <p className="text-caption">Refer a friend</p>
          <p className="mt-1 text-body-sm text-muted-foreground">
            Share your code — you both get rewarded when they shop, and you earn
            Crowns 👑.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <code className="rounded-md bg-secondary px-3 py-1.5 font-mono text-body">
              {referral.referral_code}
            </code>
            <CopyButton value={referral.referral_code} />
          </div>
          {referral.successful_count > 0 ? (
            <p className="mt-3 text-body-sm text-muted-foreground">
              {referral.successful_count} friend
              {referral.successful_count === 1 ? "" : "s"} referred so far.
            </p>
          ) : null}
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
