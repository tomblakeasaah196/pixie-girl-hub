import { useNavigate } from "react-router-dom";
import { Gift, TrendingUp, Users, ArrowRight, Star, AlertTriangle } from "lucide-react";
import { Button, Skeleton, MoneyText, Pill, type Tone } from "@/components/ui/primitives";
import { useContactSummary, useChurnScores } from "./hooks";

// ── Types (aligned to shared.customer_loyalty_state) ─────────────────────

export type LoyaltyTier = "bronze" | "silver" | "gold" | "diamond";

const TIER_CONFIG: Record<
  LoyaltyTier,
  { label: string; color: string; bgColor: string; icon: string; tone: Tone }
> = {
  bronze: { label: "Bronze", color: "text-[#CD7F32]", bgColor: "bg-[#CD7F32]/[0.12]", icon: "🥉", tone: "neutral" },
  silver: { label: "Silver", color: "text-[#A8A9AD]", bgColor: "bg-[#A8A9AD]/[0.12]", icon: "🥈", tone: "info" },
  gold: { label: "Gold", color: "text-[#FFD700]", bgColor: "bg-[#FFD700]/[0.12]", icon: "🥇", tone: "warn" },
  diamond: { label: "Diamond", color: "text-accent-glow", bgColor: "bg-accent-deep/[0.15]", icon: "💎", tone: "accent" },
};

const TIER_ORDER: LoyaltyTier[] = ["bronze", "silver", "gold", "diamond"];

const CHURN_TONE: Record<string, Tone> = {
  low: "success",
  medium: "warn",
  high: "danger",
  critical: "danger",
};

interface Props {
  contactId: string;
  contactName: string;
}

/**
 * Loyalty + Referrals + Retention summary tab on a contact's 360° profile.
 * Shows: tier badge, points balance, referral count, retention health,
 * and churn risk — with deep-links to the Retention and Referrals modules.
 */
