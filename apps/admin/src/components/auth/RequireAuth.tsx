import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore } from "@/stores/auth";
import { BootSplash } from "@/components/auth/BootSplash";

/**
 * Layout guard for the authenticated shell. On first paint the session is
 * "unknown": we run `bootstrap()` (which silently exchanges the httpOnly
 * refresh cookie for an access token) behind a branded splash, then either
 * render the shell or bounce to /login — preserving the attempted path so
 * the user lands where they meant to after signing in.
 */
export function RequireAuth() {
  const status = useAuthStore((s) => s.status);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const location = useLocation();

  useEffect(() => {
    if (status === "unknown") void bootstrap();
  }, [status, bootstrap]);

  if (status === "unknown") return <BootSplash />;
  if (status === "anon")
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}
