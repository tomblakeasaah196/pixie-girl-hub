/**
 * Referral attributions ledger (§6.26 Q17 — two-way earnings). Every paid
 * order that carried a partner's referral code, its commission, hold state
 * and payout linkage. Totals across the current filter up top.
 */

import { useState } from "react";
import { Link2 } from "lucide-react";
import { Pill, MoneyText, KpiTile } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { useAttributions, usePartners } from "./hooks";
import { ATTRIBUTION_STATUS_META } from "./constants";
import type { Attribution } from "./types";

export function ReferralsPanel() {
  const [status, setStatus] = useState("");
  const attributions = useAttributions({ status: status || undefined });
  const partners = usePartners({});

  const partnerName = (id: string) =>
    partners.data?.find((p) => p.stylist_id === id)?.display_name ??
    `${id.slice(0, 8)}…`;

  const rows = attributions.data ?? [];
  const sum = (s: string) =>
    rows
      .filter((r) => r.status === s)
      .reduce((acc, r) => acc + Number(r.commission_amount_ngn), 0);

  const columns: Column<Attribution>[] = [
    {
      key: "order",
      header: "Order",
      render: (r) => (
        <div>
          <div className="font-mono text-[12px]">{r.order_number ?? r.order_id.slice(0, 8)}</div>
          <div className="text-[11px] text-text-faint">
            code <span className="font-mono">{r.referral_code}</span>
          </div>
        </div>
      ),
    },
    { key: "partner", header: "Partner", render: (r) => partnerName(r.stylist_id) },
    {
      key: "total",
      header: "Order total",
      align: "right",
      render: (r) => <MoneyText ngn={Number(r.order_total_ngn)} />,
    },
    {
      key: "commission",
      header: "Commission",
      align: "right",
      render: (r) => (
        <span>
          <MoneyText ngn={Number(r.commission_amount_ngn)} />
          <span className="text-text-faint text-[10.5px] block">
            {Number(r.commission_pct)}%
          </span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => {
        const meta = ATTRIBUTION_STATUS_META[r.status];
        return <Pill tone={meta.tone}>{meta.label}</Pill>;
      },
    },
    {
      key: "when",
      header: "Attributed",
      render: (r) => (
        <span className="tabular-nums text-[12px]">
          {new Date(r.created_at).toLocaleDateString()}
        </span>
      ),
    },
  ];

  if (attributions.isError)
    return (
      <ErrorState
        message={(attributions.error as Error).message}
        onRetry={() => attributions.refetch()}
      />
    );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <KpiTile label="On hold" value={`₦${sum("pending").toLocaleString()}`} tone="warn" />
        <KpiTile label="Payable" value={`₦${sum("payable").toLocaleString()}`} />
        <KpiTile label="Paid out" value={`₦${sum("paid").toLocaleString()}`} />
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.attribution_id}
        loading={attributions.isLoading}
        toolbar={
          <select
            className="input h-9 text-[12.5px]"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            {Object.entries(ATTRIBUTION_STATUS_META).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        }
        empty={{
          icon: <Link2 className="w-6 h-6" />,
          title: "No referral sales yet",
          message:
            "When a customer buys through a partner's referral link, the commission lands here and rides the payout rail after the hold.",
        }}
      />
    </div>
  );
}