export function LoyaltyTab({ contactId, contactName }: Props) {
  const navigate = useNavigate();
  const { data: summary, isLoading: summaryLoading } = useContactSummary(contactId);
  const { data: churnScores = [], isLoading: churnLoading } = useChurnScores(contactId);

  const isLoading = summaryLoading || churnLoading;
  const latestChurn = churnScores[0] ?? null;

  // Until loyalty endpoint is live, infer tier from points
  const points = summary?.loyalty_points ?? 0;
  const tier: LoyaltyTier =
    points >= 5000 ? "diamond" : points >= 2000 ? "gold" : points >= 500 ? "silver" : "bronze";
  const tierConfig = TIER_CONFIG[tier];

  // Points thresholds (matches backend seed values)
  const TIER_THRESHOLDS: Record<LoyaltyTier, number> = {
    bronze: 0,
    silver: 500,
    gold: 2000,
    diamond: 5000,
  };
  const currentIdx = TIER_ORDER.indexOf(tier);
  const nextTier = TIER_ORDER[currentIdx + 1] as LoyaltyTier | undefined;
  const nextThreshold = nextTier ? TIER_THRESHOLDS[nextTier] : null;
  const progressPct = nextThreshold
    ? Math.min(100, ((points - TIER_THRESHOLDS[tier]) / (nextThreshold - TIER_THRESHOLDS[tier])) * 100)
    : 100;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-[100px] rounded-[14px]" />
        <Skeleton className="h-[80px] rounded-[14px]" />
        <Skeleton className="h-[80px] rounded-[14px]" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Tier card */}
      <div className={`p-4 rounded-[14px] border hairline ${tierConfig.bgColor}`}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="micro mb-1">Loyalty tier</div>
            <div className={`font-display text-2xl ${tierConfig.color}`}>
              {tierConfig.icon} {tierConfig.label}
            </div>
          </div>
          <div className="text-right">
            <div className="micro mb-1">Points balance</div>
            <div className="font-display text-2xl text-text-primary tabular-nums">
              {points.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Progress to next tier */}
        {nextTier && nextThreshold && (
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-[10.5px] text-text-faint">{tierConfig.label}</span>
              <span className="text-[10.5px] text-text-faint">
                {TIER_CONFIG[nextTier].icon} {TIER_CONFIG[nextTier].label} at {nextThreshold.toLocaleString()} pts
              </span>
            </div>
            <div className="h-[5px] rounded-full bg-text-primary/[0.08] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${tierConfig.color.replace("text-", "bg-")}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="text-[10.5px] text-text-faint mt-1">
              {(nextThreshold - points).toLocaleString()} more points to {TIER_CONFIG[nextTier].label}
            </p>
          </div>
        )}

        {tier === "diamond" && (
          <p className="text-[11px] text-accent/80 mt-1">✦ Highest tier — all benefits unlocked</p>
        )}
      </div>

      {/* Orders & retention health */}
      {summary && (
        <div className="p-4 rounded-[14px] bg-text-primary/[0.04] border hairline">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-accent" />
            <span className="text-[13px] font-semibold text-text-primary">Retention Health</span>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div>
              <div className="micro">Orders</div>
              <div className="font-display text-lg text-text-primary">{summary.total_orders}</div>
            </div>
            <div>
              <div className="micro">Lifetime value</div>
              <div className="font-display text-lg text-text-primary tabular-nums">
                <MoneyText ngn={parseFloat(summary.lifetime_value_ngn || "0")} />
              </div>
            </div>
            <div>
              <div className="micro">Open deals</div>
              <div className="font-display text-lg text-text-primary">{summary.open_deals}</div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowRight className="w-3.5 h-3.5" />}
            className="w-full justify-center text-text-faint hover:text-text-primary"
            onClick={() => navigate(`/retention?contact=${contactId}`)}
          >
            View in Retention module
          </Button>
        </div>
      )}

      {/* Churn risk */}
      {latestChurn ? (
        <div className="p-4 rounded-[14px] bg-text-primary/[0.04] border hairline">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-warn" />
              <span className="text-[13px] font-semibold text-text-primary">Churn Risk</span>
            </div>
            <Pill tone={CHURN_TONE[latestChurn.risk_band] ?? "neutral"}>
              {latestChurn.risk_band} · {latestChurn.risk_score}/100
            </Pill>
          </div>
          {latestChurn.reasons.length > 0 && (
            <ul className="text-[11.5px] text-text-muted space-y-0.5 mb-3">
              {latestChurn.reasons.map((r, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="text-warn mt-0.5">•</span>
                  {r}
                </li>
              ))}
            </ul>
          )}
          {latestChurn.days_since_last_order != null && (
            <p className="text-[11px] text-text-faint mb-3">
              Last order: {latestChurn.days_since_last_order} days ago
            </p>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowRight className="w-3.5 h-3.5" />}
            className="w-full justify-center text-text-faint hover:text-danger"
            onClick={() => navigate(`/retention?contact=${contactId}&action=win-back`)}
          >
            Trigger win-back workflow
          </Button>
        </div>
      ) : (
        <div className="p-4 rounded-[14px] bg-success/[0.06] border border-success/20">
          <div className="flex items-center gap-2">
            <Star className="w-4 h-4 text-success" />
            <span className="text-[13px] font-semibold text-success">Low churn risk</span>
          </div>
          <p className="text-[11.5px] text-text-muted mt-1">
            No churn risk score on record — {contactName} appears to be an engaged contact.
          </p>
        </div>
      )}

      {/* Referrals */}
      <div className="p-4 rounded-[14px] bg-text-primary/[0.04] border hairline">
        <div className="flex items-center gap-2 mb-2">
          <Users className="w-4 h-4 text-info" />
          <span className="text-[13px] font-semibold text-text-primary">Referrals</span>
        </div>
        <p className="text-[12px] text-text-muted mb-3">
          Referral history, earnings, and contacts referred by {contactName} are tracked
          in the Referrals module.
        </p>
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowRight className="w-3.5 h-3.5" />}
          className="w-full justify-center text-text-faint hover:text-text-primary"
          onClick={() => navigate(`/referrals?contact=${contactId}`)}
        >
          View referral history
        </Button>
      </div>

      {/* Points info */}
      <div className="p-3 rounded-[12px] bg-text-primary/[0.03] border hairline">
        <div className="flex items-center gap-2 mb-1">
          <Gift className="w-3.5 h-3.5 text-text-faint" />
          <span className="text-[11px] font-semibold text-text-faint uppercase tracking-wide">
            How points work
          </span>
        </div>
        <p className="text-[11.5px] text-text-faint leading-relaxed">
          Points are earned automatically on every purchase (proportional to amount paid).
          Partial payments earn partial points. Points expire after 12 months of inactivity.
        </p>
      </div>
    </div>
  );
}
