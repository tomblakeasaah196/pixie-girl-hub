import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import {
  ShieldCheck, Users, ScrollText, Activity, Monitor, ClipboardCheck, Shield, Lock,
  AlertTriangle, UserX, Clock, ShieldOff, Wifi, GitBranch, ChevronRight,
} from "lucide-react";
import { Card, Pill } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { ErrorState } from "@/components/ui/controls";
import { useSecurityStats, type SecurityEvent } from "@/lib/iam";
import { cn } from "@/lib/cn";

/* ── HealthCard ────────────────────────────────────────────── */
function HealthCard({
  label,
  value,
  tone,
  icon,
  onClick,
  loading,
}: {
  label: string;
  value: number | undefined;
  tone: "success" | "warn" | "danger";
  icon: React.ReactNode;
  onClick: () => void;
  loading?: boolean;
}) {
  const toneMap = {
    success: "border-l-success text-success",
    warn: "border-l-warn text-warn",
    danger: "border-l-danger text-danger",
  };
  return (
    <Card
      className={cn(
        "p-4 border-l-[3px] cursor-pointer transition-all hover:border-accent/40",
        toneMap[tone],
      )}
    >
      <button onClick={onClick} className="w-full text-left">
        <div className="flex items-center gap-2 mb-2">
          {icon}
          <span className="text-[11px] uppercase tracking-wide font-bold text-text-muted">{label}</span>
        </div>
        <div className="font-display text-[28px] font-medium tabular-nums">
          {loading ? "..." : (value ?? 0)}
        </div>
      </button>
    </Card>
  );
}

/* ── Nav tiles config ──────────────────────────────────────── */
const NAV_TILES = [
  { label: "Users & Access", desc: "Provision, manage, and review user accounts", icon: Users, to: "/iam-security/users" },
  { label: "Audit Log", desc: "Append-only trail of every action", icon: ScrollText, to: "/iam-security/audit" },
  { label: "Security Events", desc: "Logins, password changes, permission updates", icon: Activity, to: "/iam-security/events" },
  { label: "Sessions", desc: "Active sessions and device management", icon: Monitor, to: "/iam-security/sessions" },
  { label: "Access Reviews", desc: "Periodic attestation for compliance", icon: ClipboardCheck, to: "/iam-security/reviews" },
  { label: "MFA Setup", desc: "Configure your multi-factor authentication", icon: Shield, to: "/iam-security/mfa" },
];

