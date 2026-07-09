import { useMemo } from "react";
import { useAuthStore } from "@/stores/auth";
import { MODULES, moduleIsPermitted } from "@/lib/modules";

/**
 * The set of module keys the current user may see, after RBAC gating. Every
 * navigation surface (sidebar, App Grid, mobile bar, ⌘K palette) filters
 * through this so a user never sees an entry point to a module they can't
 * access — the UI half of the permission model; the API enforces the rest.
 *
 * Keyed on the resolved permission grants so it recomputes the moment
 * `loadPermissions()` fills them in after login/refresh. CEOs hold `["*"]`, so
 * every module resolves as permitted.
 */
export function usePermittedModuleKeys(): Set<string> {
  const permissions = useAuthStore((s) => s.user?.permissions);
  const can = useAuthStore((s) => s.can);
  return useMemo(
    () =>
      new Set(
        MODULES.filter((m) => moduleIsPermitted(m, can)).map((m) => m.key),
      ),
    // `can` reads `permissions`; depend on the array so grants loading in
    // after boot re-filter the nav. `can` identity is stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [permissions],
  );
}
