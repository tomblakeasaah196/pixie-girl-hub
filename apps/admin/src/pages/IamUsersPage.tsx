import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
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
  MoreVertical,
  Mail,
  Trash2,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { formatDateTime, formatDate } from "@/lib/format";
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
  useUpdateUserEmail,
  useUserSessions,
  useRevokeSession,
  useTrashedUsers,
  useTrashUser,
  useRestoreUser,
  useUserReferences,
  usePurgeUser,
  type IamUser,
  type UserSession,
  type TrashedUser,
} from "@/lib/iam";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { accessApi } from "@/lib/access-api";
import { listStaff } from "@/lib/hr-api";
import { useBusinesses } from "@/stores/business";

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

const STATUS_TONES: Record<
  string,
  "success" | "warn" | "danger" | "neutral" | "info"
> = {
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

/** Required role + business selection, shared by both provisioning drawers.
 *  Every login must carry at least one role (owner Q4). */
function AccessFields({
  businesses,
  permitted,
  togglePermitted,
  roleId,
  setRoleId,
  onCreateRole,
}: {
  businesses: { key: string; name: string }[];
  permitted: string[];
  togglePermitted: (key: string) => void;
  roleId: string;
  setRoleId: (v: string) => void;
  onCreateRole: () => void;
}) {
  const { data: roles = [] } = useQuery({
    queryKey: ["access-roles"],
    queryFn: () => accessApi.listRoles(),
  });
  return (
    <>
      <Field label="Role *" hint="Decides what this login can see and do">
        <Select
          value={roleId}
          onChange={setRoleId}
          options={[
            { value: "", label: "— Select a role —" },
            ...roles.map((r) => ({ value: r.role_id, label: r.role_name })),
          ]}
        />
      </Field>
      <button
        type="button"
        onClick={onCreateRole}
        className="text-[12px] text-accent-glow hover:underline"
      >
        Need a new role? Create one in Org &amp; Workflow →
      </button>
      <div>
        <div className="micro mb-2">Businesses *</div>
        <div className="flex flex-wrap gap-2">
          {businesses.map((b) => {
            const on = permitted.includes(b.key);
            return (
              <button
                key={b.key}
                type="button"
                onClick={() => togglePermitted(b.key)}
                className={[
                  "px-3 h-[34px] rounded-[9px] text-[12px] font-semibold border transition-all",
                  on
                    ? "bg-accent-deep/[0.15] border-accent-deep/50 text-accent-glow"
                    : "bg-text-primary/[0.04] border-line text-text-muted hover:text-text-primary",
                ].join(" ")}
              >
                {b.name}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

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
  const businesses = useBusinesses();
  const [profileId, setProfileId] = useState("");
  const [email, setEmail] = useState("");
  const [permitted, setPermitted] = useState<string[]>([]);
  const [roleId, setRoleId] = useState("");

  // Staff without a login yet — the pool this drawer can provision for.
  const { data: staffResp } = useQuery({
    queryKey: ["hr", "staff-picker"],
    queryFn: () => listStaff({ page_size: "200" }),
    enabled: open,
  });
  const staff = staffResp?.data ?? [];

  const reset = useCallback(() => {
    setProfileId("");
    setEmail("");
    setPermitted([]);
    setRoleId("");
    provisionStaff.reset();
  }, [provisionStaff]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const togglePermitted = (key: string) =>
    setPermitted((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );

  const canSubmit =
    profileId && email && roleId && permitted.length > 0 && !provisionStaff.isPending;

  const handleSubmit = () => {
    provisionStaff.mutate(
      {
        profileId,
        email,
        default_business: permitted[0],
        permitted_businesses: permitted,
        role_ids: [roleId],
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
      title="Invite Staff"
      subtitle="Create a login for an existing staff profile"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={handleSubmit}>
            {provisionStaff.isPending ? "Provisioning..." : "Provision"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Staff member *">
          <Select
            value={profileId}
            onChange={(v) => {
              setProfileId(v);
              const s = staff.find((x) => x.profile_id === v);
              if (s && !email && (s as { contact_email?: string }).contact_email)
                setEmail((s as { contact_email?: string }).contact_email ?? "");
            }}
            options={[
              { value: "", label: "— Select staff —" },
              ...staff.map((s) => ({
                value: s.profile_id,
                label: `${s.display_name}${s.job_title ? ` · ${s.job_title}` : ""}`,
              })),
            ]}
          />
        </Field>
        <Field label="Email *">
          <TextInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@company.com"
          />
        </Field>
        <AccessFields
          businesses={businesses}
          permitted={permitted}
          togglePermitted={togglePermitted}
          roleId={roleId}
          setRoleId={setRoleId}
          onCreateRole={() => {
            handleClose();
            navigate("/org-workflow");
          }}
        />
        {provisionStaff.isError && (
          <p className="text-[12px] text-danger">
            {(provisionStaff.error as Error)?.message ?? "Provisioning failed."}
          </p>
        )}
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
  const navigate = useNavigate();
  const provisionExternal = useProvisionExternal();
  const businesses = useBusinesses();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [permitted, setPermitted] = useState<string[]>([]);
  const [roleId, setRoleId] = useState("");

  const reset = useCallback(() => {
    setDisplayName("");
    setEmail("");
    setLabel("");
    setPermitted([]);
    setRoleId("");
    provisionExternal.reset();
  }, [provisionExternal]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const togglePermitted = (key: string) =>
    setPermitted((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );

  const canSubmit =
    displayName &&
    email &&
    roleId &&
    permitted.length > 0 &&
    !provisionExternal.isPending;

  const handleSubmit = () => {
    provisionExternal.mutate(
      {
        display_name: displayName,
        email,
        external_label: label,
        default_business: permitted[0],
        permitted_businesses: permitted,
        role_ids: [roleId],
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
          <Button variant="primary" disabled={!canSubmit} onClick={handleSubmit}>
            {provisionExternal.isPending ? "Provisioning..." : "Provision"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Display Name *">
          <TextInput
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Jane Doe"
          />
        </Field>
        <Field label="Email *">
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
        <AccessFields
          businesses={businesses}
          permitted={permitted}
          togglePermitted={togglePermitted}
          roleId={roleId}
          setRoleId={setRoleId}
          onCreateRole={() => {
            handleClose();
            navigate("/org-workflow");
          }}
        />
        {provisionExternal.isError && (
          <p className="text-[12px] text-danger">
            {(provisionExternal.error as Error)?.message ??
              "Provisioning failed."}
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
                    <div>Created: {formatDateTime(s.created_at)}</div>
                    <div>Last seen: {formatDateTime(s.last_seen_at)}</div>
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
              {sendLink.isPending ? "Sending..." : linkSent ? "Sent" : "Send"}
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
// Roles Drawer — assign / reassign a user's roles, per business
// ────────────────────────────────────────────────────────────

function RolesDrawer({
  user,
  onClose,
}: {
  user: IamUser | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const businesses = useBusinesses();
  const [roleId, setRoleId] = useState("");
  const [business, setBusiness] = useState("");

  const held = useQuery({
    queryKey: ["user-roles", user?.user_id],
    queryFn: () => accessApi.listUserRoles(user!.user_id),
    enabled: !!user,
  });
  const { data: roles = [] } = useQuery({
    queryKey: ["access-roles"],
    queryFn: () => accessApi.listRoles(),
    enabled: !!user,
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["user-roles", user?.user_id] });

  const grant = useMutation({
    mutationFn: () =>
      accessApi.grantUserRole(user!.user_id, { role_id: roleId, business }),
    onSuccess: () => {
      setRoleId("");
      setBusiness("");
      invalidate();
    },
  });
  const revoke = useMutation({
    mutationFn: (v: { role_id: string; business: string }) =>
      accessApi.revokeUserRole(user!.user_id, v.role_id, v.business),
    onSuccess: invalidate,
  });

  return (
    <Drawer
      open={!!user}
      onClose={onClose}
      title="Roles & access"
      subtitle={user ? `${user.display_name} (${user.email})` : undefined}
    >
      <div className="space-y-5">
        <div>
          <div className="micro mb-2">Current roles</div>
          {held.isLoading ? (
            <div className="flex items-center gap-2 text-text-faint text-[13px]">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : (held.data ?? []).length === 0 ? (
            <p className="text-[13px] text-warn">
              No roles — this user currently has no access.
            </p>
          ) : (
            <div className="space-y-1.5">
              {(held.data ?? []).map((ur) => (
                <div
                  key={`${ur.role_id}:${ur.business}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line bg-text-primary/[0.03] px-3 py-2"
                >
                  <span className="text-[13px] text-text-primary">
                    {ur.role_name}
                    <span className="text-text-faint">
                      {" "}
                      · {ur.business === "*" ? "All businesses" : ur.business}
                    </span>
                  </span>
                  <button
                    onClick={() =>
                      revoke.mutate({
                        role_id: ur.role_id,
                        business: ur.business,
                      })
                    }
                    disabled={revoke.isPending}
                    className="text-[11px] font-semibold text-danger px-2 h-7 rounded-lg hover:bg-danger/10"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t hairline pt-4 space-y-3">
          <div className="micro">Add a role</div>
          <Field label="Role">
            <Select
              value={roleId}
              onChange={setRoleId}
              options={[
                { value: "", label: "— Select a role —" },
                ...roles.map((r) => ({ value: r.role_id, label: r.role_name })),
              ]}
            />
          </Field>
          <Field label="Business">
            <Select
              value={business}
              onChange={setBusiness}
              options={[
                { value: "", label: "— Select business —" },
                { value: "*", label: "All businesses" },
                ...businesses.map((b) => ({ value: b.key, label: b.name })),
              ]}
            />
          </Field>
          {grant.isError && (
            <p className="text-[12px] text-danger">
              {(grant.error as Error)?.message ?? "Could not grant role."}
            </p>
          )}
          <Button
            variant="primary"
            disabled={!roleId || !business || grant.isPending}
            onClick={() => grant.mutate()}
          >
            {grant.isPending ? "Granting…" : "Grant role"}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

// ────────────────────────────────────────────────────────────
// Row action menu (kebab)
// ────────────────────────────────────────────────────────────

type MenuItem = {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  tone?: "danger";
};

function RowMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="w-7 h-7 grid place-items-center rounded-lg text-text-muted hover:text-text-primary hover:bg-text-primary/[0.08] transition-colors"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      {open && (
        <div className="select-dropdown-list absolute z-50 right-0 top-[calc(100%+4px)] min-w-[180px] rounded-[11px] overflow-hidden py-1">
          {items.map((it, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
              className={[
                "w-full flex items-center gap-2.5 px-3 h-9 text-[12px] font-semibold text-left transition-colors hover:bg-text-primary/[0.06]",
                it.tone === "danger" ? "text-danger" : "text-text-primary",
              ].join(" ")}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Edit email modal
// ────────────────────────────────────────────────────────────

function EditEmailModal({
  user,
  onClose,
}: {
  user: IamUser | null;
  onClose: () => void;
}) {
  const updateEmail = useUpdateUserEmail();
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (user) setEmail(user.email);
  }, [user]);

  const handleClose = useCallback(() => {
    updateEmail.reset();
    onClose();
  }, [updateEmail, onClose]);

  const trimmed = email.trim();
  const changed =
    !!user && !!trimmed && trimmed.toLowerCase() !== user.email.toLowerCase();

  const handleSave = () => {
    if (!user || !changed) return;
    updateEmail.mutate(
      { userId: user.user_id, email: trimmed },
      { onSuccess: handleClose },
    );
  };

  return (
    <Modal open={!!user} onClose={handleClose} title="Edit email address">
      <p className="text-[13px] text-text-muted mb-4">
        Update the login email for{" "}
        <strong className="text-text">{user?.display_name}</strong>. They will
        sign in with the new address.
      </p>
      <Field label="Email address">
        <TextInput
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="user@company.com"
        />
      </Field>
      {updateEmail.isError && (
        <p className="text-[12px] text-danger mt-2">
          {(updateEmail.error as Error)?.message ?? "Could not update email."}
        </p>
      )}
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="ghost" onClick={handleClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!changed || updateEmail.isPending}
          onClick={handleSave}
        >
          {updateEmail.isPending ? "Saving..." : "Save email"}
        </Button>
      </div>
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────
// Permanent-delete (purge) modal — shows why a person can't be
// purged when other records still reference them.
// ────────────────────────────────────────────────────────────

function PurgeModal({
  user,
  onClose,
}: {
  user: TrashedUser | null;
  onClose: () => void;
}) {
  const refs = useUserReferences(user?.user_id);
  const purge = usePurgeUser();

  const handleClose = useCallback(() => {
    purge.reset();
    onClose();
  }, [purge, onClose]);

  const canPurge = refs.data?.can_purge ?? false;

  const handlePurge = () => {
    if (!user) return;
    purge.mutate(user.user_id, { onSuccess: handleClose });
  };

  return (
    <Modal open={!!user} onClose={handleClose} title="Delete permanently">
      {refs.isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-text-faint" />
        </div>
      ) : refs.isError ? (
        <ErrorState
          message="Couldn't check for linked records."
          onRetry={() => refs.refetch()}
        />
      ) : canPurge ? (
        <>
          <p className="text-[13px] text-text-muted mb-4">
            <strong className="text-text">{user?.display_name}</strong> is not
            referenced by any other records and can be removed completely. This{" "}
            <strong className="text-danger">cannot be undone</strong>.
          </p>
          {purge.isError && (
            <p className="text-[12px] text-danger mb-3">
              {(purge.error as Error)?.message ?? "Could not delete."}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <button
              onClick={handlePurge}
              disabled={purge.isPending}
              className="h-9 px-4 rounded-[10px] text-[13px] font-semibold text-white bg-danger hover:brightness-110 disabled:opacity-50"
            >
              {purge.isPending ? "Deleting..." : "Delete forever"}
            </button>
          </div>
        </>
      ) : (
        <>
          <Card className="p-3 bg-warn/5 border-warn/30 mb-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
              <p className="text-[12px] text-text-muted">
                <strong className="text-text">{user?.display_name}</strong> is
                still referenced by other records, so they are kept in the trash
                to preserve those links. Restore them if you need them back.
              </p>
            </div>
          </Card>
          <div className="micro mb-2">
            Referenced by ({refs.data?.reference_count ?? 0})
          </div>
          <div className="max-h-[200px] overflow-y-auto space-y-1">
            {(refs.data?.references ?? []).map((r) => (
              <div
                key={`${r.ref_table}.${r.ref_column}`}
                className="text-[11px] font-mono text-text-faint px-2 py-1 rounded-md bg-text-primary/[0.03] border border-line"
              >
                {r.ref_table}
                <span className="text-text-muted"> · {r.ref_column}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-end mt-4">
            <Button variant="ghost" onClick={handleClose}>
              Close
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────
// Trash view — soft-deleted people; restore or purge
// ────────────────────────────────────────────────────────────

function TrashView() {
  const [page, setPage] = useState(1);
  const [restoreTarget, setRestoreTarget] = useState<TrashedUser | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<TrashedUser | null>(null);

  const trashed = useTrashedUsers({ page, per_page: PER_PAGE });
  const restore = useRestoreUser();

  const total = trashed.data?.total ?? 0;
  const totalPages = Math.ceil(total / PER_PAGE);

  const columns: Column<TrashedUser>[] = [
    {
      key: "user",
      header: "User",
      render: (r) => (
        <div className="flex items-center gap-2.5">
          <span className="grid place-items-center w-8 h-8 rounded-full bg-text-primary/[0.06] text-text-faint text-[12px] font-bold shrink-0">
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
      key: "deleted",
      header: "Trashed",
      width: "180px",
      render: (r) => (
        <div className="text-[12px] text-text-muted">
          {formatDateTime(r.deleted_at)}
          {r.deleted_by_name && (
            <div className="text-[11px] text-text-faint truncate">
              by {r.deleted_by_name}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      render: (r) =>
        r.deletion_reason ? (
          <span className="text-[12px] text-text-muted">
            {r.deletion_reason}
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
            onClick={() => setRestoreTarget(r)}
            className="text-[11px] font-semibold text-success px-2 h-7 rounded-lg hover:bg-success/10 inline-flex items-center gap-1"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Restore
          </button>
          <button
            onClick={() => setPurgeTarget(r)}
            className="text-[11px] font-semibold text-danger px-2 h-7 rounded-lg hover:bg-danger/10 inline-flex items-center gap-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
        </div>
      ),
    },
  ];

  if (trashed.isError)
    return (
      <Card>
        <ErrorState onRetry={() => trashed.refetch()} />
      </Card>
    );

  return (
    <>
      <DataTable<TrashedUser>
        columns={columns}
        rows={trashed.data?.rows ?? []}
        rowKey={(r) => r.user_id}
        loading={trashed.isLoading}
        toolbar={
          <span className="text-text-faint text-[12px] ml-auto">
            {total} in trash
          </span>
        }
        empty={{
          icon: <Trash2 className="w-6 h-6" />,
          title: "Trash is empty",
          message: "Deleted people will appear here and can be restored.",
        }}
      />

      {trashed.data && total > PER_PAGE && (
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

      <ConfirmDialog
        open={!!restoreTarget}
        onClose={() => setRestoreTarget(null)}
        onConfirm={() => {
          if (restoreTarget) restore.mutate(restoreTarget.user_id);
          setRestoreTarget(null);
        }}
        title="Restore user?"
        message={
          <>
            <strong>{restoreTarget?.display_name}</strong> will be restored and
            reappear across the Hub. Their login is re-enabled.
          </>
        }
        confirmLabel="Restore"
        tone="accent"
        busy={restore.isPending}
      />

      <PurgeModal user={purgeTarget} onClose={() => setPurgeTarget(null)} />
    </>
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
  const [view, setView] = useState<"users" | "trash">("users");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [statusFilter, setStatusFilter] = useState("all");
  const [profileFilter, setProfileFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState<"staff" | "external" | null>(null);
  const [sessionsUser, setSessionsUser] = useState<IamUser | null>(null);
  const [rolesUser, setRolesUser] = useState<IamUser | null>(null);
  const [resetUser, setResetUser] = useState<IamUser | null>(null);
  const [editEmailUser, setEditEmailUser] = useState<IamUser | null>(null);
  const [deactivateUser, setDeactivateUser] = useState<IamUser | null>(null);
  const [trashTarget, setTrashTarget] = useState<IamUser | null>(null);
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
  const trashUserMut = useTrashUser();

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
      header: "Roles",
      width: "170px",
      render: (r) => {
        const names = [...new Set((r.roles ?? []).map((ur) => ur.role_name))];
        if (!names.length) return <span className="text-text-faint">--</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {names.map((name) => (
              <Pill key={name} tone="accent" dot={false}>
                {name}
              </Pill>
            ))}
          </div>
        );
      },
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
            {formatDate(r.last_login_at)}
          </span>
        ) : (
          <span className="text-text-faint">--</span>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right" as const,
      width: "200px",
      render: (r) => {
        const menuItems: MenuItem[] = [
          {
            label: "Edit email",
            icon: <Mail className="w-3.5 h-3.5" />,
            onClick: () => setEditEmailUser(r),
          },
        ];
        if (r.status === "active") {
          menuItems.push({
            label: "Deactivate",
            icon: <ShieldOff className="w-3.5 h-3.5" />,
            onClick: () => setDeactivateUser(r),
            tone: "danger",
          });
        } else if (r.status !== "disabled") {
          menuItems.push({
            label: "Reactivate",
            icon: <Shield className="w-3.5 h-3.5" />,
            onClick: () => handleReactivate(r.user_id),
          });
        }
        if (!r.is_ceo) {
          menuItems.push({
            label: "Move to trash",
            icon: <Trash2 className="w-3.5 h-3.5" />,
            onClick: () => setTrashTarget(r),
            tone: "danger",
          });
        }
        return (
          <div
            className="flex items-center justify-end gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setRolesUser(r)}
              className="text-[11px] font-semibold text-accent-glow px-2 h-7 rounded-lg hover:bg-accent/10"
            >
              Roles
            </button>
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
            <RowMenu items={menuItems} />
          </div>
        );
      },
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

      {/* View toggle */}
      <div className="flex items-center gap-1 p-1 rounded-[12px] bg-text-primary/[0.04] border border-line w-fit">
        {(
          [
            { key: "users", label: "Users", icon: Users },
            { key: "trash", label: "Trash", icon: Trash2 },
          ] as const
        ).map((v) => {
          const Icon = v.icon;
          const active = view === v.key;
          return (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={[
                "inline-flex items-center gap-1.5 px-3 h-8 rounded-[9px] text-[12px] font-semibold transition-all",
                active
                  ? "bg-accent-deep/[0.15] text-accent-glow border border-accent-deep/50"
                  : "text-text-muted border border-transparent hover:text-text-primary",
              ].join(" ")}
            >
              <Icon className="w-3.5 h-3.5" />
              {v.label}
            </button>
          );
        })}
      </div>

      {/* Table */}
      {view === "trash" ? (
        <TrashView />
      ) : users.isError ? (
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
                  options={
                    STATUS_OPTIONS as unknown as {
                      value: string;
                      label: string;
                    }[]
                  }
                  className="w-[150px] !h-9 text-[12px]"
                />
                <Select
                  value={profileFilter}
                  onChange={setProfileFilter}
                  options={
                    PROFILE_OPTIONS as unknown as {
                      value: string;
                      label: string;
                    }[]
                  }
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
      <RolesDrawer user={rolesUser} onClose={() => setRolesUser(null)} />

      {/* Modals */}
      <ResetPasswordModal
        user={resetUser}
        onClose={() => setResetUser(null)}
        onTempPassword={setTempPassword}
      />
      <EditEmailModal
        user={editEmailUser}
        onClose={() => setEditEmailUser(null)}
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
            This will disable <strong>{deactivateUser?.display_name}</strong>
            &apos;s access. They will not be able to log in.
          </>
        }
        confirmLabel="Deactivate"
        busy={deactivateUserMut.isPending}
      />
      <ConfirmDialog
        open={!!trashTarget}
        onClose={() => setTrashTarget(null)}
        onConfirm={() => {
          if (trashTarget) trashUserMut.mutate({ userId: trashTarget.user_id });
          setTrashTarget(null);
        }}
        title="Move to trash?"
        message={
          <>
            <strong>{trashTarget?.display_name}</strong> will be removed from
            everywhere in the Hub — HR, Payroll, Contacts and this list — and
            moved to the trash. You can restore them later, or delete them
            permanently once nothing references them.
          </>
        }
        confirmLabel="Move to trash"
        busy={trashUserMut.isPending}
      />
    </div>
  );
}