/* ── Page ──────────────────────────────────────────────────── */
export function IamSecurityPage() {
  useBreadcrumbs([{ label: "IAM & Security" }]);
  const navigate = useNavigate();
  const stats = useSecurityStats();
  const [detailModal, setDetailModal] = useState<string | null>(null);

  if (stats.isError) return <ErrorState message={(stats.error as Error)?.message} onRetry={() => stats.refetch()} />;

  const s = stats.data;
  const loading = stats.isLoading;

  return (
    <div className="max-w-[1000px] space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent/10 text-accent-glow border border-accent/20">
          <ShieldCheck className="w-5 h-5" />
        </span>
        <div>
          <h2 className="font-display text-[22px] font-medium">IAM & Security</h2>
          <p className="text-text-muted text-[13px]">Identity, access, audit, and compliance</p>
        </div>
      </div>

      {/* Health Cards grid (3 columns, 2 rows = 6 cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <HealthCard
          label="Failed Logins (24h)"
          value={s?.failed_logins_24h?.length ?? 0}
          tone={(s?.failed_logins_24h?.length ?? 0) > 0 ? "danger" : "success"}
          icon={<AlertTriangle className="w-4 h-4" />}
          onClick={() => setDetailModal("failed_logins")}
          loading={loading}
        />
        <HealthCard
          label="Inactive Accounts"
          value={s?.inactive_accounts}
          tone={(s?.inactive_accounts ?? 0) > 5 ? "warn" : "success"}
          icon={<UserX className="w-4 h-4" />}
          onClick={() => setDetailModal("inactive")}
          loading={loading}
        />
        <HealthCard
          label="Locked Accounts"
          value={s?.locked_accounts}
          tone={(s?.locked_accounts ?? 0) > 0 ? "danger" : "success"}
          icon={<Lock className="w-4 h-4" />}
          onClick={() => setDetailModal("locked")}
          loading={loading}
        />
        <HealthCard
          label="Pending Invites"
          value={s?.pending_invites}
          tone={(s?.pending_invites ?? 0) > 10 ? "warn" : "success"}
          icon={<Clock className="w-4 h-4" />}
          onClick={() => setDetailModal("pending_invites")}
          loading={loading}
        />
        <HealthCard
          label="Users Without MFA"
          value={s?.users_without_mfa}
          tone={(s?.users_without_mfa ?? 0) > 0 ? "warn" : "success"}
          icon={<ShieldOff className="w-4 h-4" />}
          onClick={() => setDetailModal("no_mfa")}
          loading={loading}
        />
        <HealthCard
          label="Active Sessions"
          value={s?.active_sessions}
          tone="success"
          icon={<Wifi className="w-4 h-4" />}
          onClick={() => setDetailModal("sessions")}
          loading={loading}
        />
      </div>

      {/* Quick nav tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {NAV_TILES.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.to}
              onClick={() => navigate(t.to)}
              className="glass rounded-[var(--radius)] shadow-glass p-4 flex items-center gap-3.5 transition-all group hover:border-accent/40 text-left w-full"
            >
              <span className="grid place-items-center w-10 h-10 rounded-xl bg-accent/10 text-accent-glow border border-accent/20 shrink-0">
                <Icon className="w-[18px] h-[18px]" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="font-display text-[15px] block">{t.label}</span>
                <span className="block text-text-faint text-[12px] mt-0.5 leading-snug">{t.desc}</span>
              </span>
              <ChevronRight className="w-[18px] h-[18px] text-text-faint group-hover:text-accent-glow group-hover:translate-x-0.5 transition-all shrink-0" />
            </button>
          );
        })}
      </div>

      {/* Deep-link to Org & Workflow */}
      <Card className="p-4 border-info/30 bg-info/5">
        <button onClick={() => navigate("/org-workflow")} className="flex items-center gap-3 w-full text-left">
          <span className="grid place-items-center w-10 h-10 rounded-xl bg-info/10 text-info border border-info/20 shrink-0">
            <GitBranch className="w-[18px] h-[18px]" />
          </span>
          <span className="flex-1">
            <span className="font-display text-[15px] block">Roles & Permissions</span>
            <span className="block text-text-faint text-[12px] mt-0.5">Managed in Org & Workflow</span>
          </span>
          <ChevronRight className="w-[18px] h-[18px] text-info shrink-0" />
        </button>
      </Card>

      {/* Recent security events feed */}
      <div>
        <h3 className="text-[11px] uppercase tracking-wide font-bold text-text-muted mb-3">Recent security events</h3>
        <Card className="p-5">
          {!s?.recent_events || s.recent_events.length === 0 ? (
            <p className="text-text-muted text-[13px] text-center py-4">No recent events</p>
          ) : (
            <div>
              {s.recent_events.slice(0, 10).map((evt: SecurityEvent) => (
                <div key={evt.log_id} className="flex items-start gap-3 py-3 border-b hairline last:border-0">
                  <div className="w-8 h-8 rounded-lg bg-accent/10 grid place-items-center shrink-0 mt-0.5">
                    <Activity className="w-3.5 h-3.5 text-accent-glow" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px]">
                      <span className="font-medium">{evt.user_name}</span>
                      <span className="text-text-muted"> {evt.action.replace(/_/g, " ")}</span>
                    </div>
                    <div className="text-[11px] text-text-faint mt-0.5">
                      {new Date(evt.occurred_at).toLocaleString()}{evt.ip_address && ` · ${evt.ip_address}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── Detail modals ──────────────────────────────────── */}

      {/* Failed Logins */}
      <Modal open={detailModal === "failed_logins"} onClose={() => setDetailModal(null)} title="Failed Logins (24h)">
        {!s?.failed_logins_24h?.length ? (
          <p className="text-text-muted text-[13px]">No failed login attempts in the last 24 hours.</p>
        ) : (
          <div className="space-y-2">
            {s.failed_logins_24h.map((u, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-text-primary/[0.03] border border-line">
                <div>
                  <div className="text-[13px] font-medium">{u.user_name}</div>
                  <div className="text-[11px] text-text-faint">{u.user_email}</div>
                </div>
                <Pill tone="danger" dot={false}>{u.count} attempts</Pill>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Inactive Accounts */}
      <Modal open={detailModal === "inactive"} onClose={() => setDetailModal(null)} title="Inactive Accounts (90d+)">
        <div className="text-center py-4">
          <div className="font-display text-[36px] font-medium text-warn mb-2">{s?.inactive_accounts ?? 0}</div>
          <p className="text-text-muted text-[13px]">accounts with no login in the last 90 days</p>
          <button
            onClick={() => { setDetailModal(null); navigate("/iam-security/users?status=active"); }}
            className="mt-3 text-[13px] text-accent-glow hover:underline"
          >
            View in Users & Access &rarr;
          </button>
        </div>
      </Modal>

      {/* Locked Accounts */}
      <Modal open={detailModal === "locked"} onClose={() => setDetailModal(null)} title="Locked Accounts">
        <div className="text-center py-4">
          <div className="font-display text-[36px] font-medium text-danger mb-2">{s?.locked_accounts ?? 0}</div>
          <p className="text-text-muted text-[13px]">accounts currently locked due to repeated failed logins</p>
          <button
            onClick={() => { setDetailModal(null); navigate("/iam-security/users?status=locked"); }}
            className="mt-3 text-[13px] text-accent-glow hover:underline"
          >
            View in Users & Access &rarr;
          </button>
        </div>
      </Modal>

      {/* Pending Invites */}
      <Modal open={detailModal === "pending_invites"} onClose={() => setDetailModal(null)} title="Pending Invites">
        <div className="text-center py-4">
          <div className="font-display text-[36px] font-medium text-warn mb-2">{s?.pending_invites ?? 0}</div>
          <p className="text-text-muted text-[13px]">invitations that have not yet been accepted</p>
          <button
            onClick={() => { setDetailModal(null); navigate("/iam-security/users?status=invited"); }}
            className="mt-3 text-[13px] text-accent-glow hover:underline"
          >
            View in Users & Access &rarr;
          </button>
        </div>
      </Modal>

      {/* Users Without MFA */}
      <Modal open={detailModal === "no_mfa"} onClose={() => setDetailModal(null)} title="Users Without MFA">
        <div className="text-center py-4">
          <div className="font-display text-[36px] font-medium text-warn mb-2">{s?.users_without_mfa ?? 0}</div>
          <p className="text-text-muted text-[13px]">active users without multi-factor authentication enabled</p>
          <button
            onClick={() => { setDetailModal(null); navigate("/iam-security/mfa"); }}
            className="mt-3 text-[13px] text-accent-glow hover:underline"
          >
            Go to MFA Setup &rarr;
          </button>
        </div>
      </Modal>

      {/* Active Sessions */}
      <Modal open={detailModal === "sessions"} onClose={() => setDetailModal(null)} title="Active Sessions">
        <div className="text-center py-4">
          <div className="font-display text-[36px] font-medium text-success mb-2">{s?.active_sessions ?? 0}</div>
          <p className="text-text-muted text-[13px]">sessions currently active across all users</p>
          <button
            onClick={() => { setDetailModal(null); navigate("/iam-security/sessions"); }}
            className="mt-3 text-[13px] text-accent-glow hover:underline"
          >
            View Sessions &rarr;
          </button>
        </div>
      </Modal>
    </div>
  );
}
