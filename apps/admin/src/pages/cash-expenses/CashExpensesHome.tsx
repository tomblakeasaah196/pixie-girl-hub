import { useState, lazy, Suspense } from "react";
import {
  Wallet,
  Receipt,
  Plus,
  ClipboardCheck,
  Banknote,
  AlertTriangle,
  Lock,
} from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { Button, Card, EmptyState, KpiTile, Pill, Skeleton } from "@/components/ui/primitives";
import { MoneyText } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { cn } from "@/lib/cn";
import { moneyCompact } from "@/lib/format";
import {
  useCashRequests,
  useCashRequestKpis,
  useExpenses,
} from "./hooks";
import { CR_STATUS_META, CR_STATUS_TABS, EXPENSE_STATUS_META, EXPENSE_STATUS_TABS, URGENCY_META } from "./constants";
import type { CashRequest, CashRequestStatus, Expense, ExpenseStatus } from "./types";

const CashRequestDetailDrawer = lazy(() => import("./CashRequestDetailDrawer"));
const CreateCashRequestDrawer = lazy(() => import("./CreateCashRequestDrawer"));
const SettlementWizardDrawer = lazy(() => import("./SettlementWizardDrawer"));
const ExpenseDetailDrawer = lazy(() => import("./ExpenseDetailDrawer"));

type Tab = "my-requests" | "approval-queue" | "all-requests" | "expenses";

export default function CashExpensesHome({ defaultTab }: { defaultTab?: Tab }) {
  useBreadcrumbs([{ label: "Cash & Expenses" }]);
  const can = useAuthStore((s) => s.can);

  const [tab, setTab] = useState<Tab>(defaultTab ?? "my-requests");
  const [crStatusFilter, setCrStatusFilter] = useState("");
  const [exStatusFilter, setExStatusFilter] = useState("");
  const [crPage, setCrPage] = useState(1);
  const [exPage, setExPage] = useState(1);

  const [selectedCr, setSelectedCr] = useState<CashRequest | null>(null);
  const [selectedEx, setSelectedEx] = useState<Expense | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showSettle, setShowSettle] = useState<CashRequest | null>(null);

  if (!can("expenses", "view")) {
    return (
      <div className="py-20">
        <EmptyState
          icon={<Lock className="w-8 h-8" />}
          title="Access restricted"
          message="You don't have permission to view cash requests and expenses."
        />
      </div>
    );
  }

  const canApprove = can("expenses", "approve");

  const tabs: { key: Tab; label: string; icon: React.ReactNode; show: boolean }[] = [
    { key: "my-requests", label: "My Requests", icon: <Wallet className="w-4 h-4" />, show: true },
    { key: "approval-queue", label: "Approval Queue", icon: <ClipboardCheck className="w-4 h-4" />, show: canApprove },
    { key: "all-requests", label: "All Cash Requests", icon: <Banknote className="w-4 h-4" />, show: canApprove },
    { key: "expenses", label: "Expenses", icon: <Receipt className="w-4 h-4" />, show: true },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-medium">Cash & Expenses</h1>
          <p className="text-text-muted text-sm mt-0.5">Requests, approvals, disbursements & expenses</p>
        </div>
        {can("expenses", "create") && (
          <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setShowCreate(true)}>
            New Cash Request
          </Button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 glass rounded-2xl overflow-x-auto">
        {tabs.filter((t) => t.show).map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setCrPage(1); setExPage(1); }}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold whitespace-nowrap transition-all",
              tab === t.key
                ? "bg-accent-deep text-[#F4E9D9] shadow-md"
                : "text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05]",
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "my-requests" && (
        <MyRequestsTab
          statusFilter={crStatusFilter}
          onStatusFilter={setCrStatusFilter}
          page={crPage}
          onPage={setCrPage}
          onSelect={setSelectedCr}
          onCreate={() => setShowCreate(true)}
          canCreate={can("expenses", "create")}
        />
      )}
      {tab === "approval-queue" && (
        <ApprovalQueueTab
          page={crPage}
          onSelect={setSelectedCr}
        />
      )}
      {tab === "all-requests" && (
        <AllRequestsTab
          statusFilter={crStatusFilter}
          onStatusFilter={setCrStatusFilter}
          page={crPage}
          onPage={setCrPage}
          onSelect={setSelectedCr}
        />
      )}
      {tab === "expenses" && (
        <ExpensesTab
          statusFilter={exStatusFilter}
          onStatusFilter={setExStatusFilter}
          page={exPage}
          onPage={setExPage}
          onSelect={setSelectedEx}
        />
      )}

      {/* Drawers */}
      <Suspense fallback={null}>
        {selectedCr && (
          <CashRequestDetailDrawer
            request={selectedCr}
            onClose={() => setSelectedCr(null)}
            onSettle={(cr) => { setSelectedCr(null); setShowSettle(cr); }}
          />
        )}
        {showCreate && (
          <CreateCashRequestDrawer
            onClose={() => setShowCreate(false)}
          />
        )}
        {showSettle && (
          <SettlementWizardDrawer
            request={showSettle}
            onClose={() => setShowSettle(null)}
          />
        )}
        {selectedEx && (
          <ExpenseDetailDrawer
            expense={selectedEx}
            onClose={() => setSelectedEx(null)}
          />
        )}
      </Suspense>
    </div>
  );
}

