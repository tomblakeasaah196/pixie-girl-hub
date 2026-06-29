import { useState, lazy, Suspense } from "react";
import {
  Wallet,
  Plus,
  ClipboardCheck,
  Banknote,
  AlertTriangle,
  Lock,
  FileText,
} from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
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
import { moneyCompact } from "@/lib/format";
import { useCashRequests, useCashRequestKpis } from "./hooks";
import { CR_STATUS_META, CR_STATUS_TABS, URGENCY_META } from "./constants";
import type { CashRequest, CashRequestStatus } from "./types";

const CashRequestDetailDrawer = lazy(() => import("./CashRequestDetailDrawer"));
const CreateCashRequestDrawer = lazy(() => import("./CreateCashRequestDrawer"));
const SettlementWizardDrawer = lazy(() => import("./SettlementWizardDrawer"));

type Tab = "my-requests" | "drafts" | "approval-queue" | "all-requests";

export default function CashRequestsPage() {
  useBreadcrumbs([{ label: "Cash Requests" }]);
  const can = useAuthStore((s) => s.can);

  const [tab, setTab] = useState<Tab>("my-requests");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);

  const [selectedCr, setSelectedCr] = useState<CashRequest | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showSettle, setShowSettle] = useState<CashRequest | null>(null);

  if (!can("expenses", "view")) {
    return (
      <div className="py-20">
        <EmptyState
          icon={<Lock className="w-8 h-8" />}
          title="Access restricted"
          message="You don't have permission to view cash requests."
        />
      </div>
    );
  }

  const canApprove = can("expenses", "approve");

  const tabs: { key: Tab; label: string; icon: React.ReactNode; show: boolean }[] =
    [
      {
        key: "my-requests",
        label: "My Requests",
        icon: <Wallet className="w-4 h-4" />,
        show: true,
      },
      {
        key: "drafts",
        label: "Drafts",
        icon: <FileText className="w-4 h-4" />,
        show: true,
      },
      {
        key: "approval-queue",
        label: "Approval Queue",
        icon: <ClipboardCheck className="w-4 h-4" />,
        show: canApprove,
      },
      {
        key: "all-requests",
        label: "All Cash Requests",
        icon: <Banknote className="w-4 h-4" />,
        show: canApprove,
      },
    ];
  const visibleTabs = tabs.filter((t) => t.show);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-medium">Cash Requests</h1>
          <p className="text-text-muted text-sm mt-0.5">
            Requests, approvals &amp; disbursements
          </p>
        </div>
        {can("expenses", "create") && (
          <Button
            variant="primary"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => setShowCreate(true)}
          >
            New Cash Request
          </Button>
        )}
      </div>

      <div className="flex gap-1 p-1 glass rounded-2xl overflow-x-auto">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              setPage(1);
            }}
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

      {tab === "my-requests" && (
        <RequestsTab
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          page={page}
          onPage={setPage}
          onSelect={setSelectedCr}
          onCreate={() => setShowCreate(true)}
          canCreate={can("expenses", "create")}
        />
      )}
      {tab === "drafts" && (
        <RequestsTab
          statusFilter="draft"
          onStatusFilter={() => {}}
          page={page}
          onPage={setPage}
          onSelect={setSelectedCr}
          onCreate={() => setShowCreate(true)}
          canCreate={can("expenses", "create")}
          lockStatus
        />
      )}
      {tab === "approval-queue" && (
        <ApprovalQueueTab page={page} onSelect={setSelectedCr} />
      )}
      {tab === "all-requests" && (
        <RequestsTab
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          page={page}
          onPage={setPage}
          onSelect={setSelectedCr}
          showCategory
          emptyTitle="No cash requests"
          emptyMessage="Cash requests from all staff will appear here once submitted."
        />
      )}

      <Suspense fallback={null}>
        {selectedCr && (
          <CashRequestDetailDrawer
            request={selectedCr}
            onClose={() => setSelectedCr(null)}
            onSettle={(cr) => {
              setSelectedCr(null);
              setShowSettle(cr);
            }}
          />
        )}
        {showCreate && (
          <CreateCashRequestDrawer onClose={() => setShowCreate(false)} />
        )}
        {showSettle && (
          <SettlementWizardDrawer
            request={showSettle}
            onClose={() => setShowSettle(null)}
          />
        )}
      </Suspense>
    </div>
  );
}

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

