import { useState } from "react";
import {
  ScrollText,
  Download,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from "lucide-react";
import { Button, Card, Pill, Skeleton } from "@/components/ui/primitives";
import type { Tone } from "@/components/ui/primitives";
import { Select, Toggle, ErrorState } from "@/components/ui/controls";
import { TextInput } from "@/components/ui/Form";
import { cn } from "@/lib/cn";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
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

/* ── Helpers ───────────────────────────────────────────────── */

function getActionTone(
  action: string,
): "success" | "warn" | "danger" | "info" | "accent" | "neutral" {
  if (
    [
      "login",
      "logout",
      "password_change",
      "permission_change",
      "provision_login",
      "deactivate_login",
      "failed_login",
      "secret_rotation",
    ].includes(action)
  )
    return "accent";
  if (["create", "account_created"].includes(action)) return "info";
  if (["delete"].includes(action)) return "danger";
  if (["update", "export"].includes(action)) return "warn";
  return "neutral";
}

function isSecurityAction(action: string): boolean {
  return [
    "login",
    "logout",
    "failed_login",
    "password_change",
    "permission_change",
    "provision_login",
    "deactivate_login",
    "invite_sent",
    "account_created",
    "secret_rotation",
  ].includes(action);
}

/* ── DetailCell ────────────────────────────────────────────── */

function DetailCell({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="bg-text-primary/[0.03] rounded-xl p-2.5 border border-line">
      <div className="text-[10px] uppercase tracking-wide font-bold text-text-faint mb-0.5">
        {label}
      </div>
      <div className={cn("text-[12px] truncate", mono && "font-mono")}>
        {value}
      </div>
    </div>
  );
}

/* ── AuditRow ──────────────────────────────────────────────── */

function AuditRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: AuditEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const actionTone: Tone = getActionTone(entry.action);

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-[12px_18px] text-left hover:bg-text-primary/[0.03] transition-colors"
      >
        <div className="flex-1 min-w-0 flex items-center gap-3">
          <span className="text-[12px] text-text-faint tabular-nums w-[140px] shrink-0">
            {new Date(entry.occurred_at).toLocaleString()}
          </span>
          <span className="text-[13px] font-medium truncate w-[120px] shrink-0">
            {entry.user_name}
          </span>
          <Pill tone={actionTone} dot={false}>
            {entry.module}
          </Pill>
          <Pill
            tone={isSecurityAction(entry.action) ? "accent" : "neutral"}
            dot={false}
          >
            {entry.action.replace(/_/g, " ")}
          </Pill>
          {entry.is_sensitive && (
            <AlertTriangle className="w-3.5 h-3.5 text-warn shrink-0" />
          )}
          {entry.ip_address && (
            <span className="text-[11px] text-text-faint font-mono ml-auto shrink-0">
              {entry.ip_address}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-text-faint shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-text-faint shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-[18px] pb-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {entry.table_name && (
              <DetailCell label="Table" value={entry.table_name} />
            )}
            {entry.record_id && (
              <DetailCell label="Record ID" value={entry.record_id} mono />
            )}
            {entry.session_id && (
              <DetailCell
                label="Session"
                value={entry.session_id.slice(0, 12) + "..."}
                mono
              />
            )}
            {entry.business && (
              <DetailCell label="Business" value={entry.business} />
            )}
          </div>

          {entry.before_state && (
            <div>
              <div className="text-[10.5px] uppercase tracking-[0.1em] font-bold text-danger/80 mb-1">
                Before
              </div>
              <pre className="text-[11px] font-mono p-3 rounded-xl bg-danger/5 border border-danger/20 overflow-x-auto max-h-[200px] text-text-muted">
                {JSON.stringify(entry.before_state, null, 2)}
              </pre>
            </div>
          )}

          {entry.after_state && (
            <div>
              <div className="text-[10.5px] uppercase tracking-[0.1em] font-bold text-success/80 mb-1">
                After
              </div>
              <pre className="text-[11px] font-mono p-3 rounded-xl bg-success/5 border border-success/20 overflow-x-auto max-h-[200px] text-text-muted">
                {JSON.stringify(entry.after_state, null, 2)}
              </pre>
            </div>
          )}

          {Object.keys(entry.metadata).length > 0 && (
            <div>
              <div className="text-[10.5px] uppercase tracking-[0.1em] font-bold text-text-muted mb-1">
                Metadata
              </div>
              <pre className="text-[11px] font-mono p-3 rounded-xl bg-text-primary/[0.03] border border-line overflow-x-auto max-h-[200px] text-text-muted">
                {JSON.stringify(entry.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
              Append-only trail of every action
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
                expanded={expandedId === entry.log_id}
                onToggle={() =>
                  setExpandedId(
                    expandedId === entry.log_id ? null : entry.log_id,
                  )
                }
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
    </div>
  );
}
