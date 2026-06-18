import { useState } from "react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { Activity } from "lucide-react";
import { Button, Card, Pill } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Select, ErrorState } from "@/components/ui/controls";
import { useSecurityEvents, type SecurityEvent } from "@/lib/iam";

/* ── Helpers ──────────────────────────────────────────────── */

const SECURITY_ACTIONS: { value: string; label: string }[] = [
  { value: "", label: "All events" },
  { value: "login", label: "Login" },
  { value: "logout", label: "Logout" },
  { value: "failed_login", label: "Failed Login" },
  { value: "password_change", label: "Password Change" },
  { value: "permission_change", label: "Permission Change" },
  { value: "provision_login", label: "Provision Login" },
  { value: "deactivate_login", label: "Deactivate Login" },
  { value: "invite_sent", label: "Invite Sent" },
  { value: "account_created", label: "Account Created" },
  { value: "secret_rotation", label: "Secret Rotation" },
];

function getEventTone(
  action: string,
): "success" | "warn" | "danger" | "info" | "accent" | "neutral" {
  if (action === "failed_login") return "danger";
  if (action === "login" || action === "logout") return "success";
  if (action === "deactivate_login") return "danger";
  if (action === "password_change" || action === "secret_rotation") return "warn";
  if (action === "permission_change") return "accent";
  return "info";
}

const PER_PAGE = 30;

/* ── Columns ──────────────────────────────────────────────── */

const columns: Column<SecurityEvent>[] = [
  {
    key: "time",
    header: "Time",
    width: "160px",
    render: (r) => (
      <span className="text-[12px] text-text-muted tabular-nums">
        {new Date(r.occurred_at).toLocaleString()}
      </span>
    ),
  },
  {
    key: "user",
    header: "User",
    render: (r) => (
      <div className="min-w-0">
        <div className="text-[13px] font-medium truncate">{r.user_name}</div>
        {r.user_email && (
          <div className="text-[11px] text-text-faint truncate">{r.user_email}</div>
        )}
      </div>
    ),
  },
  {
    key: "action",
    header: "Action",
    width: "160px",
    render: (r) => {
      const tone = getEventTone(r.action);
      return (
        <Pill tone={tone} dot={false}>
          {r.action.replace(/_/g, " ")}
        </Pill>
      );
    },
  },
  {
    key: "ip",
    header: "IP Address",
    width: "130px",
    render: (r) =>
      r.ip_address ? (
        <span className="font-mono text-[12px] text-text-muted">{r.ip_address}</span>
      ) : (
        <span className="text-text-faint">--</span>
      ),
  },
  {
    key: "status",
    header: "Result",
    width: "90px",
    render: (r) => {
      const isFail = r.action === "failed_login";
      return (
        <Pill tone={isFail ? "danger" : "success"} dot={false}>
          {isFail ? "Failed" : "OK"}
        </Pill>
      );
    },
  },
];

/* ── Page ─────────────────────────────────────────────────── */

export function IamSecurityEventsPage() {
  useBreadcrumbs([
    { label: "IAM & Security", href: "/iam-security" },
    { label: "Security Events" },
  ]);

  const [actionFilter, setActionFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  const events = useSecurityEvents({
    action: actionFilter || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    page,
    per_page: PER_PAGE,
  });

  const total = events.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  /* ── Error state ─────────────────────────────────────────── */
  if (events.isError) {
    return (
      <ErrorState
        message={(events.error as Error)?.message}
        onRetry={() => events.refetch()}
      />
    );
  }

  return (
    <div className="max-w-[1000px] mx-auto space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent/10 text-accent-glow border border-accent/20">
          <Activity className="w-5 h-5" />
        </span>
        <div>
          <h2 className="font-display text-[22px] font-medium">Security Events</h2>
          <p className="text-text-muted text-[13px]">
            Logins, password changes, permission updates, and access events
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[10.5px] uppercase tracking-[0.1em] font-bold text-text-muted block mb-1.5">
              Event type
            </label>
            <Select
              value={actionFilter}
              onChange={(v) => {
                setActionFilter(v);
                setPage(1);
              }}
              options={SECURITY_ACTIONS}
              className="w-[180px] !h-9 text-[12px]"
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
          <span className="text-text-faint text-[12px] ml-auto pb-1">
            {total} events
          </span>
        </div>
      </Card>

      {/* DataTable */}
      <DataTable<SecurityEvent>
        columns={columns}
        rows={events.data?.rows ?? []}
        rowKey={(r) => r.log_id}
        loading={events.isLoading}
        empty={{
          icon: <Activity className="w-6 h-6 text-text-muted" />,
          title: "No security events",
          message: "No events match the current filters.",
        }}
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-text-faint text-[12px]">
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
