import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSocket, joinRoom, leaveRoom, rooms } from "@/lib/socket";
import { useBusinessStore } from "@/stores/business";

/**
 * Live-updates the high-traffic operational boards by turning backend domain
 * events into TanStack query invalidations. Mounted once in the app shell.
 *
 * Before this, Sales / Stock / Service-Jobs screens only refreshed on manual
 * refetch or navigation, even though the backend already emits realtime signals
 * for those changes. This joins the active brand's resource rooms and, on each
 * thin signal, marks the matching queries stale so any mounted board refetches.
 *
 * Invalidation is intentionally coarse (prefix-matched) — the payloads carry
 * only IDs, and re-reading a list is cheap next to the value of an always-fresh
 * ops board. Rooms are re-joined when the active brand changes.
 */
export function useRealtimeInvalidation() {
  const queryClient = useQueryClient();
  const brand = useBusinessStore((s) => s.activeKey);

  useEffect(() => {
    if (!brand) return;

    // Ensure the shared socket exists, then join this brand's resource rooms.
    getSocket();
    const joined = [
      rooms.stock(brand),
      rooms.sales(brand),
      rooms.serviceJobs(brand),
    ];
    joined.forEach(joinRoom);

    const onStock = () =>
      queryClient.invalidateQueries({ queryKey: [brand, "stock"] });

    const onSales = () => {
      queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
      queryClient.invalidateQueries({ queryKey: ["sales-kpis"] });
    };

    const onServiceJobs = () => {
      queryClient.invalidateQueries({ queryKey: ["service-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["service-job"] });
    };

    const onNotification = () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    };

    window.addEventListener("pgh:stock:changed", onStock);
    window.addEventListener("pgh:sales:changed", onSales);
    window.addEventListener("pgh:service_jobs:changed", onServiceJobs);
    window.addEventListener("pgh:notification:new", onNotification);

    return () => {
      window.removeEventListener("pgh:stock:changed", onStock);
      window.removeEventListener("pgh:sales:changed", onSales);
      window.removeEventListener("pgh:service_jobs:changed", onServiceJobs);
      window.removeEventListener("pgh:notification:new", onNotification);
      joined.forEach(leaveRoom);
    };
  }, [brand, queryClient]);
}
