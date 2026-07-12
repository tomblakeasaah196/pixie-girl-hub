import { useState } from "react";
import {
  ScrollText,
  Download,
  AlertTriangle,
  CheckCircle2,
  Pencil,
  Trash2,
  Send,
  MessageCircle,
  ShieldCheck,
  ThumbsUp,
  ThumbsDown,
  Banknote,
  FileDown,
  Eye,
  Activity,
  ChevronRight,
} from "lucide-react";
import { Button, Card, Skeleton } from "@/components/ui/primitives";
import { Select, Toggle, ErrorState } from "@/components/ui/controls";
import { TextInput } from "@/components/ui/Form";
import { formatDateTime } from "@/lib/format";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { humanizeAudit, type AuditKind } from "@/lib/audit-humanize";
import { AuditDetailModal } from "@/components/audit/AuditDetailModal";
import {
  useAuditLog,
  downloadAuditExport,
  type AuditEntry,
  type AuditFilters,
} from "@/lib/iam";

/* ── Option lists ──────────────────────────────────────────── */

const MODULE_OPTIONS = [
  { value: "", label: "All modules" },
  { value: "iam", label: "IAM" },
  { value: "sales", label: "Sales" },
  { value: "crm", label: "CRM" },
  { value: "stock", label: "Stock" },
  { value: "invoicing", label: "Invoicing" },
  { value: "accounting", label: "Accounting" },
  { value: "expenses", label: "Expenses" },
  { value: "purchasing", label: "Purchasing" },
  { value: "production", label: "Production" },
  { value: "settings", label: "Settings" },
  { value: "org_workflow", label: "Org & Workflow" },
  { value: "hr_payroll", label: "HR & Payroll" },
];

const ACTION_OPTIONS = [
  { value: "", label: "All actions" },
  { value: "create", label: "Create" },
  { value: "update", label: "Update" },
  { value: "delete", label: "Delete" },
  { value: "login", label: "Login" },
  { value: "logout", label: "Logout" },
  { value: "permission_change", label: "Permission change" },
  { value: "password_change", label: "Password change" },
  { value: "provision_login", label: "Provision login" },
  { value: "deactivate_login", label: "Deactivate login" },
  { value: "export", label: "Export" },
];

/* ── Kind → icon + tone (drives the row leading badge) ─────── */

const KIND_ICON: Record<AuditKind, typeof CheckCircle2> = {
  security: ShieldCheck,
  message: MessageCircle,
  send: Send,
  create: CheckCircle2,
  update: Pencil,
  delete: Trash2,
  approve: ThumbsUp,
  reject: ThumbsDown,
  money: Banknote,
  export: FileDown,
  view: Eye,
  generic: Activity,
};

const KIND_TONE: Record<AuditKind, string> = {
  security: "bg-accent/[0.14] text-accent-glow",
  message: "bg-info/[0.14] text-info",
  send: "bg-info/[0.14] text-info",
  create: "bg-success/[0.14] text-success",
  update: "bg-warn/[0.14] text-warn",
  delete: "bg-danger/[0.14] text-danger",
  approve: "bg-success/[0.14] text-success",
  reject: "bg-danger/[0.14] text-danger",
  money: "bg-accent/[0.14] text-accent-glow",
  export: "bg-warn/[0.14] text-warn",
  view: "bg-text-primary/[0.06] text-text-muted",
  generic: "bg-text-primary/[0.06] text-text-muted",
};

/* ── AuditRow ──────────────────────────────────────────────── */

function AuditRow({
  entry,
  onOpen,
}: {
  entry: AuditEntry;
  onOpen: () => void;
}) {
  const h = humanizeAudit(entry, { self: false });
  const Icon = KIND_ICON[h.kind];

  return (
    <button
      onClick={onOpen}
      className="w-full flex items-center gap-3.5 p-[14px_18px] text-left hover:bg-text-primary/[0.03] transition-colors"
    >
      <span
        className={`w-[38px] h-[38px] rounded-[11px] grid place-items-center shrink-0 ${KIND_TONE[h.kind]}`}
      >
        <Icon className="w-[17px] h-[17px]" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[13.5px] font-medium text-text-primary truncate">
          {h.text}
        </div>
        <div className="text-[11.5px] text-text-faint truncate">
          {formatDateTime(entry.occurred_at)}
          {entry.ip_address && (
            <span className="font-mono"> · {entry.ip_address}</span>
          )}
        </div>
      </div>
      {entry.is_sensitive && (
        <AlertTriangle className="w-3.5 h-3.5 text-warn shrink-0" />
      )}
      <ChevronRight className="w-4 h-4 text-text-faint shrink-0" />
    </button>
  );
}

