import { RouterProvider } from "react-router-dom";
import { QueryProvider } from "@/providers/QueryProvider";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { router } from "@/router";

export default function App() {
  return (
    <QueryProvider>
      <ThemeProvider>
        <RouterProvider router={router} future={{ v7_startTransition: true }} />
      </ThemeProvider>
    </QueryProvider>
  );
}
