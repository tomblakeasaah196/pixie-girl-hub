/**
 * Dashboard building blocks: the global period control (presets + custom
 * range), delta-aware KPI cards, the freshness pill, and the drill-down →
 * module route map.
 */

import { useEffect, useState } from "react";
import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Kpi, PeriodParams } from "@/lib/dashboards-api";
import { fmtTileValue } from "@/components/charts/chart-kit";

// ── Period presets ─────────────────────────────────────────

export type PresetKey =
  | "today"
  | "7d"
  | "30d"
  | "month"
  | "quarter"
  | "ytd"
  | "custom";

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "month", label: "This month" },
  { key: "quarter", label: "Quarter" },
  { key: "ytd", label: "YTD" },
  { key: "custom", label: "Custom" },
];

export function presetRange(
  preset: PresetKey,
  customFrom?: string,
  customTo?: string,
): PeriodParams {
  const now = new Date();
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate());
  switch (preset) {
    case "today":
      return { from: startOfDay(now).toISOString(), to: now.toISOString() };
    case "7d":
      return {
        from: new Date(now.getTime() - 7 * 864e5).toISOString(),
        to: now.toISOString(),
      };
    case "month":
      return {
        from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
        to: now.toISOString(),
      };
    case "quarter": {
      const q = Math.floor(now.getMonth() / 3) * 3;
      return {
        from: new Date(now.getFullYear(), q, 1).toISOString(),
        to: now.toISOString(),
      };
    }
    case "ytd":
      return {
        from: new Date(now.getFullYear(), 0, 1).toISOString(),
        to: now.toISOString(),
      };
    case "custom": {
      const from = customFrom ? new Date(customFrom) : undefined;
      const toRaw = customTo ? new Date(customTo) : undefined;
      // A bare date input means "through the end of that day".
      const to = toRaw ? new Date(toRaw.getTime() + 864e5 - 1) : undefined;
      if (from && to && from < to) {
        return { from: from.toISOString(), to: to.toISOString() };
      }
      return presetRange("30d");
    }
    case "30d":
    default:
      return {
        from: new Date(now.getTime() - 30 * 864e5).toISOString(),
        to: now.toISOString(),
      };
  }
}

export function PeriodPicker({
  preset,
  onPreset,
  customFrom,
  customTo,
  onCustom,
}: {
  preset: PresetKey;
  onPreset: (p: PresetKey) => void;
  customFrom: string;
  customTo: string;
  onCustom: (from: string, to: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex gap-1 overflow-x-auto max-w-full pb-0.5 -mb-0.5">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => onPreset(p.key)}
            className={cn(
              "px-3 h-9 rounded-full text-[12px] whitespace-nowrap transition-colors border",
              preset === p.key
                ? "bg-accent-deep text-[#F4E9D9] border-transparent"
                : "glass hairline text-text-muted hover:text-text-primary",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {preset === "custom" && (
        <div className="flex items-center gap-1.5 text-[12px]">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => onCustom(e.target.value, customTo)}
            className="glass hairline rounded-lg h-9 px-2 bg-transparent"
            aria-label="From date"
          />
          <span className="text-text-faint">→</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => onCustom(customFrom, e.target.value)}
            className="glass hairline rounded-lg h-9 px-2 bg-transparent"
            aria-label="To date"
          />
        </div>
      )}
    </div>
  );
}

// ── KPI card (stat tile + Δ% vs previous period) ───────────

export function KpiCard({
  kpi,
  onClick,
  hidden,
  customizing,
  onToggleHide,
}: {
  kpi: Kpi;
  onClick?: () => void;
  hidden?: boolean;
  customizing?: boolean;
  onToggleHide?: () => void;
}) {
  if (hidden && !customizing) return null;
  const delta =
    kpi.delta_pct === null ||
    kpi.delta_pct === undefined ||
    Math.abs(kpi.delta_pct) < 0.05
      ? null
      : {
          up: kpi.delta_pct >= 0,
          text: `${Math.abs(kpi.delta_pct).toFixed(1)}% vs prev`,
        };
  return (
    <div
      onClick={customizing ? onToggleHide : onClick}
      role={onClick || customizing ? "button" : undefined}
      tabIndex={onClick || customizing ? 0 : undefined}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (customizing ? onToggleHide : onClick))
          (customizing ? onToggleHide : onClick)!();
      }}
      className={cn(
        "relative glass rounded-[var(--radius)] shadow-glass p-[15px_16px] max-md:p-[12px_13px] border-l-[3px] text-left min-w-0",
        "border-l-[rgb(var(--accent))]",
        (onClick || customizing) &&
          "cursor-pointer transition-transform hover:-translate-y-0.5",
        customizing && hidden && "opacity-35",
      )}
    >
      {customizing && (
        <span className="absolute top-2 right-2 text-text-faint">
          {hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </span>
      )}
      <div className="micro truncate" title={kpi.label}>
        {kpi.label}
      </div>
      <div className="font-display font-medium text-[26px] max-md:text-[20px] mt-1.5 tabular-nums truncate">
        {fmtTileValue(kpi.value, kpi.format)}
      </div>
      {delta && (
        <div
          className={cn(
            "text-[11px] font-bold mt-1",
            delta.up ? "text-success" : "text-danger",
          )}
        >
          {delta.up ? "▲" : "▼"} {delta.text}
        </div>
      )}
    </div>
  );
}

// ── Freshness pill ─────────────────────────────────────────

export function UpdatedAgo({
  updatedAt,
  refreshing,
  onRefresh,
}: {
  updatedAt: number | undefined;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 10_000);
    return () => clearInterval(id);
  }, []);
  let agoText = "";
  if (updatedAt) {
    const s = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
    agoText = s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
  }
  return (
    <button
      onClick={onRefresh}
      className="flex items-center gap-1.5 text-[11px] text-text-faint hover:text-text-primary transition-colors h-9 px-2"
      title="Refresh now"
    >
      <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
      {updatedAt ? `Updated ${agoText}` : "Loading…"}
    </button>
  );
}

// ── Drill-down → module deep links ─────────────────────────

export const MODULE_ROUTES: Record<string, string> = {
  "sales.orders": "/sales?tab=orders",
  "sales.payments": "/sales?tab=orders",
  "customers.top_customers": "/contacts",
  "customers.deals": "/crm",
  "customers.at_risk": "/crm",
  "finance.receivables": "/invoicing",
  "finance.expenses": "/expenses",
  "stock.low_stock": "/stock",
  "stock.movements": "/stock",
  "logistics.deliveries": "/logistics",
  "marketing.email_campaigns": "/marketing",
  "marketing.ad_campaigns": "/marketing",
  "ecommerce.storefront_orders": "/sales?tab=orders",
  "retention.referral_redemptions": "/retention",
  "retention.coupon_redemptions": "/retention",
  "retention.subscriptions": "/retention",
  "hr.leave_requests": "/hr",
  "hr.payroll_runs": "/payroll",
  "hr.commissions": "/payroll",
};
