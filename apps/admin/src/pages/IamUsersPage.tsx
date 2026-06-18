import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Users,
  Plus,
  UserPlus,
  Shield,
  ShieldOff,
  Monitor,
  Key,
  Link as LinkIcon,
  Loader2,
} from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { Button, Card, Pill } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { Modal } from "@/components/ui/Modal";
import { Select, ConfirmDialog, ErrorState } from "@/components/ui/controls";
import { Field, TextInput } from "@/components/ui/Form";
import {
  useIamUsers,
  useProvisionStaff,
  useProvisionExternal,
  useDeactivateUser,
  useReactivateUser,
  useAdminResetPassword,
  useSendResetLink,
  useUserSessions,
  useRevokeSession,
  type IamUser,
  type UserSession,
} from "@/lib/iam";

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "invited", label: "Invited" },
  { value: "suspended", label: "Suspended" },
  { value: "locked", label: "Locked" },
  { value: "disabled", label: "Disabled" },
] as const;

const PROFILE_OPTIONS = [
  { value: "all", label: "All types" },
  { value: "staff", label: "Staff" },
  { value: "external", label: "External" },
] as const;

const STATUS_TONES: Record<string, "success" | "warn" | "danger" | "neutral" | "info"> = {
  active: "success",
  invited: "info",
  suspended: "warn",
  locked: "danger",
  disabled: "neutral",
};

const PER_PAGE = 25;

// ────────────────────────────────────────────────────────────
// Debounce hook
// ────────────────────────────────────────────────────────────

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ────────────────────────────────────────────────────────────
// Staff Provision Drawer
// ────────────────────────────────────────────────────────────

function StaffDrawer({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (tempPw: string) => void;
}) {
  const navigate = useNavigate();
  const provisionStaff = useProvisionStaff();
  const [profileId, setProfileId] = useState("");
  const [email, setEmail] = useState("");
  const [businesses, setBusinesses] = useState("");

  const reset = useCallback(() => {
    setProfileId("");
    setEmail("");
    setBusinesses("");
    provisionStaff.reset();
  }, [provisionStaff]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleSubmit = () => {
    const biz = businesses
      .split(",")
      .map((b) => b.trim())
      .filter(Boolean);
    provisionStaff.mutate(
      { profileId, email, businesses: biz },
      {
        onSuccess: (data) => {
          handleClose();
          onSuccess(data.temp_password);
        },
      },
    );
  };

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title="Invite Staff"
      subtitle="Create a login for an existing staff profile"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!profileId || !email || provisionStaff.isPending}
            onClick={handleSubmit}
          >
            {provisionStaff.isPending ? "Provisioning..." : "Provision"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Staff Profile ID" hint="ID of existing staff profile">
          <TextInput
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            placeholder="e.g. prof_abc123"
          />
        </Field>
        <Field label="Email">
          <TextInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@company.com"
          />
        </Field>
        <Field label="Businesses" hint="comma-separated business keys">
          <TextInput
            value={businesses}
            onChange={(e) => setBusinesses(e.target.value)}
            placeholder="e.g. acme, globex"
          />
        </Field>
        {provisionStaff.isError && (
          <p className="text-[12px] text-danger">
            {(provisionStaff.error as Error)?.message ?? "Provisioning failed."}
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            handleClose();
            navigate("/org-workflow");
          }}
          className="text-[12px] text-accent-glow hover:underline"
        >
          Need to create a role first?
        </button>
      </div>
    </Drawer>
  );
}

// ────────────────────────────────────────────────────────────
// External Provision Drawer
// ────────────────────────────────────────────────────────────

function ExternalDrawer({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (tempPw: string) => void;
}) {
  const provisionExternal = useProvisionExternal();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [businesses, setBusinesses] = useState("");

  const reset = useCallback(() => {
    setDisplayName("");
    setEmail("");
    setLabel("");
    setBusinesses("");
    provisionExternal.reset();
  }, [provisionExternal]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleSubmit = () => {
    const biz = businesses
      .split(",")
      .map((b) => b.trim())
      .filter(Boolean);
    provisionExternal.mutate(
      {
        display_name: displayName,
        email,
        external_label: label,
        businesses: biz,
      },
      {
        onSuccess: (data) => {
          handleClose();
          onSuccess(data.temp_password);
        },
      },
    );
  };

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title="Provision External Login"
      subtitle="Create a login for an external user"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!displayName || !email || provisionExternal.isPending}
            onClick={handleSubmit}
          >
            {provisionExternal.isPending ? "Provisioning..." : "Provision"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Display Name">
          <TextInput
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Jane Doe"
          />
        </Field>
        <Field label="Email">
          <TextInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@external.com"
          />
        </Field>
        <Field label="Label" hint="e.g. External Auditor">
          <TextInput
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="External Auditor"
          />
        </Field>
        <Field label="Businesses" hint="comma-separated business keys">
          <TextInput
            value={businesses}
            onChange={(e) => setBusinesses(e.target.value)}
            placeholder="e.g. acme, globex"
          />
        </Field>
        {provisionExternal.isError && (
          <p className="text-[12px] text-danger">
            {(provisionExternal.error as Error)?.message ?? "Provisioning failed."}
          </p>
        )}
      </div>
    </Drawer>
  );
}

