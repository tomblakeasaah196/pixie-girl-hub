import { api } from "./api";

// ── Types ──────────────────────────────────────────────────────────────────

export interface Role {
  role_id: string;
  role_name: string;
  business: string | null;
  is_system: boolean;
  description: string | null;
  member_count: number;
  permission_count: number;
  created_at: string;
  updated_at: string;
  permissions?: Permission[];
  members?: RoleMember[];
  /** Contacts §6.12 visibility: null = unrestricted (sees every contact type);
   *  an array restricts the role to those types ([] = sees no contacts). Only
   *  present on GET /access/roles/:id. */
  contact_type_access?: string[] | null;
}

export interface Permission {
  permission_id: string;
  module: string;
  action: string;
  record_scope: "all" | "own" | "team";
  hidden_fields: string[];
}

export interface RoleMember {
  user_id: string;
  business: string;
  granted_at: string;
  expires_at: string | null;
  /** Resolved by the API (join) for display; may be absent on older backends. */
  email?: string;
  is_active?: boolean;
}

/** A login user who can be granted a role in the active brand — the candidate
 *  set for the bulk-assign picker. `role_ids` are the roles they already hold,
 *  so the picker can flag people who are already members. */
export interface GrantableUser {
  user_id: string;
  email: string;
  display_name: string | null;
  profile_type: "staff" | "external";
  status: string;
  external_label: string | null;
  profile_id: string | null;
  job_title: string | null;
  role_ids: string[];
}

/** Result of a bulk role-members grant. */
export interface GrantMembersResult {
  role_id: string;
  business: string;
  granted: string[];
  skipped: { user_id: string; reason: string }[];
  granted_count: number;
  skipped_count: number;
}

/** A role a user holds, for a given business (from GET .../users/:id/roles). */
export interface UserRole {
  user_id: string;
  role_id: string;
  business: string;
  role_name: string;
  is_system: boolean;
  granted_at: string;
  expires_at: string | null;
}

export interface CatalogEntry {
  module: string;
  /** CEO-friendly name (matches the sidebar). Server-provided; may be absent
   *  on older backends, in which case the UI falls back to a local label. */
  label?: string;
  /** Plain-English one-liner shown under the name in the grant UI. */
  description?: string;
  /** Sidebar section this module belongs to (run/workspace/operate/…). */
  group?: string;
  actions: string[];
}

export interface CatalogGroup {
  key: string;
  label: string;
}

/** A contact-type option for the role editor's contacts-visibility control. */
export interface ContactTypeOption {
  key: string;
  label: string;
}

export interface Catalog {
  modules: CatalogEntry[];
  /** Ordered section headers so the UI can band the columns like the sidebar. */
  groups?: CatalogGroup[];
  actions: string[];
  record_scopes: string[];
  /** Contacts §6.12 vocabulary for the per-role contact-type visibility control.
   *  May be absent on older backends — the UI falls back to a local list. */
  contact_types?: ContactTypeOption[];
}

// Action display metadata
export const ACTION_META: Record<string, { label: string; color: string }> = {
  view: { label: "View", color: "#6b7280" },
  create: { label: "Create", color: "#3b82f6" },
  edit: { label: "Edit", color: "#f59e0b" },
  delete: { label: "Delete", color: "#ef4444" },
  approve: { label: "Approve", color: "#a855f7" },
  export: { label: "Export", color: "#14b8a6" },
};

export const RECORD_SCOPE_LABELS: Record<string, string> = {
  all: "All records",
  own: "Own records only",
  team: "Team records",
};

// ── API ────────────────────────────────────────────────────────────────────

export const accessApi = {
  getCatalog: () => api.get<Catalog>("/access/catalog"),
  listRoles: () => api.get<Role[]>("/access/roles"),
  getRole: (id: string) => api.get<Role>(`/access/roles/${id}`),
  createRole: (body: {
    role_name: string;
    description?: string;
    scope?: "brand" | "system";
  }) => api.post<Role>("/access/roles", body),
  updateRole: (
    id: string,
    body: { role_name?: string; description?: string | null },
  ) => api.patch<Role>(`/access/roles/${id}`, body),
  deleteRole: (id: string) => api.delete<void>(`/access/roles/${id}`),
  getRolePermissions: (id: string) =>
    api.get<Permission[]>(`/access/roles/${id}/permissions`),
  // Backend uses PUT to replace the entire permission matrix atomically.
  setRolePermissions: (
    id: string,
    grants: Array<{
      module: string;
      action: string;
      record_scope?: string;
      hidden_fields?: string[];
    }>,
  ) => api.put<Permission[]>(`/access/roles/${id}/permissions`, { grants }),

  // ── contact-type visibility (contacts §6.12) ───────────────
  // null clears the restriction (role sees every type); an array restricts to
  // those types ([] = the role sees no contacts).
  getRoleContactTypes: (id: string) =>
    api.get<string[] | null>(`/access/roles/${id}/contact-types`),
  setRoleContactTypes: (id: string, contact_types: string[] | null) =>
    api.put<string[] | null>(`/access/roles/${id}/contact-types`, {
      contact_types,
    }),

  // ── bulk role membership ───────────────────────────────────
  // Grantable-user picker for the active brand (optionally filtered by name/email).
  listGrantableUsers: (params?: { search?: string }) => {
    const qs = params?.search
      ? `?search=${encodeURIComponent(params.search)}`
      : "";
    return api.get<GrantableUser[]>(`/access/users${qs}`);
  },
  // Grant one role to many users at once.
  grantRoleMembers: (
    roleId: string,
    body: { user_ids: string[]; business: string; expires_at?: string | null },
  ) => api.post<GrantMembersResult>(`/access/roles/${roleId}/members`, body),

  // ── user ⇄ role grants (per business) ──────────────────────
  listUserRoles: (userId: string) =>
    api.get<UserRole[]>(`/access/users/${userId}/roles`),
  grantUserRole: (
    userId: string,
    body: { role_id: string; business: string; expires_at?: string | null },
  ) => api.post<UserRole>(`/access/users/${userId}/roles`, body),
  revokeUserRole: (userId: string, roleId: string, business: string) =>
    api.delete<void>(
      `/access/users/${userId}/roles/${roleId}?business=${encodeURIComponent(business)}`,
    ),
};
