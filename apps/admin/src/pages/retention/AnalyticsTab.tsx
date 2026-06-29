/**
 * Analytics tab (§6.23.7) — retention dashboard. Repeat rate, points economy
 * + outstanding liability, coupon ROI, referral performance and subscription
 * MRR are computed directly; CLV + churn are clearly-labelled estimates.
 */

import { useState } from "react";
import { useAuthStore } from "@/stores/auth";
import { Card, KpiTile, MoneyText, Skeleton } from "@/components/ui/primitives";
import { Select, ErrorState } from "@/components/ui/controls";
import { useRetentionAnalytics } from "@/lib/retention-api";

export function AnalyticsTab() {
  const { can } = useAuthStore();
  const [windowDays, setWindowDays] = useState(90);
  const q = useRetentionAnalytics(windowDays);

  if (!can("retention", "view")) return null;
  if (q.isLoading) return <Skeleton style={{ height: 320 }} />;
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  const a = q.data;
  if (!a) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg">Retention analytics</h2>
        <div className="w-44">
          <Select
            value={String(windowDays)}
            onChange={(v) => setWindowDays(Number(v))}
            options={[
              { value: "30", label: "Last 30 days" },
              { value: "60", label: "Last 60 days" },
              { value: "90", label: "Last 90 days" },
              { value: "180", label: "Last 180 days" },
            ]}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile label="Repeat-purchase rate" value={`${a.repeat_purchase.repeat_rate_pct}%`} />
        <KpiTile label="Customers" value={a.repeat_purchase.total_customers.toLocaleString()} />
        <KpiTile label="Avg order value" value={fmt(a.revenue.avg_order_value_ngn)} />
        <KpiTile label="Subscription MRR" value={fmt(a.subscriptions.mrr_ngn)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-5 space-y-3">
          <h3 className="font-display text-[15px]">Points economy</h3>
          <Row label="Points earned" value={a.points_economy.earned.toLocaleString()} />
          <Row label="Points spent" value={a.points_economy.spent.toLocaleString()} />
          <Row label="Outstanding (liability)" value={a.points_economy.outstanding_liability.toLocaleString()} accent />
          <h4 className="micro mt-3">Tier distribution</h4>
          {a.tier_distribution.map((t) => (
            <Row key={t.tier} label={t.tier} value={String(t.customers)} />
          ))}
        </Card>

        <Card className="p-5 space-y-3">
          <h3 className="font-display text-[15px]">Programmes</h3>
          <Row label="Coupon redemptions" value={String(a.coupon_roi.redemptions)} />
          <RowMoney label="Coupon discount given" ngn={a.coupon_roi.total_discount_ngn} />
          <Row label="Referral conversions" value={String(a.referral_performance.conversions)} />
          <Row label="Active subscriptions" value={String(a.subscriptions.active)} />
        </Card>
      </div>

      <Card className="p-5 space-y-3">
        <h3 className="font-display text-[15px]">
          Estimates <span className="text-[11px] text-text-faint font-normal">(directional, not a predictive model)</span>
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <KpiTile label="Estimated CLV" value={fmt(a.estimates.clv_ngn)} />
          <KpiTile label="Avg orders / customer" value={String(a.estimates.avg_orders_per_customer)} />
          <KpiTile label="Churn estimate" value={`${a.estimates.churn_rate_pct}%`} tone="warn" />
        </div>
        <p className="text-[11.5px] text-text-faint">Churn basis: {a.estimates.churn_basis}.</p>
      </Card>
    </div>
  );
}

function fmt(ngn: number) {
  return `₦${Math.round(ngn).toLocaleString()}`;
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <span className="text-text-muted">{label}</span>
      <span className={accent ? "font-display font-medium text-accent-glow tabular-nums" : "font-medium tabular-nums"}>{value}</span>
    </div>
  );
}

function RowMoney({ label, ngn }: { label: string; ngn: number }) {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <span className="text-text-muted">{label}</span>
      <MoneyText ngn={ngn} className="text-[13px]" />
    </div>
  );
}