// ────────────────────────────────────────────────────────────
// Sessions Drawer
// ────────────────────────────────────────────────────────────

function SessionsDrawer({
  user,
  onClose,
}: {
  user: IamUser | null;
  onClose: () => void;
}) {
  const sessions = useUserSessions(user?.user_id);
  const revokeSession = useRevokeSession();

  const parseDevice = (s: UserSession): string => {
    if (s.device_label) return s.device_label;
    if (s.user_agent) {
      const ua = s.user_agent;
      if (ua.includes("Chrome")) return "Chrome";
      if (ua.includes("Firefox")) return "Firefox";
      if (ua.includes("Safari")) return "Safari";
      if (ua.includes("Edge")) return "Edge";
      return ua.slice(0, 40);
    }
    return "Unknown device";
  };

  return (
    <Drawer
      open={!!user}
      onClose={onClose}
      title="Active Sessions"
      subtitle={user ? `${user.display_name} (${user.email})` : undefined}
    >
      {sessions.isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-text-faint" />
        </div>
      )}
      {sessions.isError && (
        <ErrorState
          message="Failed to load sessions."
          onRetry={() => sessions.refetch()}
        />
      )}
      {sessions.data && sessions.data.length === 0 && (
        <p className="text-[13px] text-text-muted text-center py-12">
          No active sessions found.
        </p>
      )}
      {sessions.data && sessions.data.length > 0 && (
        <div className="space-y-2">
          {sessions.data.map((s) => (
            <Card key={s.session_id} className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Monitor className="w-4 h-4 text-text-muted shrink-0" />
                    <span className="text-[13px] font-medium truncate">
                      {parseDevice(s)}
                    </span>
                  </div>
                  <div className="text-[11px] text-text-faint space-y-0.5 pl-6">
                    {s.ip_address && <div>IP: {s.ip_address}</div>}
                    <div>
                      Created: {new Date(s.created_at).toLocaleString()}
                    </div>
                    <div>
                      Last seen: {new Date(s.last_seen_at).toLocaleString()}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => revokeSession.mutate(s.session_id)}
                  disabled={revokeSession.isPending}
                  className="text-[11px] font-semibold text-danger px-2 h-7 rounded-lg hover:bg-danger/10 shrink-0"
                >
                  Revoke
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Drawer>
  );
}

// ────────────────────────────────────────────────────────────
// Reset Password Modal
// ────────────────────────────────────────────────────────────

function ResetPasswordModal({
  user,
  onClose,
  onTempPassword,
}: {
  user: IamUser | null;
  onClose: () => void;
  onTempPassword: (pw: string) => void;
}) {
  const adminReset = useAdminResetPassword();
  const sendLink = useSendResetLink();
  const [linkSent, setLinkSent] = useState(false);

  const handleClose = useCallback(() => {
    setLinkSent(false);
    adminReset.reset();
    sendLink.reset();
    onClose();
  }, [onClose, adminReset, sendLink]);

  const handleGenerate = () => {
    if (!user) return;
    adminReset.mutate(user.user_id, {
      onSuccess: (data) => {
        handleClose();
        onTempPassword(data.temp_password);
      },
    });
  };

  const handleSendLink = () => {
    if (!user) return;
    sendLink.mutate(user.user_id, {
      onSuccess: () => setLinkSent(true),
    });
  };

  return (
    <Modal open={!!user} onClose={handleClose} title="Reset Password">
      <p className="text-[13px] text-text-muted mb-4">
        Choose how to reset the password for{" "}
        <strong className="text-text">{user?.display_name}</strong>.
      </p>
      <div className="space-y-3">
        <Card className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Key className="w-4 h-4 text-accent-glow shrink-0" />
                <span className="text-[13px] font-semibold">
                  Generate temp password
                </span>
              </div>
              <p className="text-[11px] text-text-faint pl-6">
                Creates a one-time password you share with the user.
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={adminReset.isPending}
              onClick={handleGenerate}
            >
              {adminReset.isPending ? "Generating..." : "Generate"}
            </Button>
          </div>
          {adminReset.isError && (
            <p className="text-[12px] text-danger mt-2 pl-6">
              {(adminReset.error as Error)?.message ?? "Reset failed."}
            </p>
          )}
        </Card>
        <Card className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <LinkIcon className="w-4 h-4 text-accent-glow shrink-0" />
                <span className="text-[13px] font-semibold">
                  Send reset link
                </span>
              </div>
              <p className="text-[11px] text-text-faint pl-6">
                Emails a self-service reset link to the user.
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={sendLink.isPending || linkSent}
              onClick={handleSendLink}
            >
              {sendLink.isPending
                ? "Sending..."
                : linkSent
                  ? "Sent"
                  : "Send"}
            </Button>
          </div>
          {sendLink.isError && (
            <p className="text-[12px] text-danger mt-2 pl-6">
              {(sendLink.error as Error)?.message ?? "Failed to send link."}
            </p>
          )}
          {linkSent && (
            <p className="text-[12px] text-success mt-2 pl-6">
              Reset link sent to {user?.email}.
            </p>
          )}
        </Card>
      </div>
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────
// Temp Password Modal
// ────────────────────────────────────────────────────────────

function TempPasswordModal({
  password,
  onClose,
}: {
  password: string | null;
  onClose: () => void;
}) {
  return (
    <Modal open={!!password} onClose={onClose} title="Temporary Password">
      <div className="text-center">
        <Card className="p-4 bg-warn/5 border-warn/30 mb-3">
          <p className="text-[11px] uppercase tracking-wide font-bold text-warn mb-2">
            Shown once only
          </p>
          <div className="font-mono text-[18px] font-bold select-all">
            {password}
          </div>
        </Card>
        <p className="text-[12px] text-text-muted">
          Copy this password and share it securely. It will not be shown again.
        </p>
        <button
          onClick={() => {
            navigator.clipboard.writeText(password ?? "");
          }}
          className="mt-3 h-9 px-4 rounded-[10px] text-[13px] font-semibold bg-accent-deep text-[#F4E9D9] hover:bg-accent"
        >
          Copy to clipboard
        </button>
      </div>
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────
// Main page
// ────────────────────────────────────────────────────────────

export function IamUsersPage() {
  useBreadcrumbs([
    { label: "IAM & Security", href: "/iam-security" },
    { label: "Users & Access" },
  ]);

  // ── state ──
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [statusFilter, setStatusFilter] = useState("all");
  const [profileFilter, setProfileFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState<"staff" | "external" | null>(null);
  const [sessionsUser, setSessionsUser] = useState<IamUser | null>(null);
  const [resetUser, setResetUser] = useState<IamUser | null>(null);
  const [deactivateUser, setDeactivateUser] = useState<IamUser | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  // reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter, profileFilter]);

  // ── queries & mutations ──
  const users = useIamUsers({
    search: debouncedSearch || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    profile_type: profileFilter !== "all" ? profileFilter : undefined,
    page,
    per_page: PER_PAGE,
  });

  const deactivateUserMut = useDeactivateUser();
  const reactivateUserMut = useReactivateUser();

  const handleReactivate = (userId: string) => {
    reactivateUserMut.mutate(userId);
  };

  // ── columns ──
  const columns: Column<IamUser>[] = [
    {
      key: "user",
      header: "User",
      render: (r) => (
        <div className="flex items-center gap-2.5">
          <span className="grid place-items-center w-8 h-8 rounded-full bg-accent/10 text-accent-glow text-[12px] font-bold shrink-0">
            {r.display_name?.[0]?.toUpperCase() ?? "?"}
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-medium truncate">
              {r.display_name}
            </div>
            <div className="text-[11px] text-text-faint truncate">
              {r.email}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      width: "130px",
      render: (r) =>
        r.role_name ? (
          <Pill tone="accent" dot={false}>
            {r.role_name}
          </Pill>
        ) : (
          <span className="text-text-faint">--</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      width: "110px",
      render: (r) => (
        <Pill tone={STATUS_TONES[r.status] ?? "neutral"} dot={false}>
          {r.status}
        </Pill>
      ),
    },
    {
      key: "type",
      header: "Type",
      width: "100px",
      render: (r) =>
        r.profile_type === "external" ? (
          <Pill tone="info" dot={false}>
            {r.external_label ?? "External"}
          </Pill>
        ) : (
          <span className="text-text-faint text-[12px]">Staff</span>
        ),
    },
    {
      key: "mfa",
      header: "MFA",
      width: "60px",
      render: (r) =>
        r.totp_enabled ? (
          <Shield className="w-4 h-4 text-success" />
        ) : (
          <ShieldOff className="w-4 h-4 text-text-faint" />
        ),
    },
    {
      key: "last_login",
      header: "Last login",
      width: "120px",
      render: (r) =>
        r.last_login_at ? (
          <span className="text-[12px] text-text-muted">
            {new Date(r.last_login_at).toLocaleDateString()}
          </span>
        ) : (
          <span className="text-text-faint">--</span>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right" as const,
      width: "180px",
      render: (r) => (
        <div
          className="flex items-center justify-end gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => setSessionsUser(r)}
            className="text-[11px] font-semibold text-text-muted px-2 h-7 rounded-lg hover:bg-text-primary/[0.06]"
          >
            Sessions
          </button>
          <button
            onClick={() => setResetUser(r)}
            className="text-[11px] font-semibold text-text-muted px-2 h-7 rounded-lg hover:bg-text-primary/[0.06]"
          >
            Reset PW
          </button>
          {r.status === "active" ? (
            <button
              onClick={() => setDeactivateUser(r)}
              className="text-[11px] font-semibold text-danger px-2 h-7 rounded-lg hover:bg-danger/10"
            >
              Deactivate
            </button>
          ) : r.status !== "disabled" ? (
            <button
              onClick={() => handleReactivate(r.user_id)}
              className="text-[11px] font-semibold text-success px-2 h-7 rounded-lg hover:bg-success/10"
            >
              Reactivate
            </button>
          ) : null}
        </div>
      ),
    },
  ];

  // ── total pages ──
  const total = users.data?.total ?? 0;
  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <div className="max-w-[1100px] mx-auto space-y-4 pb-12">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent/10 text-accent-glow border border-accent/20">
            <Users className="w-5 h-5" />
          </span>
          <div>
            <h2 className="font-display text-[22px] font-medium">
              Users & Access
            </h2>
            <p className="text-text-muted text-[13px]">
              Provision and manage user accounts
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => setDrawer("staff")}
          >
            Invite Staff
          </Button>
          <Button
            variant="primary"
            icon={<UserPlus className="w-4 h-4" />}
            onClick={() => setDrawer("external")}
          >
            Provision Login
          </Button>
        </div>
      </div>

      {/* Table */}
      {users.isError ? (
        <Card>
          <ErrorState onRetry={() => users.refetch()} />
        </Card>
      ) : (
        <>
          <DataTable<IamUser>
            columns={columns}
            rows={users.data?.rows ?? []}
            rowKey={(r) => r.user_id}
            loading={users.isLoading}
            toolbar={
              <>
                <TextInput
                  placeholder="Search by name or email..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-[240px] !h-9 text-[12px]"
                />
                <Select
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={STATUS_OPTIONS as unknown as { value: string; label: string }[]}
                  className="w-[150px] !h-9 text-[12px]"
                />
                <Select
                  value={profileFilter}
                  onChange={setProfileFilter}
                  options={PROFILE_OPTIONS as unknown as { value: string; label: string }[]}
                  className="w-[140px] !h-9 text-[12px]"
                />
                <span className="text-text-faint text-[12px] ml-auto">
                  {total} users
                </span>
              </>
            }
            empty={{
              icon: <Users className="w-6 h-6" />,
              title: "No users found",
              message:
                search || statusFilter !== "all" || profileFilter !== "all"
                  ? "Try adjusting your filters."
                  : "Provision your first user to get started.",
            }}
          />

          {/* Pagination */}
          {users.data && total > PER_PAGE && (
            <div className="flex items-center justify-between mt-3">
              <span className="text-[12px] text-text-muted">
                Page {page} of {totalPages}
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
                  disabled={page * PER_PAGE >= total}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Drawers */}
      <StaffDrawer
        open={drawer === "staff"}
        onClose={() => setDrawer(null)}
        onSuccess={setTempPassword}
      />
      <ExternalDrawer
        open={drawer === "external"}
        onClose={() => setDrawer(null)}
        onSuccess={setTempPassword}
      />
      <SessionsDrawer
        user={sessionsUser}
        onClose={() => setSessionsUser(null)}
      />

      {/* Modals */}
      <ResetPasswordModal
        user={resetUser}
        onClose={() => setResetUser(null)}
        onTempPassword={setTempPassword}
      />
      <TempPasswordModal
        password={tempPassword}
        onClose={() => setTempPassword(null)}
      />
      <ConfirmDialog
        open={!!deactivateUser}
        onClose={() => setDeactivateUser(null)}
        onConfirm={() => {
          if (deactivateUser) deactivateUserMut.mutate(deactivateUser.user_id);
          setDeactivateUser(null);
        }}
        title="Deactivate user?"
        message={
          <>
            This will disable{" "}
            <strong>{deactivateUser?.display_name}</strong>&apos;s access. They
            will not be able to log in.
          </>
        }
        confirmLabel="Deactivate"
        busy={deactivateUserMut.isPending}
      />
    </div>
  );
}
