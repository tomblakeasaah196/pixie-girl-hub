import { useState, lazy, Suspense } from "react";
import { Receipt, Plus, Lock } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { ModuleInsights } from "@/components/insights/ModuleInsights";
import {
  Button,
  Card,
  EmptyState,
  KpiTile,
  Pill,
  Skeleton,
  MoneyText,
} from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { cn } from "@/lib/cn";
import { money, moneyCompact, formatDate as fmtDateCanon } from "@/lib/format";
import { useExpenses, useExpenseKpis } from "./hooks";
import { EXPENSE_STATUS_META, EXPENSE_STATUS_TABS } from "./constants";
import type { Expense } from "./types";

const ExpenseDetailDrawer = lazy(() => import("./ExpenseDetailDrawer"));
const CreateExpenseDrawer = lazy(() =>
  import("./CreateExpenseDrawer").then((m) => ({
    default: m.CreateExpenseDrawer,
  })),
);

export default function ExpensesPage() {
  useBreadcrumbs([{ label: "Expenses" }]);
  const can = useAuthStore((s) => s.can);

  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selectedEx, setSelectedEx] = useState<Expense | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  if (!can("expenses", "view")) {
    return (
      <div className="py-20">
        <EmptyState
          icon={<Lock className="w-8 h-8" />}
          title="Access restricted"
          message="You don't have permission to view expenses."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ModuleInsights module="expenses" />
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-medium">Expenses</h1>
          <p className="text-text-muted text-sm mt-0.5">
            Record and track company expenses
          </p>
        </div>
        {can("expenses", "create") && (
          <Button
            variant="primary"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => setShowCreate(true)}
          >
            New Expense
          </Button>
        )}
      </div>

      <ExpenseKpiStrip />

      <ExpensesTable
        statusFilter={statusFilter}
        onStatusFilter={setStatusFilter}
        page={page}
        onPage={setPage}
        onSelect={setSelectedEx}
      />

      <Suspense fallback={null}>
        {selectedEx && (
          <ExpenseDetailDrawer
            expense={selectedEx}
            onClose={() => setSelectedEx(null)}
          />
        )}
        {showCreate && (
          <CreateExpenseDrawer onClose={() => setShowCreate(false)} />
        )}
      </Suspense>
    </div>
  );
}

function ExpenseKpiStrip() {
  const { data, isLoading } = useExpenseKpis();
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="p-5">
            <Skeleton className="w-20 mb-3" />
            <Skeleton className="w-28 h-7" />
          </Card>
        ))}
      </div>
    );
  }
  if (!data) return null;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <KpiTile
        label="Paid This Month"
        value={moneyCompact(Number(data.paid_this_month))}
      />
      <KpiTile
        label="Pending Amount"
        value={moneyCompact(Number(data.pending_amount))}
        tone="warn"
      />
      <KpiTile label="Pending Count" value={String(data.pending_count)} />
      <KpiTile
        label="Reimbursements Due"
        value={moneyCompact(Number(data.reimbursements_outstanding))}
        tone="accent"
      />
    </div>
  );
}

function StatusFilters({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {EXPENSE_STATUS_TABS.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            "px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wide transition-all",
            value === t.value
              ? "bg-accent/20 text-accent-glow border border-accent/30"
              : "bg-text-primary/[0.04] text-text-muted border border-transparent hover:bg-text-primary/[0.08]",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Pagination({
  page,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between pt-3 px-1">
      <span className="text-text-faint text-xs">
        {total} total - Page {page} of {pages}
      </span>
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="ghost"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Prev
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

function exStatusPill(row: Expense) {
  const meta = EXPENSE_STATUS_META[row.status];
  const paid =
    (row.status === "paid" || row.status === "partially_paid") &&
    row.amount_paid_ngn
      ? Number(row.amount_paid_ngn)
      : null;
  return (
    <Pill tone={meta.tone}>
      {meta.label}
      {paid != null && (
        <span className="font-mono normal-case font-normal">
          {" "}
          · {money(paid)}
        </span>
      )}
    </Pill>
  );
}

function formatDate(d: string | null) {
  return fmtDateCanon(d, "-");
}

function ExpensesTable({
  statusFilter,
  onStatusFilter,
  page,
  onPage,
  onSelect,
}: {
  statusFilter: string;
  onStatusFilter: (v: string) => void;
  page: number;
  onPage: (p: number) => void;
  onSelect: (ex: Expense) => void;
}) {
  const { data, isLoading } = useExpenses({
    status: statusFilter || undefined,
    page,
  });

  const cols: Column<Expense>[] = [
    {
      key: "no",
      header: "Expense #",
      width: "130px",
      render: (r) => (
        <span className="font-mono text-xs">{r.expense_number}</span>
      ),
    },
    {
      key: "title",
      header: "Title",
      render: (r) => (
        <span className="truncate max-w-[200px] block">{r.title}</span>
      ),
    },
    {
      key: "type",
      header: "Type",
      width: "120px",
      render: (r) => (
        <span className="text-xs capitalize">
          {r.expense_type.replace(/_/g, " ")}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      width: "120px",
      render: (r) => <MoneyText ngn={Number(r.total_amount_ngn)} />,
    },
    {
      key: "status",
      header: "Status",
      width: "130px",
      render: (r) => exStatusPill(r),
    },
    {
      key: "date",
      header: "Date",
      width: "100px",
      render: (r) => (
        <span className="text-text-muted text-xs">
          {formatDate(r.expense_date)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <DataTable
        columns={cols}
        rows={data?.data ?? []}
        rowKey={(r) => r.expense_id}
        onRowClick={onSelect}
        loading={isLoading}
        toolbar={
          <StatusFilters value={statusFilter} onChange={onStatusFilter} />
        }
        empty={{
          icon: <Receipt className="w-7 h-7" />,
          title: "No expenses recorded",
          message:
            "Expenses from staff reimbursements, petty cash, direct payments, and settled cash requests will appear here.",
        }}
      />
      {data && (
        <Pagination
          page={data.meta.page}
          total={data.meta.total}
          pageSize={data.meta.page_size}
          onPage={onPage}
        />
      )}
    </div>
  );
}
