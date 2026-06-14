import { createBrowserRouter } from "react-router-dom";
import { AppShell } from "@/components/shell/AppShell";
import { CommandCenter } from "@/pages/CommandCenter";
import { SalesPage } from "@/pages/SalesPage";
import { AppearancePage } from "@/pages/AppearancePage";
import { ModulePlaceholder } from "@/pages/ModulePlaceholder";

/**
 * Routes mount under the AppShell. "/" is the Command Center (app grid home).
 * Sales + Settings are example built screens; every other module route renders
 * the placeholder until built via the canon's question gate.
 */
export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <CommandCenter /> },
      { path: "sales", element: <SalesPage /> },
      { path: "settings", element: <AppearancePage /> },
      { path: "*", element: <ModulePlaceholder /> },
    ],
  },
]);
