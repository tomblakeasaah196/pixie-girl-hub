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

export interface CatalogEntry {
  module: string;
  actions: string[];
}

export interface Catalog {
  modules: CatalogEntry[];
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
};
