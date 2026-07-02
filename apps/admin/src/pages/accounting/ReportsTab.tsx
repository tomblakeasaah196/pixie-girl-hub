import { useState } from "react";
import { BarChart3, RefreshCw, Scale } from "lucide-react";
import {
  Button,
  Card,
  EmptyState,
  MoneyText,
  Pill,
  Skeleton,
} from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { cn } from "@/lib/cn";
import {
  useApAgeing,
  useArAgeing,
  useBalanceSheet,
  useCashFlow,
  useProfitAndLoss,
  useTrialBalance,
} from "./hooks";
import type { AgeingParty, PnlItem, TrialBalanceRow } from "./types";

const REPORTS = [
  { key: "tb", label: "Trial Balance" },
  { key: "pnl", label: "Profit & Loss" },
  { key: "bs", label: "Balance Sheet" },
  { key: "cf", label: "Cash Flow" },
  { key: "ar", label: "AR Ageing" },
  { key: "ap", label: "AP Ageing" },
] as const;
type ReportKey = (typeof REPORTS)[number]["key"];

const dateCls =
  "h-[38px] px-[11px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50";

function firstOfYear() {
  return `${new Date().getFullYear()}-01-01`;
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function ReportsTab() {
  const [report, setReport] = useState<ReportKey>("tb");
  const [from, setFrom] = useState(firstOfYear());
  const [to, setTo] = useState(today());
  const ranged = report === "pnl" || report === "cf";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {REPORTS.map((r) => (
          <button
            key={r.key}
            onClick={() => setReport(r.key)}
            className={cn(
              "px-3 h-8 rounded-lg text-[12.5px] font-medium transition-colors",
              report === r.key
                ? "bg-text-primary/[0.09] text-text-primary"
                : "text-text-muted hover:text-text-primary",
            )}
          >
            {r.label}
          </button>
        ))}
        {ranged && (
          <div className="flex items-center gap-2 ml-auto">
            <input type="date" value={from} max={to} className={dateCls} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-text-faint text-xs">to</span>
            <input type="date" value={to} min={from} className={dateCls} onChange={(e) => setTo(e.target.value)} />
          </div>
        )}
      </div>

      {report === "tb" && <TrialBalanceReport />}
      {report === "pnl" && <PnlReport from={from} to={to} />}
      {report === "bs" && <BalanceSheetReport />}
      {report === "cf" && <CashFlowReport from={from} to={to} />}
      {report === "ar" && <AgeingReport kind="ar" />}
      {report === "ap" && <AgeingReport kind="ap" />}
    </div>
  );
}

function ReportState({
  loading,
  error,
  refetch,
  empty,
}: {
  loading?: boolean;
  error?: unknown;
  refetch?: () => void;
  empty?: boolean;
}) {
  if (loading)
    return (
      <Card className="p-6 space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="w-full h-5" />
        ))}
      </Card>
    );
  if (error)
    return (
      <Card className="p-10">
        <EmptyState
          icon={<BarChart3 className="w-8 h-8" />}
          title="Couldn't load this report"
          message="The ledger didn't answer — try again."
          action={
            <Button variant="secondary" icon={<RefreshCw className="w-4 h-4" />} onClick={refetch}>
              Retry
            </Button>
          }
        />
      </Card>
    );
  if (empty)
    return (
      <Card className="p-10">
        <EmptyState
          icon={<Scale className="w-8 h-8" />}
          title="Nothing posted yet"
          message="Journals will appear here as business flows post to the ledger."
        />
      </Card>
    );
  return null;
}

const num = (v: string | undefined) => Number(v || 0);

function TrialBalanceReport() {
  const { data, isLoading, error, refetch } = useTrialBalance();
  const state = (
    <ReportState loading={isLoading} error={error} refetch={refetch} empty={data && data.accounts.length === 0} />
  );
  if (isLoading || error || !data || data.accounts.length === 0) return state;

  const cols: Column<TrialBalanceRow>[] = [
    { key: "code", header: "Code", width: "80px", render: (r) => <span className="font-mono text-xs">{r.account_code}</span> },
    { key: "name", header: "Account", render: (r) => r.account_name },
    { key: "type", header: "Type", width: "120px", render: (r) => <Pill tone="neutral">{r.group_type}</Pill> },
    { key: "dr", header: "Debit", align: "right", render: (r) => <MoneyText ngn={num(r.debit_ngn)} /> },
    { key: "cr", header: "Credit", align: "right", render: (r) => <MoneyText ngn={num(r.credit_ngn)} /> },
  ];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Pill tone={data.balanced ? "success" : "danger"}>
          {data.balanced ? "Balanced" : "OUT OF BALANCE"}
        </Pill>
        <span className="text-text-muted text-xs">as of {data.as_of}</span>
        <span className="ml-auto text-sm">
          <MoneyText ngn={num(data.total_debit_ngn)} /> ={" "}
          <MoneyText ngn={num(data.total_credit_ngn)} />
        </span>
      </div>
      <DataTable columns={cols} rows={data.accounts} rowKey={(r) => r.account_code} />
    </div>
  );
}

function PnlSection({ title, items, total }: { title: string; items: PnlItem[]; total: string }) {
  return (
    <Card className="p-5">
      <h3 className="micro text-text-muted mb-3">{title}</h3>
      <div className="space-y-1.5">
        {items.map((i) => (
          <div key={i.account_code} className="flex justify-between text-sm">
            <span>
              <span className="font-mono text-xs text-text-faint mr-2">{i.account_code}</span>
              {i.account_name}
            </span>
            <MoneyText ngn={num(i.amount_ngn)} />
          </div>
        ))}
        <div className="flex justify-between pt-2 border-t hairline font-medium">
          <span>Total</span>
          <MoneyText ngn={num(total)} />
        </div>
      </div>
    </Card>
  );
}

