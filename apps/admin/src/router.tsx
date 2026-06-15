import { createBrowserRouter } from "react-router-dom";
import { AppShell } from "@/components/shell/AppShell";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { CommandCenter } from "@/pages/CommandCenter";
import { SalesPage } from "@/pages/SalesPage";
import { AppearancePage } from "@/pages/AppearancePage";
import { LoginEditorPage } from "@/pages/LoginEditorPage";
import { ModulePlaceholder } from "@/pages/ModulePlaceholder";
import { LoginPage } from "@/pages/LoginPage";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { SelectEntityPage } from "@/pages/SelectEntityPage";

/**
 * Two trees:
 *  - Public, pre-auth routes (/login, /reset-password) render standalone.
 *  - Everything else sits behind <RequireAuth/>, which restores the session
 *    from the refresh cookie before rendering. /select-entity is authed but
 *    lives OUTSIDE the AppShell (it's a full-screen chooser); the shell and
 *    its module routes are the authenticated app.
 */
export const router = createBrowserRouter(
  [
    { path: "/login", element: <LoginPage /> },
    { path: "/reset-password", element: <ResetPasswordPage /> },
    {
      element: <RequireAuth />,
      children: [
        { path: "/select-entity", element: <SelectEntityPage /> },
        {
          path: "/",
          element: <AppShell />,
          children: [
            { index: true, element: <CommandCenter /> },
            { path: "sales", element: <SalesPage /> },
            { path: "settings", element: <AppearancePage /> },
            { path: "settings/login", element: <LoginEditorPage /> },
            { path: "*", element: <ModulePlaceholder /> },
          ],
        },
      ],
    },
  ],
  // Data-router future flags live here; v7_startTransition is opted into
  // on <RouterProvider> (see App.tsx) since it's a provider-level flag.
  {
    future: {
      v7_relativeSplatPath: true,
    },
  },
);