function StatusFilters({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {CR_STATUS_TABS.map((t) => (
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

function crStatusPill(status: CashRequestStatus) {
  const meta = CR_STATUS_META[status];
  return <Pill tone={meta.tone}>{meta.label}</Pill>;
}

function formatDate(d: string | null) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
}

function RequestsTab({
  statusFilter,
  onStatusFilter,
  page,
  onPage,
  onSelect,
  onCreate,
  canCreate,
  lockStatus,
  showCategory,
  emptyTitle,
  emptyMessage,
}: {
  statusFilter: string;
  onStatusFilter: (v: string) => void;
  page: number;
  onPage: (p: number) => void;
  onSelect: (cr: CashRequest) => void;
  onCreate?: () => void;
  canCreate?: boolean;
  lockStatus?: boolean;
  showCategory?: boolean;
  emptyTitle?: string;
  emptyMessage?: string;
}) {
  const { data, isLoading, isError, refetch } = useCashRequests({
    status: statusFilter || undefined,
    page,
  });

  const cols: Column<CashRequest>[] = [
    {
      key: "no",
      header: "Request #",
      width: "140px",
      render: (r) => (
        <span className="font-mono text-xs">{r.request_number}</span>
      ),
    },
    ...(showCategory
      ? [
          {
            key: "category",
            header: "Category",
            width: "130px",
            render: (r: CashRequest) => (
              <span className="text-xs">{r.category_display}</span>
            ),
          } as Column<CashRequest>,
        ]
      : []),
    {
      key: "purpose",
      header: "Purpose",
      render: (r) => (
        <span className="truncate max-w-[200px] block">{r.purpose}</span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      width: "130px",
      render: (r) => <MoneyText ngn={Number(r.amount_requested_ngn)} />,
    },
    {
      key: "status",
      header: "Status",
      width: "150px",
      render: (r) => crStatusPill(r.status),
    },
    {
      key: "date",
      header: "Submitted",
      width: "110px",
      render: (r) => (
        <span className="text-text-muted text-xs">
          {formatDate(r.submitted_at || r.created_at)}
        </span>
      ),
    },
  ];

  if (isError) {
    return (
      <Card className="p-8">
        <EmptyState
          icon={<AlertTriangle className="w-7 h-7" />}
          title="Failed to load"
          message="Couldn't fetch cash requests."
          action={
            <Button variant="secondary" onClick={() => refetch()}>
              Retry
            </Button>
          }
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
        toolbar={
          lockStatus ? undefined : (
            <StatusFilters value={statusFilter} onChange={onStatusFilter} />
          )
        }
        empty={{
          icon: <Wallet className="w-7 h-7" />,
          title: emptyTitle || "No cash requests yet",
          message:
            emptyMessage ||
            "Need funds for a purchase? Request cash and get it approved in minutes.",
          action: canCreate ? (
            <Button
              variant="primary"
              icon={<Plus className="w-4 h-4" />}
              onClick={onCreate}
            >
              Request Cash
            </Button>
          ) : undefined,
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
  ].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const isLoading = pending.isLoading || pendingCeo.isLoading;

  const cols: Column<CashRequest>[] = [
    {
      key: "no",
      header: "Request #",
      width: "130px",
      render: (r) => (
        <span className="font-mono text-xs">{r.request_number}</span>
      ),
    },
    {
      key: "purpose",
      header: "Purpose",
      render: (r) => (
        <span className="truncate max-w-[180px] block">{r.purpose}</span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      width: "130px",
      render: (r) => <MoneyText ngn={Number(r.amount_requested_ngn)} />,
    },
    {
      key: "urgency",
      header: "Urgency",
      width: "95px",
      render: (r) => {
        const u = URGENCY_META[r.urgency];
        return (
          <Pill tone={u.tone} dot={r.urgency !== "normal"}>
            {u.label}
          </Pill>
        );
      },
    },
    {
      key: "status",
      header: "Stage",
      width: "140px",
      render: (r) => crStatusPill(r.status),
    },
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
          message: "No cash requests need your approval right now.",
        }}
      />
    </div>
  );
}