/* ── IamAuditPage ──────────────────────────────────────────── */

export function IamAuditPage() {
  useBreadcrumbs([
    { label: "IAM & Security", href: "/iam-security" },
    { label: "Audit Log" },
  ]);

  /* state */
  const [module, setModule] = useState("");
  const [action, setAction] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [isSensitive, setIsSensitive] = useState<boolean | undefined>(
    undefined,
  );
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [exporting, setExporting] = useState(false);

  /* filters + query */
  const filters: AuditFilters = {
    module: module || undefined,
    action: action || undefined,
    user_search: userSearch || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    is_sensitive: isSensitive,
    page,
    per_page: 30,
  };
  const audit = useAuditLog(filters);

  /* export handler */
  async function handleExport(format: "csv" | "xlsx") {
    setExporting(true);
    try {
      await downloadAuditExport(filters, format);
    } catch {
      /* swallow — downloadAuditExport throws on HTTP failure */
    } finally {
      setExporting(false);
    }
  }

  /* error state */
  if (audit.isError) {
    return (
      <ErrorState
        message="Failed to load audit log."
        onRetry={() => audit.refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent/10 text-accent-glow border border-accent/20">
            <ScrollText className="w-5 h-5" />
          </span>
          <div>
            <h2 className="font-display text-[22px] font-medium">Audit Log</h2>
            <p className="text-text-muted text-[13px]">
              Every action, in plain English — tap any entry for the details
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={<Download className="w-4 h-4" />}
            disabled={exporting}
            onClick={() => handleExport("csv")}
          >
            CSV
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<Download className="w-4 h-4" />}
            disabled={exporting}
            onClick={() => handleExport("xlsx")}
          >
            Excel
          </Button>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[10.5px] uppercase tracking-[0.1em] font-bold text-text-muted block mb-1.5">
              Module
            </label>
            <Select
              value={module}
              onChange={(v) => {
                setModule(v);
                setPage(1);
              }}
              options={MODULE_OPTIONS}
              className="w-[150px] !h-9 text-[12px]"
            />
          </div>
          <div>
            <label className="text-[10.5px] uppercase tracking-[0.1em] font-bold text-text-muted block mb-1.5">
              Action
            </label>
            <Select
              value={action}
              onChange={(v) => {
                setAction(v);
                setPage(1);
              }}
              options={ACTION_OPTIONS}
              className="w-[160px] !h-9 text-[12px]"
            />
          </div>
          <div>
            <label className="text-[10.5px] uppercase tracking-[0.1em] font-bold text-text-muted block mb-1.5">
              User
            </label>
            <TextInput
              value={userSearch}
              onChange={(e) => {
                setUserSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search user..."
              className="w-[160px] !h-9 text-[12px]"
            />
          </div>
          <div>
            <label className="text-[10.5px] uppercase tracking-[0.1em] font-bold text-text-muted block mb-1.5">
              From
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
              className="h-9 px-2.5 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50 text-[12px]"
            />
          </div>
          <div>
            <label className="text-[10.5px] uppercase tracking-[0.1em] font-bold text-text-muted block mb-1.5">
              To
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
              className="h-9 px-2.5 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50 text-[12px]"
            />
          </div>
          <div className="flex items-center gap-2 pb-1">
            <Toggle
              checked={isSensitive === true}
              onChange={(v) => {
                setIsSensitive(v ? true : undefined);
                setPage(1);
              }}
              label="Sensitive only"
            />
          </div>
          <span className="text-text-faint text-[12px] ml-auto pb-1">
            {audit.data?.total ?? 0} entries
          </span>
        </div>
      </Card>

      {/* ── Entries list ── */}
      <Card className="overflow-hidden">
        <div className="divide-y divide-[rgb(var(--border-c)/0.5)]">
          {audit.isLoading &&
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="p-4">
                <Skeleton className="w-3/4 h-4" />
              </div>
            ))}
          {!audit.isLoading &&
            (audit.data?.rows ?? []).map((entry) => (
              <AuditRow
                key={entry.log_id}
                entry={entry}
                onOpen={() => setSelected(entry)}
              />
            ))}
        </div>
        {!audit.isLoading && (audit.data?.rows ?? []).length === 0 && (
          <div className="text-center py-14 text-text-muted text-[13px]">
            No audit entries match the current filters.
          </div>
        )}
      </Card>

      {/* ── Pagination ── */}
      {audit.data && audit.data.total > 30 && (
        <div className="flex items-center justify-between mt-3">
          <span className="text-[12px] text-text-muted">
            Page {page} of {Math.ceil(audit.data.total / 30)}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={page * 30 >= audit.data.total}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* ── Detail popup ── */}
      <AuditDetailModal entry={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
