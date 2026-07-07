import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "@/App";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { installErrorReporter } from "@/lib/errorReporter";
import "@/index.css";

// Report Kaizen's own frontend crashes to the ingest endpoint (no-op unless
// VITE_KAIZEN_INGEST_URL + VITE_KAIZEN_INGEST_KEY are set).
installErrorReporter({ source: "kaizen" });

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

// Remove the pre-hydration splash once React is mounted.
const splash = document.getElementById("splash");
if (splash) {
  splash.style.transition = "opacity 300ms ease";
  splash.style.opacity = "0";
  setTimeout(() => splash.remove(), 320);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
