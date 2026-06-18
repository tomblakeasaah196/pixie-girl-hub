import { useState } from "react";
import { Monitor, Users, User } from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { Card } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ConfirmDialog, ErrorState } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import {
  useAllSessions,
  useMySessions,
  useRevokeSession,
  useRevokeAllSessions,
  useRevokeMySession,
  type UserSession,
} from "@/lib/iam";

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function parseDevice(ua: string | null, label: string | null): string {
  if (label) return label;
  if (!ua) return "Unknown device";

  let browser = "Browser";
  if (ua.includes("Chrome") && !ua.includes("Edg")) browser = "Chrome";
  else if (ua.includes("Firefox")) browser = "Firefox";
  else if (ua.includes("Safari") && !ua.includes("Chrome")) browser = "Safari";
  else if (ua.includes("Edg")) browser = "Edge";

  let os = "";
  if (ua.includes("Windows")) os = "Windows";
  else if (ua.includes("Mac")) os = "macOS";
  else if (ua.includes("Linux")) os = "Linux";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";
  else if (ua.includes("Android")) os = "Android";

  return os ? `${browser} on ${os}` : browser;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "--";
  return new Date(iso).toLocaleString();
}

// ────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────

export function IamSessionsPage() {
  useBreadcrumbs([
    { label: "IAM & Security", href: "/iam-security" },
    { label: "Sessions" },
  ]);

  const [tab, setTab] = useState<"all" | "mine">("all");
  const [revokeTarget, setRevokeTarget] = useState<UserSession | null>(null);
  const [revokeAllUser, setRevokeAllUser] = useState<string | null>(null);

  const allSessions = useAllSessions();
  const mySessions = useMySessions();
  const revokeSession = useRevokeSession();
  const revokeAllSessions = useRevokeAllSessions();
  const revokeMySession = useRevokeMySession();

  // ── Error states ──────────────────────────────────────────
  if (tab === "all" && allSessions.isError) {
    return (
      <ErrorState
        message={(allSessions.error as Error)?.message}
        onRetry={() => allSessions.refetch()}
      />
    );
  }
  if (tab === "mine" && mySessions.isError) {
    return (
      <ErrorState
        message={(mySessions.error as Error)?.message}
        onRetry={() => mySessions.refetch()}
      />
    );
  }

  // ── Columns shared between tabs ───────────────────────────
  const deviceCol: Column<UserSession> = {
    key: "device",
    header: "Device",
    render: (r) => (
      <span className="text-text">{parseDevice(r.user_agent, r.device_label)}</span>
    ),
  };

  const ipCol: Column<UserSession> = {
    key: "ip",
    header: "IP",
    render: (r) => (
      <span className="text-text-muted">{r.ip_address ?? "--"}</span>
    ),
  };

  const createdCol: Column<UserSession> = {
    key: "created",
    header: "Created",
    render: (r) => (
      <span className="text-text-muted text-[12px]">{fmtDate(r.created_at)}</span>
    ),
  };

  const lastSeenCol: Column<UserSession> = {
    key: "last_seen",
    header: "Last seen",
    render: (r) => (
      <span className="text-text-muted text-[12px]">{fmtDate(r.last_seen_at)}</span>
    ),
  };

  const expiresCol: Column<UserSession> = {
    key: "expires",
    header: "Expires",
    render: (r) => (
      <span className="text-text-muted text-[12px]">{fmtDate(r.expires_at)}</span>
    ),
  };

  const actionsCol: Column<UserSession> = {
    key: "actions",
    header: "",
    align: "right" as const,
    width: "100px",
    render: (r) => (
      <button
        onClick={(e) => {
          e.stopPropagation();
          setRevokeTarget(r);
        }}
        className="text-[11px] font-semibold text-danger px-2 h-7 rounded-lg hover:bg-danger/10"
      >
        Revoke
      </button>
    ),
  };

  // ── All Sessions columns (includes User) ──────────────────
  const allColumns: Column<UserSession>[] = [
    {
      key: "user",
      header: "User",
      render: (r) => (
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-text truncate">
            {r.user_name ?? "--"}
          </div>
          <div className="text-[11px] text-text-faint truncate">
            {r.user_email ?? "--"}
          </div>
        </div>
      ),
    },
    deviceCol,
    ipCol,
    createdCol,
    lastSeenCol,
    expiresCol,
    actionsCol,
  ];

  // ── My Sessions columns (no User column) ──────────────────
  const myColumns: Column<UserSession>[] = [
    deviceCol,
    ipCol,
    createdCol,
    lastSeenCol,
    expiresCol,
    actionsCol,
  ];

  const activeData = tab === "all" ? allSessions : mySessions;
  const rows = activeData.data ?? [];
  const columns = tab === "all" ? allColumns : myColumns;

  return (
    <div className="max-w-[1000px] mx-auto space-y-5">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent/10 text-accent-glow border border-accent/20">
          <Monitor className="w-5 h-5" />
        </span>
        <div>
          <h2 className="font-display text-[22px] font-medium">Sessions & Devices</h2>
          <p className="text-text-muted text-[13px]">
            View and revoke active sessions across all users
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-[rgb(var(--border-c))] mb-5">
        {(["all", "mine"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-semibold transition-all border-b-2 -mb-px",
              tab === t
                ? "border-accent text-accent-glow"
                : "border-transparent text-text-muted hover:text-text",
            )}
          >
            {t === "all" ? (
              <Users className="w-4 h-4" />
            ) : (
              <User className="w-4 h-4" />
            )}
            {t === "all" ? "All Sessions" : "My Sessions"}
          </button>
        ))}
      </div>

      {/* Summary card */}
      <Card className="p-4 mb-4 flex items-center gap-3">
        <Monitor className="w-5 h-5 text-accent-glow" />
        <span className="text-[13px]">
          <strong className="font-display">{rows.length}</strong> active session
          {rows.length !== 1 ? "s" : ""}
        </span>
      </Card>

      {/* Data table */}
      <DataTable<UserSession>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.session_id}
        loading={activeData.isLoading}
        empty={{
          icon: <Monitor className="w-5 h-5 text-text-faint" />,
          title: "No sessions",
          message:
            tab === "all"
              ? "There are no active sessions right now."
              : "You have no active sessions.",
        }}
      />

      {/* Revoke single session confirm */}
      <ConfirmDialog
        open={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onConfirm={() => {
          if (revokeTarget) {
            if (tab === "mine") {
              revokeMySession.mutate(revokeTarget.session_id);
            } else {
              revokeSession.mutate(revokeTarget.session_id);
            }
          }
          setRevokeTarget(null);
        }}
        title="Revoke session?"
        message={
          <>
            This will immediately sign out the session for{" "}
            <strong>
              {revokeTarget?.user_name ??
                revokeTarget?.device_label ??
                "this user"}
            </strong>
            .
          </>
        }
        confirmLabel="Revoke"
        busy={revokeSession.isPending || revokeMySession.isPending}
      />

      {/* Revoke all sessions for a user confirm */}
      <ConfirmDialog
        open={!!revokeAllUser}
        onClose={() => setRevokeAllUser(null)}
        onConfirm={() => {
          if (revokeAllUser) {
            revokeAllSessions.mutate(revokeAllUser);
          }
          setRevokeAllUser(null);
        }}
        title="Revoke all sessions?"
        message={
          <>
            This will immediately sign out <strong>all sessions</strong> for this
            user.
          </>
        }
        confirmLabel="Revoke All"
        busy={revokeAllSessions.isPending}
      />
    </div>
  );
}
