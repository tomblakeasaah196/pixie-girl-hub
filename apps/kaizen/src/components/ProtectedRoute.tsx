import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/stores/auth";

/** Gate for authenticated routes. Assumes the initial silent refresh has
 *  already resolved (App shows a loader until then). Forces the change-password
 *  screen while the operator still carries a temporary password. */
export function ProtectedRoute() {
  const { status, operator } = useAuth();
  const location = useLocation();

  if (status !== "authed" || !operator) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (operator.must_change_password && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }
  return <Outlet />;
}
