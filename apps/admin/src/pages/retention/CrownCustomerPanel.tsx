/**
 * Crown 👑 customer panel — a Pixie Queen's wallet at a glance, embeddable
 * anywhere a contact is in view (CRM client profile, etc.). Shows the balance,
 * tier + progress, live streaks (with an at-risk badge so sales can reach out),
 * active vouchers, recent activity, and a manual adjust for `approve` staff.
 * Four states, permission-aware, entity-scoped (canon).
 */

import { useState } from "react";
import { Crown, Flame, Gift, Plus, Minus } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { Button, Card, Pill, Skeleton, EmptyState } from "@/components/ui/primitives";
import { ErrorState, NumberField } from "@/components/ui/controls";
import { INPUT, L } from "./_ui";
import { useCrownWallet, useAdjustCrowns, type CrownStreak } from "@/lib/crown-api";

const STREAK_LABELS: Record<string, string> = {
  purchase_monthly: "Monthly purchase",
  engagement_weekly: "Weekly check-in",
};

function streakTone(s: CrownStreak): "success" | "warn" | "danger" | "neutral" {
  if (s.status === "broken") return "danger";
  if (s.status === "at_risk") return "warn";
  if (s.status === "frozen") return "neutral";
  return "success";
}

export function CrownCustomerPanel({ contactId }: { contactId: string }) {
  const { can } = useAuthStore();
  const canAdjust = can("retention", "approve");
  const q = useCrownWallet(contactId);
  const adjust = useAdjustCrowns();
  const [showAdjust, setShowAdjust] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  if (q.isLoading) return <Skeleton style={{ height: 220 }} />;
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;

  const w = q.data;
  const st = w?.state;
  const streaks = w?.streaks ?? [];
  const grants = w?.grants ?? [];
  const ledger = w?.ledger ?? [];

  // Progress within the current tier band toward the next.
  const nextMin = st?.next_tier_min ?? null;
  const toNext = st?.crowns_to_next_tier ?? null;
  const pct =
    nextMin && toNext != null && nextMin > 0
      ? Math.max(0, Math.min(100, Math.round(((nextMin - toNext) / nextMin) * 100)))
      : st?.tier_name
        ? 100
        : 0;

  async function submitAdjust(sign: 1 | -1) {
    const n = Math.round(Number(amount));
    if (!n) return;
    await adjust.mutateAsync({ contactId, crowns: sign * n, note: note || undefined });
    setAmount("");
    setNote("");
    setShowAdjust(false);
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 p-4 border-b hairline">
        <Crown className="w-4 h-4 text-accent-glow" />
        <span className="text-[13px] font-semibold flex-1">Crowns 👑</span>
        {canAdjust && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => setShowAdjust((s) => !s)}
          >
            Adjust
          </Button>
        )}
      </div>

      <div className="p-4 space-y-4">
        {/* Balance + tier */}
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="font-display text-2xl">
              {(st?.current_crowns ?? 0).toLocaleString()}👑
            </div>
            <div className="text-[12px] text-text-muted mt-0.5">
              {st?.tier_name ? (
                <>
                  {st.tier_name}
                  {Number(st.lifetime_discount_pct) > 0 &&
                    ` · ${Number(st.lifetime_discount_pct)}% lifetime`}
                </>
              ) : (
                "Member — no tier yet"
              )}
            </div>
          </div>
        </div>

        {/* Progress to next tier */}
        {st?.next_tier_name && toNext != null && (
          <div>
            <div className="flex justify-between text-[11.5px] text-text-muted mb-1">
              <span>To {st.next_tier_name}</span>
              <span className="font-mono">{toNext.toLocaleString()}👑 to go</span>
            </div>
            <div className="h-1.5 rounded-full bg-text-primary/10 overflow-hidden">
              <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {/* Adjust form */}
        {showAdjust && canAdjust && (
          <div className="rounded-[var(--radius)] border border-line p-3 space-y-2.5">
            <L label="Amount (👑)">
              <NumberField value={amount} onChange={setAmount} allowDecimal={false} />
            </L>
            <L label="Note">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for the adjustment" className={INPUT} autoComplete="off" data-1p-ignore="" />
            </L>
            <div className="flex gap-2">
              <Button size="sm" variant="primary" icon={<Plus className="w-3.5 h-3.5" />} disabled={adjust.isPending || !amount} onClick={() => submitAdjust(1)}>
                Credit
              </Button>
              <Button size="sm" variant="secondary" icon={<Minus className="w-3.5 h-3.5" />} disabled={adjust.isPending || !amount} onClick={() => submitAdjust(-1)}>
                Debit
              </Button>
            </div>
          </div>
        )}

        {/* Streaks */}
        {streaks.length > 0 && (
          <div className="space-y-1.5">
            {streaks.map((s) => (
              <div key={s.streak_id} className="flex items-center gap-2 text-[12.5px]">
                <Flame className="w-3.5 h-3.5 text-accent-glow shrink-0" />
                <span className="text-text-muted flex-1">
                  {STREAK_LABELS[s.streak_type] ?? s.streak_type}
                </span>
                <span className="font-mono text-text-primary">{s.current_length}</span>
                <Pill tone={streakTone(s)}>{s.status.replace(/_/g, " ")}</Pill>
              </div>
            ))}
          </div>
        )}

        {/* Active vouchers */}
        {grants.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {grants.map((g) => (
              <Pill key={g.grant_id} tone="info" dot={false}>
                <Gift className="w-3 h-3 mr-1 inline" />
                {g.grant_type === "next_purchase_discount"
                  ? `${Number(g.discount_pct)}% off next`
                  : "Free shipping"}
              </Pill>
            ))}
          </div>
        )}

        {/* Recent activity */}
        {ledger.length === 0 ? (
          <EmptyState icon={<Crown className="w-6 h-6" />} title="No Crown activity yet" />
        ) : (
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Recent</div>
            {ledger.slice(0, 5).map((e) => (
              <div key={e.ledger_id} className="flex items-center gap-2 text-[12px]">
                <span className="text-text-muted flex-1 truncate">{e.description ?? e.earn_action_type}</span>
                <span className={`font-mono ${e.crowns >= 0 ? "text-success" : "text-danger"}`}>
                  {e.crowns >= 0 ? "+" : ""}
                  {e.crowns}👑
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
