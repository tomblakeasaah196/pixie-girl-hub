/**
 * Storefront Crowns 👑 (§6.23 unified economy). Two surfaces:
 *   • CrownWallet   — the signed-in shopper's account wallet: balance, tier +
 *     progress, live streaks with a weekly check-in, ways to earn (with one-tap
 *     honor actions + a proof form for manual ones), active vouchers, history,
 *     and share. Crowns are status-only — earned, never spent.
 *   • CrownProgramme — the public tier ladder + ways to earn for the /crowns
 *     marketing page (works logged-out).
 */

import { useCallback, useEffect, useState } from "react";
import {
  getCrownWallet,
  getCrownProgramme,
  submitCrownAction,
  crownCheckIn,
  type CrownWallet as Wallet,
  type CrownProgramme as Programme,
  type CrownEarnRulePublic,
  type CrownWalletStreak,
} from "@/lib/crowns";

const STREAK_LABEL: Record<string, string> = {
  purchase_monthly: "Monthly purchase streak",
  engagement_weekly: "Weekly check-in streak",
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong — please try again.";
}

function earnLine(r: CrownEarnRulePublic): string {
  if (r.crowns_mode === "per_currency" && r.unit_currency_per_crown)
    return `1👑 per ₦${r.unit_currency_per_crown.toLocaleString()}`;
  return `${r.crown_value}👑`;
}

