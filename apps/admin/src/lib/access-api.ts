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

export interface Catalog {
  modules: CatalogEntry[];
  /** Ordered section headers so the UI can band the columns like the sidebar. */
  groups?: CatalogGroup[];
  actions: string[];
  record_scopes: string[];
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
