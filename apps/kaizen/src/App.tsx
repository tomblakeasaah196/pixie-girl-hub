import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { bootstrapSession } from "@/lib/api";
import { useAuth } from "@/stores/auth";
import { Spinner } from "@/components/ui";
import { AppShell } from "@/components/AppShell";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { LoginPage } from "@/pages/LoginPage";
import { AcceptInvitePage } from "@/pages/AcceptInvitePage";
import { ChangePasswordPage } from "@/pages/ChangePasswordPage";
import { OverviewPage } from "@/pages/OverviewPage";
import { OperatorsPage } from "@/pages/OperatorsPage";
import { ErrorsPage } from "@/pages/ErrorsPage";
import { ErrorDetailPage } from "@/pages/ErrorDetailPage";
import { ComingSoonPage } from "@/pages/ComingSoonPage";

function BootGate({ children }: { children: React.ReactNode }) {
  const clear = useAuth((s) => s.clear);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await bootstrapSession(); // silent refresh via httpOnly cookie
      } catch {
        clear();
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [clear]);

  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink-950">
        <Spinner className="h-8 w-8 text-amber" />
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <BootGate>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/accept-invite" element={<AcceptInvitePage />} />
          <Route path="/change-password" element={<ChangePasswordPage />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<AppShell />}>
              <Route path="/" element={<OverviewPage />} />
              <Route path="/operators" element={<OperatorsPage />} />
              <Route path="/errors" element={<ErrorsPage />} />
              <Route path="/errors/:id" element={<ErrorDetailPage />} />
              <Route path="/health" element={<ComingSoonPage />} />
              <Route path="/performance" element={<ComingSoonPage />} />
              <Route path="/backups" element={<ComingSoonPage />} />
              <Route path="/alerts" element={<ComingSoonPage />} />
              <Route path="/settings" element={<ComingSoonPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BootGate>
    </BrowserRouter>
  );
}
