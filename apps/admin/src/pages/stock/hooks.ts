import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBusinessStore } from "@/stores/business";
import { toast } from "@/stores/toast";
import { stockApi } from "./api";

function useBrand() {
  return useBusinessStore((s) => s.activeKey);
}

/** Server error message (ApiError.message) or a safe fallback. */
function errText(e: unknown): string {
  return e instanceof Error && e.message
    ? e.message
    : "Something went wrong. Please try again.";
}

/** Toast a failed write so it never looks like "nothing happened". */
const onWriteError = (action: string) => (e: unknown) =>
  toast.error(`Couldn't ${action}`, {
    description: errText(e),
    report: { area: "Stock", action, message: errText(e) },
  });

export function useStockLocations() {
  const brand = useBrand();
  return useQuery({
    queryKey: [brand, "stock", "locations"],
    queryFn: () => stockApi.listLocations(),
  });
}

export function useStockValuation(filters?: { location_id?: string }) {
  const brand = useBrand();
  return useQuery({
    queryKey: [brand, "stock", "valuation", filters],
    queryFn: () => stockApi.valuation(filters),
  });
}

export function useStockLevels(params: {
  variant_id?: string;
  location_id?: string;
  page?: number;
  page_size?: number;
}) {
  const brand = useBrand();
  return useQuery({
    queryKey: [brand, "stock", "levels", params],
    queryFn: () => stockApi.listLevels(params),
  });
}

/** Base-product stock register (Stock → Products). Search, location, state
 *  and sort are all server-side, so a filter spans the whole catalogue rather
 *  than the page on screen. `placeholderData` keeps the previous page visible
 *  while typing so the table doesn't flash empty on every keystroke. */
export function useProductStock(params: {
  q?: string;
  location_id?: string;
  category_id?: string;
  stock_state?: string;
  sort?: string;
  page?: number;
  page_size?: number;
}) {
  const brand = useBrand();
  return useQuery({
    queryKey: [brand, "stock", "products", params],
    queryFn: () => stockApi.listProductStock(params),
    placeholderData: (prev) => prev,
  });
}

export function useStockMovements(params: {
  variant_id?: string;
  movement_type?: string;
  reference_id?: string;
  page?: number;
  page_size?: number;
}) {
  const brand = useBrand();
  return useQuery({
    queryKey: [brand, "stock", "movements", params],
    queryFn: () => stockApi.listMovements(params),
  });
}

/** Detail for a single movement — the source document behind it. */
export function useStockMovement(id: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: [brand, "stock", "movement", id],
    queryFn: () => stockApi.getMovement(id!),
    enabled: !!id,
  });
}

export function useStockAdjustments(params: {
  status?: string;
  location_id?: string;
  page?: number;
  page_size?: number;
}) {
  const brand = useBrand();
  return useQuery({
    queryKey: [brand, "stock", "adjustments", params],
    queryFn: () => stockApi.listAdjustments(params),
  });
}

export function useStockAdjustment(id: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: [brand, "stock", "adjustment", id],
    queryFn: () => stockApi.getAdjustment(id!),
    enabled: !!id,
  });
}

export function useStockTransfers(params: {
  status?: string;
  page?: number;
  page_size?: number;
}) {
  const brand = useBrand();
  return useQuery({
    queryKey: [brand, "stock", "transfers", params],
    queryFn: () => stockApi.listTransfers(params),
  });
}

export function useStockTransfer(id: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: [brand, "stock", "transfer", id],
    queryFn: () => stockApi.getTransfer(id!),
    enabled: !!id,
  });
}

export function useStockAlerts(params: {
  status?: string;
  variant_id?: string;
  page?: number;
  page_size?: number;
}) {
  const brand = useBrand();
  return useQuery({
    queryKey: [brand, "stock", "alerts", params],
    queryFn: () => stockApi.listAlerts(params),
    refetchInterval: 30_000,
  });
}

export function useInboundShipments(params: {
  status?: string;
  page?: number;
  page_size?: number;
}) {
  const brand = useBrand();
  return useQuery({
    queryKey: [brand, "stock", "shipments", params],
    queryFn: () => stockApi.listShipments(params),
  });
}

export function useInboundShipment(id: string | null) {
  const brand = useBrand();
  return useQuery({
    queryKey: [brand, "stock", "shipment", id],
    queryFn: () => stockApi.getShipment(id!),
    enabled: !!id,
  });
}