// ── KPI Strip ────────────────────────────────────────────

function CashKpiStrip() {
  const { data, isLoading } = useCashRequestKpis();
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
        label="Pending Approval"
        value={String(data.pending_approval)}
        tone="warn"
      />
      <KpiTile
        label="Awaiting Disbursement"
        value={String(data.approved_awaiting_disbursement)}
        tone="accent"
      />
      <KpiTile
        label="Unsettled Advances"
        value={String(data.unsettled_advances)}
        tone="warn"
      />
      <KpiTile
        label="Disbursed This Month"
        value={moneyCompact(Number(data.disbursed_this_month))}
      />
    </div>
  );
}

// ── Status filter pills ──────────────────────────────────

function StatusFilters({
  tabs: filterTabs,
  value,
  onChange,
}: {
  tabs: readonly { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {filterTabs.map((t) => (
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

// ── Pagination ───────────────────────────────────────────

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
        {total} total · Page {page} of {pages}
      </span>
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Prev
        </Button>
        <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

// ── Shared columns ───────────────────────────────────────

function crStatusPill(status: CashRequestStatus) {
  const meta = CR_STATUS_META[status];
  return <Pill tone={meta.tone}>{meta.label}</Pill>;
}

function exStatusPill(status: ExpenseStatus) {
  const meta = EXPENSE_STATUS_META[status];
  return <Pill tone={meta.tone}>{meta.label}</Pill>;
}

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "2-digit" });
}

// ── My Requests Tab ──────────────────────────────────────

function MyRequestsTab({
  statusFilter,
  onStatusFilter,
  page,
  onPage,
  onSelect,
  onCreate,
  canCreate,
}: {
  statusFilter: string;
  onStatusFilter: (v: string) => void;
  page: number;
  onPage: (p: number) => void;
  onSelect: (cr: CashRequest) => void;
  onCreate: () => void;
  canCreate: boolean;
}) {
  const { data, isLoading, isError, refetch } = useCashRequests({
    status: statusFilter || undefined,
    page,
  });

  const cols: Column<CashRequest>[] = [
    { key: "no", header: "Request #", width: "140px", render: (r) => <span className="font-mono text-xs">{r.request_number}</span> },
    { key: "purpose", header: "Purpose", render: (r) => <span className="truncate max-w-[200px] block">{r.purpose}</span> },
    { key: "amount", header: "Amount", align: "right", width: "130px", render: (r) => <MoneyText ngn={Number(r.amount_requested_ngn)} /> },
    { key: "status", header: "Status", width: "150px", render: (r) => crStatusPill(r.status) },
    { key: "date", header: "Submitted", width: "110px", render: (r) => <span className="text-text-muted text-xs">{formatDate(r.submitted_at || r.created_at)}</span> },
    { key: "urgency", header: "Urgency", width: "100px", render: (r) => {
      const u = URGENCY_META[r.urgency];
      return r.urgency !== "normal" ? <Pill tone={u.tone} dot={false}>{u.label}</Pill> : <span className="text-text-faint text-xs">Normal</span>;
    }},
  ];

  if (isError) {
    return (
      <Card className="p-8">
        <EmptyState
          icon={<AlertTriangle className="w-7 h-7" />}
          title="Failed to load"
          message="Couldn't fetch your cash requests."
          action={<Button variant="secondary" onClick={() => refetch()}>Retry</Button>}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <CashKpiStrip />
      <DataTable
        columns={cols}
        rows={data?.data ?? []}
        rowKey={(r) => r.cash_request_id}
        onRowClick={onSelect}
        loading={isLoading}
        toolbar={<StatusFilters tabs={CR_STATUS_TABS} value={statusFilter} onChange={onStatusFilter} />}
        empty={{
          icon: <Wallet className="w-7 h-7" />,
          title: "No cash requests yet",
          message: "Need funds for a purchase or expense? Request cash and get it approved in minutes.",
          action: canCreate ? (
            <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={onCreate}>
              Request Cash
            </Button>
          ) : undefined,
        }}
      />
      {data && <Pagination page={data.page} total={data.total} pageSize={data.page_size} onPage={onPage} />}
    </div>
  );
}

// ── Approval Queue Tab ───────────────────────────────────

function ApprovalQueueTab({
  page,
  onSelect,
}: {
  page: number;
  onSelect: (cr: CashRequest) => void;
}) {
  const pending = useCashRequests({ status: "pending_finance", page });
  const pendingCeo = useCashRequests({ status: "pending_ceo", page });

  const rows = [
    ...(pending.data?.data ?? []),
    ...(pendingCeo.data?.data ?? []),
  ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const isLoading = pending.isLoading || pendingCeo.isLoading;

  const cols: Column<CashRequest>[] = [
    { key: "no", header: "Request #", width: "130px", render: (r) => <span className="font-mono text-xs">{r.request_number}</span> },
    { key: "purpose", header: "Purpose", render: (r) => <span className="truncate max-w-[180px] block">{r.purpose}</span> },
    { key: "category", header: "Category", width: "130px", render: (r) => <span className="text-xs">{r.category_display}</span> },
    { key: "amount", header: "Amount", align: "right", width: "130px", render: (r) => <MoneyText ngn={Number(r.amount_requested_ngn)} /> },
    { key: "urgency", header: "Urgency", width: "95px", render: (r) => {
      const u = URGENCY_META[r.urgency];
      return <Pill tone={u.tone} dot={r.urgency !== "normal"}>{u.label}</Pill>;
    }},
    { key: "status", header: "Stage", width: "140px", render: (r) => crStatusPill(r.status) },
    { key: "waiting", header: "Waiting", width: "100px", render: (r) => {
      const since = r.submitted_at || r.created_at;
      const hours = Math.round((Date.now() - new Date(since).getTime()) / 3_600_000);
      return <span className={cn("text-xs", hours > 24 ? "text-danger font-bold" : "text-text-muted")}>{hours}h</span>;
    }},
  ];

  return (
    <div className="space-y-4">
      <CashKpiStrip />
      <DataTable
        columns={cols}
        rows={rows}
        rowKey={(r) => r.cash_request_id}
        onRowClick={onSelect}
        loading={isLoading}
        empty={{
          icon: <ClipboardCheck className="w-7 h-7" />,
          title: "Queue is clear",
          message: "No cash requests need your approval right now. You'll be notified when one arrives.",
        }}
      />
    </div>
  );
}

// ── All Requests Tab ─────────────────────────────────────

function AllRequestsTab({
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
  onSelect: (cr: CashRequest) => void;
}) {
  const { data, isLoading } = useCashRequests({ status: statusFilter || undefined, page });

  const cols: Column<CashRequest>[] = [
    { key: "no", header: "Request #", width: "130px", render: (r) => <span className="font-mono text-xs">{r.request_number}</span> },
    { key: "category", header: "Category", width: "130px", render: (r) => <span className="text-xs">{r.category_display}</span> },
    { key: "purpose", header: "Purpose", render: (r) => <span className="truncate max-w-[180px] block">{r.purpose}</span> },
    { key: "amount", header: "Amount", align: "right", width: "120px", render: (r) => <MoneyText ngn={Number(r.amount_requested_ngn)} /> },
    { key: "status", header: "Status", width: "150px", render: (r) => crStatusPill(r.status) },
    { key: "match", header: "Match", width: "110px", render: (r) => {
      if (r.match_status === "not_applicable") return <span className="text-text-faint text-xs">—</span>;
      const toneMap: Record<string, "success" | "warn" | "danger" | "neutral"> = {
        matched: "success", unmatched: "neutral", mismatch: "danger", manual_review: "warn",
      };
      return <Pill tone={toneMap[r.match_status] ?? "neutral"} dot={false}>{r.match_status.replace("_", " ")}</Pill>;
    }},
    { key: "date", header: "Date", width: "100px", render: (r) => <span className="text-text-muted text-xs">{formatDate(r.created_at)}</span> },
  ];

  return (
    <div className="space-y-4">
      <CashKpiStrip />
      <DataTable
        columns={cols}
        rows={data?.data ?? []}
        rowKey={(r) => r.cash_request_id}
        onRowClick={onSelect}
        loading={isLoading}
        toolbar={<StatusFilters tabs={CR_STATUS_TABS} value={statusFilter} onChange={onStatusFilter} />}
        empty={{
          icon: <Banknote className="w-7 h-7" />,
          title: "No cash requests",
          message: "Cash requests from all staff will appear here once submitted.",
        }}
      />
      {data && <Pagination page={data.page} total={data.total} pageSize={data.page_size} onPage={onPage} />}
    </div>
  );
}

// ── Expenses Tab ─────────────────────────────────────────

function ExpensesTab({
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
  const { data, isLoading } = useExpenses({ status: statusFilter || undefined, page });

  const cols: Column<Expense>[] = [
    { key: "no", header: "Expense #", width: "130px", render: (r) => <span className="font-mono text-xs">{r.expense_number}</span> },
    { key: "title", header: "Title", render: (r) => <span className="truncate max-w-[200px] block">{r.title}</span> },
    { key: "type", header: "Type", width: "120px", render: (r) => <span className="text-xs capitalize">{r.expense_type.replace(/_/g, " ")}</span> },
    { key: "amount", header: "Amount", align: "right", width: "120px", render: (r) => <MoneyText ngn={Number(r.total_amount_ngn)} /> },
    { key: "status", header: "Status", width: "130px", render: (r) => exStatusPill(r.status) },
    { key: "date", header: "Date", width: "100px", render: (r) => <span className="text-text-muted text-xs">{formatDate(r.expense_date)}</span> },
  ];

  return (
    <div className="space-y-4">
      <DataTable
        columns={cols}
        rows={data?.data ?? []}
        rowKey={(r) => r.expense_id}
        onRowClick={onSelect}
        loading={isLoading}
        toolbar={<StatusFilters tabs={EXPENSE_STATUS_TABS} value={statusFilter} onChange={onStatusFilter} />}
        empty={{
          icon: <Receipt className="w-7 h-7" />,
          title: "No expenses recorded",
          message: "Expenses from staff reimbursements, petty cash, and direct payments will appear here.",
        }}
      />
      {data && <Pagination page={data.page} total={data.total} pageSize={data.page_size} onPage={onPage} />}
    </div>
  );
}
