import { useState } from "react";
import { Banknote } from "lucide-react";
import { MoneyText, Pill, type Tone } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { useBankReconciliations, useBankStatements } from "./hooks";
import type { BankReconciliation, BankStatement } from "./types";

const TONE: Record<string, Tone> = {
  imported: "neutral",
  reconciling: "warn",
  reconciled: "success",
  in_progress: "warn",
  completed: "success",
};

const num = (v: string | undefined | null) => Number(v || 0);

export default function BankTab() {
  const [stPage, setStPage] = useState(1);
  const [rePage, setRePage] = useState(1);
  void setStPage;
  void setRePage;
  const statements = useBankStatements(stPage);
  const recons = useBankReconciliations(rePage);

  const stCols: Column<BankStatement>[] = [
    { key: "date", header: "Statement date", render: (r) => String(r.statement_date || r.created_at || "").slice(0, 10) },
    { key: "src", header: "Source", render: (r) => r.source || "import" },
    { key: "open", header: "Opening", align: "right", render: (r) => <MoneyText ngn={num(r.opening_balance_ngn)} /> },
    { key: "close", header: "Closing", align: "right", render: (r) => <MoneyText ngn={num(r.closing_balance_ngn)} /> },
    { key: "status", header: "Status", width: "110px", render: (r) => <Pill tone={TONE[r.status] ?? "neutral"}>{r.status}</Pill> },
  ];
  const reCols: Column<BankReconciliation>[] = [
    { key: "no", header: "Reconciliation", render: (r) => <span className="font-mono text-xs">{r.reconciliation_number}</span> },
    { key: "book", header: "Book", align: "right", render: (r) => <MoneyText ngn={num(r.book_balance_ngn)} /> },
    { key: "stmt", header: "Statement", align: "right", render: (r) => <MoneyText ngn={num(r.statement_balance_ngn)} /> },
    {
      key: "variance",
      header: "Variance",
      align: "right",
      render: (r) => (
        <MoneyText ngn={num(r.variance_ngn)} className={num(r.variance_ngn) !== 0 ? "text-danger" : undefined} />
      ),
    },
    { key: "status", header: "Status", width: "110px", render: (r) => <Pill tone={TONE[r.status] ?? "neutral"}>{r.status}</Pill> },
  ];

  const empty = (title: string) => ({
    icon: <Banknote className="w-8 h-8" />,
    title,
    message:
      "Import a bank statement via the API or integrations; matching clears gateway settlement floats into the bank account.",
  });

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h3 className="font-display text-lg">Statements</h3>
        <DataTable
          columns={stCols}
          rows={statements.data?.data ?? []}
          rowKey={(r) => r.statement_id}
          loading={statements.isLoading}
          empty={empty("No bank statements")}
        />
      </div>
      <div className="space-y-3">
        <h3 className="font-display text-lg">Reconciliations</h3>
        <DataTable
          columns={reCols}
          rows={recons.data?.data ?? []}
          rowKey={(r) => r.reconciliation_id}
          loading={recons.isLoading}
          empty={empty("No reconciliations yet")}
        />
      </div>
    </div>
  );
}
