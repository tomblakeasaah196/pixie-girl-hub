import { useState } from "react";
import { FileBarChart } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { KpiTile, MoneyText } from "@/components/ui/primitives";
import { money } from "@/lib/format";
import { useArAgeing } from "./hooks";
import type { ArAgeingParty } from "./types";

const TOTAL_ROW_ID = "__total__";

export function ArAgeingView() {
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const { data, isLoading } = useArAgeing(asOf);

  const totals = data?.totals;
  const parties = data?.parties ?? [];

  const rows: ArAgeingParty[] = totals
    ? [...parties, { party_id: TOTAL_ROW_ID, party_name: "Total", ...totals }]
    : parties;

  const columns: Column<ArAgeingParty>[] = [
    {
      key: "party",
      header: "Customer",
      render: (p) => (
        <span className={p.party_id === TOTAL_ROW_ID ? "font-semibold" : "text-[13px]"}>
          {p.party_name}
        </span>
      ),
    },
    {
      key: "current",
      header: "Current (0-30)",
      align: "right",
      render: (p) => <MoneyText ngn={Number(p.current_0_30_ngn)} />,
    },
    {
      key: "31-60",
      header: "31-60 days",
      align: "right",
      render: (p) => (
        <MoneyText
          ngn={Number(p.days_31_60_ngn)}
          className={Number(p.days_31_60_ngn) > 0 ? "text-warn" : undefined}
        />
      ),
    },
    {
      key: "61-90",
      header: "61-90 days",
      align: "right",
      render: (p) => (
        <MoneyText
          ngn={Number(p.days_61_90_ngn)}
          className={Number(p.days_61_90_ngn) > 0 ? "text-warn" : undefined}
        />
      ),
    },
    {
      key: "90plus",
      header: "90+ days",
      align: "right",
      render: (p) => (
        <MoneyText
          ngn={Number(p.days_90_plus_ngn)}
          className={Number(p.days_90_plus_ngn) > 0 ? "text-danger" : undefined}
        />
      ),
    },
    {
      key: "total",
      header: "Total Outstanding",
      align: "right",
      render: (p) => (
        <span className={p.party_id === TOTAL_ROW_ID ? "font-semibold" : undefined}>
          <MoneyText ngn={Number(p.total_ngn)} />
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-lg font-medium">Accounts Receivable Ageing</h2>
          <p className="text-[12px] text-text-muted mt-0.5">
            Outstanding customer balances by age bucket.
          </p>
        </div>
        <label className="flex items-center gap-2 text-[12px] text-text-muted">
          As of
          <input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className="h-9 px-3 rounded-[10px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
          />
        </label>
      </div>

      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiTile label="Current (0-30)" value={money(Number(totals.current_0_30_ngn))} />
          <KpiTile label="31-60 days" value={money(Number(totals.days_31_60_ngn))} tone="warn" />
          <KpiTile label="61-90 days" value={money(Number(totals.days_61_90_ngn))} tone="warn" />
          <KpiTile label="90+ days" value={money(Number(totals.days_90_plus_ngn))} tone="warn" />
          <KpiTile label="Total Outstanding" value={money(Number(totals.total_ngn))} />
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(p) => p.party_id}
        loading={isLoading}
        empty={{
          icon: <FileBarChart className="w-8 h-8" />,
          title: "No outstanding balances",
          message: "Every customer invoice has been paid in full as of this date.",
        }}
      />
    </div>
  );
}