export function useStockMutations() {
  const brand = useBrand();
  const qc = useQueryClient();
  const invalidate = (...keys: string[]) =>
    qc.invalidateQueries({ queryKey: [brand, "stock", ...keys] });

  return {
    createLocation: useMutation({
      mutationFn: stockApi.createLocation,
      onSuccess: () => {
        invalidate("locations");
        toast.success("Location created");
      },
      onError: onWriteError("create the location"),
    }),
    updateLocation: useMutation({
      mutationFn: ({
        id,
        patch,
      }: {
        id: string;
        patch: Partial<Record<string, unknown>>;
      }) => stockApi.updateLocation(id, patch as never),
      onSuccess: () => {
        invalidate("locations");
        toast.success("Location updated");
      },
      onError: onWriteError("update the location"),
    }),
    recordMovement: useMutation({
      mutationFn: stockApi.recordMovement,
      onSuccess: () => {
        invalidate("movements");
        invalidate("levels");
        invalidate("products");
        invalidate("valuation");
        toast.success("Movement logged");
      },
      onError: onWriteError("log the movement"),
    }),
    createAdjustment: useMutation({
      mutationFn: stockApi.createAdjustment,
      onSuccess: () => invalidate("adjustments"),
      onError: onWriteError("create the adjustment"),
    }),
    submitAdjustment: useMutation({
      mutationFn: stockApi.submitAdjustment,
      onSuccess: () => invalidate("adjustments"),
      onError: onWriteError("submit the adjustment for approval"),
    }),
    approveAdjustment: useMutation({
      mutationFn: stockApi.approveAdjustment,
      onSuccess: () => {
        invalidate("adjustments");
        invalidate("levels");
        invalidate("products");
        invalidate("valuation");
      },
      onError: onWriteError("approve the adjustment"),
    }),
    rejectAdjustment: useMutation({
      mutationFn: stockApi.rejectAdjustment,
      onSuccess: () => {
        invalidate("adjustments");
        toast.success("Adjustment rejected");
      },
      onError: onWriteError("reject the adjustment"),
    }),
    postAdjustment: useMutation({
      mutationFn: stockApi.postAdjustment,
      onSuccess: () => {
        invalidate("adjustments");
        invalidate("levels");
        invalidate("products");
        invalidate("valuation");
        invalidate("movements");
      },
      onError: onWriteError("post the adjustment"),
    }),
    createTransfer: useMutation({
      mutationFn: stockApi.createTransfer,
      onSuccess: () => {
        invalidate("transfers");
        invalidate("levels");
        invalidate("products");
        invalidate("movements");
        toast.success("Transfer sent");
      },
      onError: onWriteError("create the transfer"),
    }),
    dispatchTransfer: useMutation({
      mutationFn: stockApi.dispatchTransfer,
      onSuccess: () => {
        invalidate("transfers");
        invalidate("levels");
        invalidate("products");
        invalidate("movements");
        toast.success("Transfer dispatched");
      },
      onError: onWriteError("dispatch the transfer"),
    }),
    receiveTransfer: useMutation({
      mutationFn: ({
        id,
        input,
      }: {
        id: string;
        input: Record<string, unknown>;
      }) => stockApi.receiveTransfer(id, input),
      onSuccess: () => {
        invalidate("transfers");
        invalidate("levels");
        invalidate("products");
        invalidate("movements");
        toast.success("Transfer received");
      },
      onError: onWriteError("receive the transfer"),
    }),
    acknowledgeAlert: useMutation({
      mutationFn: stockApi.acknowledgeAlert,
      onSuccess: () => invalidate("alerts"),
      onError: onWriteError("acknowledge the alert"),
    }),
    dismissAlert: useMutation({
      mutationFn: stockApi.dismissAlert,
      onSuccess: () => invalidate("alerts"),
      onError: onWriteError("dismiss the alert"),
    }),
    resolveAlert: useMutation({
      mutationFn: stockApi.resolveAlert,
      onSuccess: () => {
        invalidate("alerts");
        toast.success("Alert resolved");
      },
      onError: onWriteError("resolve the alert"),
    }),
    createShipment: useMutation({
      mutationFn: stockApi.createShipment,
      onSuccess: () => {
        invalidate("shipments");
        toast.success("Shipment created");
      },
      onError: onWriteError("create the shipment"),
    }),
    createGoodsReceipt: useMutation({
      mutationFn: stockApi.createGoodsReceipt,
      onSuccess: () => {
        invalidate("shipments");
        invalidate("levels");
        invalidate("products");
        invalidate("movements");
        invalidate("valuation");
        toast.success("Goods receipt logged");
      },
      onError: onWriteError("log the goods receipt"),
    }),
    updateShipmentStatus: useMutation({
      mutationFn: ({ id, status }: { id: string; status: string }) =>
        stockApi.updateShipmentStatus(id, status),
      onSuccess: () => invalidate("shipments"),
      onError: onWriteError("update the shipment status"),
    }),
    receiveShipment: useMutation({
      mutationFn: ({
        id,
        input,
      }: {
        id: string;
        input: Record<string, unknown>;
      }) => stockApi.receiveShipment(id, input),
      onSuccess: () => {
        invalidate("shipments");
        invalidate("levels");
        invalidate("products");
        invalidate("movements");
        toast.success("Shipment received");
      },
      onError: onWriteError("receive the shipment"),
    }),
  };
}