// ── Account wallet ─────────────────────────────────────────
export function CrownWallet() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [programme, setProgramme] = useState<Programme | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [proof, setProof] = useState("");

  const load = useCallback(async () => {
    try {
      const [w, p] = await Promise.all([getCrownWallet(), getCrownProgramme()]);
      setWallet(w);
      setProgramme(p);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3500);
  };

  async function doCheckIn() {
    setBusy("checkin");
    try {
      await crownCheckIn();
      flash("Checked in — streak kept alive 🔥");
      await load();
    } catch (e) {
      flash(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function doHonor(ruleKey: string) {
    setBusy(ruleKey);
    try {
      const r = await submitCrownAction({ rule_key: ruleKey });
      flash(r.status === "auto_approved" ? "Crowns added 👑" : "Submitted for review.");
      await load();
    } catch (e) {
      flash(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function doManual(ruleKey: string) {
    setBusy(ruleKey);
    try {
      await submitCrownAction({ rule_key: ruleKey, proof_url: proof || undefined });
      flash("Submitted — we'll review and add your Crowns.");
      setOpenForm(null);
      setProof("");
      await load();
    } catch (e) {
      flash(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function share() {
    const url = typeof window !== "undefined" ? `${window.location.origin}/crowns` : "/crowns";
    const text = wallet?.tier
      ? `I'm a ${wallet.tier.name} with ${wallet.balance}👑 in Crowns rewards!`
      : "Join the Crowns rewards programme!";
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: "Crowns", text, url });
      } else if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        flash("Link copied — share it with your friends!");
      }
    } catch {
      /* share cancelled — no-op */
    }
  }

  if (state === "loading")
    return <p className="mt-6 text-body-sm text-muted-foreground">Loading your Crowns…</p>;
  if (state === "error" || !wallet) return null;

  const nextTier = wallet.next_tier;
  const pct =
    nextTier && wallet.lifetime_earned + nextTier.crowns_to_go > 0
      ? Math.round(
          (wallet.lifetime_earned / (wallet.lifetime_earned + nextTier.crowns_to_go)) * 100,
        )
      : 100;

  return (
    <div className="mt-8 space-y-6">
      {toast ? (
        <div
          role="status"
          className="rounded-lg border border-border bg-secondary px-4 py-2.5 text-body-sm"
        >
          {toast}
        </div>
      ) : null}

      {/* Balance + tier */}
      <div className="rounded-lg border border-border p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-caption">Crowns</p>
            <p className="mt-1 font-mono text-h4">{wallet.balance.toLocaleString()}👑</p>
            <p className="mt-1 text-body-sm text-muted-foreground">
              {wallet.tier
                ? wallet.tier.lifetime_discount_pct > 0
                  ? `${wallet.tier.name} · ${wallet.tier.lifetime_discount_pct}% off, always`
                  : wallet.tier.name
                : "Member — earn to reach your first tier"}
            </p>
          </div>
          <button
            onClick={share}
            className="shrink-0 rounded-full border border-border px-4 py-1.5 text-body-sm hover:bg-secondary"
          >
            Share
          </button>
        </div>
        {nextTier ? (
          <div className="mt-4">
            <div className="flex justify-between text-body-sm text-muted-foreground">
              <span>To {nextTier.name}</span>
              <span className="font-mono">{nextTier.crowns_to_go.toLocaleString()}👑 to go</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary">
              <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
          </div>
        ) : null}
      </div>

      {/* Streaks */}
      {wallet.streaks.length > 0 ? (
        <div className="rounded-lg border border-border p-5">
          <p className="text-caption">Your streaks</p>
          <ul className="mt-3 space-y-3">
            {wallet.streaks.map((s) => (
              <StreakRow
                key={s.streak_type}
                streak={s}
                busy={busy === "checkin"}
                onCheckIn={s.streak_type === "engagement_weekly" ? doCheckIn : undefined}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {/* Active vouchers */}
      {wallet.vouchers.length > 0 ? (
        <div className="rounded-lg border border-border p-5">
          <p className="text-caption">Your rewards</p>
          <ul className="mt-3 space-y-2">
            {wallet.vouchers.map((v, i) => (
              <li key={i} className="flex items-center justify-between text-body-sm">
                <span>
                  {v.grant_type === "next_purchase_discount"
                    ? `${v.discount_pct}% off your next purchase`
                    : "Free shipping on your next order"}
                  {v.tier_name ? ` · ${v.tier_name}` : ""}
                </span>
                <span className="rounded-full bg-secondary px-3 py-1 text-caption">
                  Your reward
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Ways to earn */}
      {programme && programme.earn_rules.length > 0 ? (
        <div className="rounded-lg border border-border p-5">
          <p className="text-caption">Earn more Crowns</p>
          <ul className="mt-3 divide-y divide-border">
            {programme.earn_rules.map((r) => (
              <li key={r.rule_key} className="py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-body">{r.display_name}</p>
                    <p className="text-body-sm text-muted-foreground">
                      {earnLine(r)}
                      {r.description ? ` · ${r.description}` : ""}
                    </p>
                  </div>
                  {r.verification_mode === "honor" ? (
                    <button
                      onClick={() => doHonor(r.rule_key)}
                      disabled={busy === r.rule_key}
                      className="shrink-0 rounded-full bg-primary px-4 py-1.5 text-body-sm text-primary-foreground disabled:opacity-40"
                    >
                      {busy === r.rule_key ? "…" : "I did it"}
                    </button>
                  ) : r.verification_mode === "manual" ? (
                    <button
                      onClick={() => setOpenForm(openForm === r.rule_key ? null : r.rule_key)}
                      className="shrink-0 rounded-full border border-border px-4 py-1.5 text-body-sm hover:bg-secondary"
                    >
                      Submit
                    </button>
                  ) : (
                    <span className="shrink-0 text-caption text-muted-foreground">Automatic</span>
                  )}
                </div>
                {openForm === r.rule_key ? (
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input
                      value={proof}
                      onChange={(e) => setProof(e.target.value)}
                      placeholder={
                        r.action_type === "social_tag" ? "Paste your Instagram tag link" : "Paste a link (optional)"
                      }
                      className="flex-1 rounded-md border border-border bg-transparent px-3 py-1.5 text-body-sm"
                    />
                    <button
                      onClick={() => doManual(r.rule_key)}
                      disabled={busy === r.rule_key}
                      className="rounded-full bg-primary px-4 py-1.5 text-body-sm text-primary-foreground disabled:opacity-40"
                    >
                      {busy === r.rule_key ? "Sending…" : "Send for review"}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* History */}
      {wallet.ledger.length > 0 ? (
        <div className="rounded-lg border border-border p-5">
          <p className="text-caption">Recent activity</p>
          <ul className="mt-3 divide-y divide-border">
            {wallet.ledger.map((e, i) => (
              <li key={i} className="flex items-center justify-between py-2 text-body-sm">
                <span className="text-muted-foreground">
                  {e.description || e.transaction_type.replace(/_/g, " ")}
                </span>
                <span className="font-mono">
                  {e.crowns > 0 ? "+" : ""}
                  {e.crowns}👑
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function StreakRow({
  streak,
  busy,
  onCheckIn,
}: {
  streak: CrownWalletStreak;
  busy: boolean;
  onCheckIn?: () => void;
}) {
  const atRisk = streak.status === "at_risk";
  return (
    <li className="flex items-center justify-between gap-3">
      <div>
        <p className="text-body">
          {STREAK_LABEL[streak.streak_type] ?? streak.streak_type}
        </p>
        <p className={`text-body-sm ${atRisk ? "text-primary" : "text-muted-foreground"}`}>
          🔥 {streak.current_length} in a row
          {atRisk ? " · keep it alive!" : streak.status === "frozen" ? " · frozen" : ""}
        </p>
      </div>
      {onCheckIn ? (
        <button
          onClick={onCheckIn}
          disabled={busy}
          className="shrink-0 rounded-full bg-primary px-4 py-1.5 text-body-sm text-primary-foreground disabled:opacity-40"
        >
          {busy ? "…" : "Check in"}
        </button>
      ) : null}
    </li>
  );
}

// ── Public programme (marketing page) ──────────────────────
export function CrownProgramme({ programme }: { programme: Programme }) {
  return (
    <div className="space-y-10">
      {/* Tier ladder */}
      <div>
        <h2 className="text-h5 font-display">The Crown ladder</h2>
        <p className="mt-1 text-body-sm text-muted-foreground">
          The more Crowns you earn, the bigger your rewards.
        </p>
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {programme.tiers.map((t) => (
            <div
              key={t.tier_key}
              className="rounded-lg border border-border p-5"
              style={t.badge_colour_hex ? { borderTopColor: t.badge_colour_hex, borderTopWidth: 3 } : undefined}
            >
              <p className="text-body font-display">{t.tier_name}</p>
              <p className="mt-0.5 font-mono text-caption text-muted-foreground">
                {t.min_crowns.toLocaleString()}👑+
              </p>
              <ul className="mt-3 space-y-1 text-body-sm text-muted-foreground">
                {t.next_purchase_discount_pct > 0 ? (
                  <li>{t.next_purchase_discount_pct}% off your next purchase</li>
                ) : null}
                {t.lifetime_discount_pct > 0 ? (
                  <li className="text-foreground">{t.lifetime_discount_pct}% off, always</li>
                ) : null}
                {t.grants_free_shipping_next ? <li>Free shipping</li> : null}
                {Object.keys(t.benefits || {}).length > 0 ? <li>+ member perks</li> : null}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Ways to earn */}
      <div>
        <h2 className="text-h5 font-display">Ways to earn</h2>
        <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {programme.earn_rules.map((r) => (
            <li key={r.rule_key} className="flex items-center justify-between rounded-lg border border-border p-4">
              <span className="text-body">{r.display_name}</span>
              <span className="font-mono text-body-sm text-muted-foreground">{earnLine(r)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