function PnlReport({ from, to }: { from: string; to: string }) {
  const { data, isLoading, error, refetch } = useProfitAndLoss(from, to);
  const state = (
    <ReportState loading={isLoading} error={error} refetch={refetch} empty={data && data.revenue.length + data.expenses.length === 0} />
  );
  if (isLoading || error || !data || data.revenue.length + data.expenses.length === 0) return state;
  return (
    <div className="space-y-4">
      <div className="grid lg:grid-cols-2 gap-4">
        <PnlSection title="Revenue" items={data.revenue} total={data.total_revenue_ngn} />
        <PnlSection title="Expenses" items={data.expenses} total={data.total_expenses_ngn} />
      </div>
      <Card className="p-5 flex items-center justify-between">
        <span className="font-medium">Net profit</span>
        <MoneyText
          ngn={num(data.net_profit_ngn)}
          className={cn("text-lg", num(data.net_profit_ngn) < 0 && "text-danger")}
        />
      </Card>
    </div>
  );
}

function BalanceSheetReport() {
  const { data, isLoading, error, refetch } = useBalanceSheet();
  const state = (
    <ReportState loading={isLoading} error={error} refetch={refetch} empty={data && data.assets.length + data.liabilities.length + data.equity.length === 0} />
  );
  if (isLoading || error || !data || data.assets.length + data.liabilities.length + data.equity.length === 0)
    return state;
  return (
    <div className="space-y-4">
      <Pill tone={data.balanced ? "success" : "warn"}>
        {data.balanced ? "Balanced" : "Assets ≠ Liabilities + Equity (retained earnings pending close)"}
      </Pill>
      <div className="grid lg:grid-cols-3 gap-4">
        <PnlSection title="Assets" items={data.assets} total={data.total_assets_ngn} />
        <PnlSection title="Liabilities" items={data.liabilities} total={data.total_liabilities_ngn} />
        <PnlSection title="Equity" items={data.equity} total={data.total_equity_ngn} />
      </div>
    </div>
  );
}

function CashFlowReport({ from, to }: { from: string; to: string }) {
  const { data, isLoading, error, refetch } = useCashFlow(from, to);
  const state = <ReportState loading={isLoading} error={error} refetch={refetch} />;
  if (isLoading || error || !data) return state;
  const buckets = [
    { label: "Operating", b: data.operating },
    { label: "Investing", b: data.investing },
    { label: "Financing", b: data.financing },
  ];
  return (
    <div className="space-y-4">
      <div className="grid lg:grid-cols-3 gap-4">
        {buckets.map(({ label, b }) => (
          <Card key={label} className="p-5">
            <h3 className="micro text-text-muted mb-3">{label}</h3>
            <div className="space-y-1.5">
              {b.lines.length === 0 && <p className="text-text-faint text-xs">No movement</p>}
              {b.lines.map((l) => (
                <div key={l.source_type} className="flex justify-between text-sm">
                  <span className="capitalize">{l.source_type.replace(/_/g, " ")}</span>
                  <MoneyText ngn={num(l.amount_ngn)} />
                </div>
              ))}
              <div className="flex justify-between pt-2 border-t hairline font-medium">
                <span>Net</span>
                <MoneyText ngn={num(b.total_ngn)} />
              </div>
            </div>
          </Card>
        ))}
      </div>
      <Card className="p-5 grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
        <div>
          <p className="micro text-text-muted">Opening cash</p>
          <MoneyText ngn={num(data.opening_cash_ngn)} />
        </div>
        <div>
          <p className="micro text-text-muted">Net change</p>
          <MoneyText ngn={num(data.net_change_ngn)} />
        </div>
        <div>
          <p className="micro text-text-muted">Closing cash</p>
          <MoneyText ngn={num(data.closing_cash_ngn)} />
        </div>
        <div className="flex items-end">
          <Pill tone={data.reconciled ? "success" : "warn"}>
            {data.reconciled ? "Reconciled" : "Unreconciled"}
          </Pill>
        </div>
      </Card>
    </div>
  );
}

function AgeingReport({ kind }: { kind: "ar" | "ap" }) {
  const ar = useArAgeing();
  const ap = useApAgeing();
  const { data, isLoading, error, refetch } = kind === "ar" ? ar : ap;
  const state = (
    <ReportState loading={isLoading} error={error} refetch={refetch} empty={data && data.parties.length === 0} />
  );
  if (isLoading || error || !data || data.parties.length === 0) return state;
  const cols: Column<AgeingParty>[] = [
    { key: "party", header: kind === "ar" ? "Customer" : "Supplier", render: (r) => r.party_name || "—" },
    { key: "b1", header: "0–30", align: "right", render: (r) => <MoneyText ngn={num(r.current_0_30_ngn)} /> },
    { key: "b2", header: "31–60", align: "right", render: (r) => <MoneyText ngn={num(r.days_31_60_ngn)} /> },
    { key: "b3", header: "61–90", align: "right", render: (r) => <MoneyText ngn={num(r.days_61_90_ngn)} /> },
    { key: "b4", header: "90+", align: "right", render: (r) => <MoneyText ngn={num(r.days_90_plus_ngn)} className={num(r.days_90_plus_ngn) > 0 ? "text-danger" : undefined} /> },
    { key: "total", header: "Total", align: "right", render: (r) => <MoneyText ngn={num(r.total_ngn)} /> },
  ];
  return (
    <div className="space-y-3">
      <div className="flex justify-end text-sm">
        <span className="text-text-muted mr-2">Outstanding:</span>
        <MoneyText ngn={num(data.totals.total_ngn)} />
      </div>
      <DataTable columns={cols} rows={data.parties} rowKey={(r) => r.party_id} />
    </div>
  );
}
