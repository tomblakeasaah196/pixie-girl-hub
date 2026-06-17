import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBusinessStore } from "@/stores/business";
import { stockApi } from "./api";

function useBrand() {
  return useBusinessStore((s) => s.activeKey);
}

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

export function useStockLevels(params: { variant_id?: string; location_id?: string; page?: number; page_size?: number }) {
  const brand = useBrand();
  return useQuery({
    queryKey: [brand, "stock", "levels", params],
    queryFn: () => stockApi.listLevels(params),
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

export function useStockAdjustments(params: { status?: string; location_id?: string; page?: number; page_size?: number }) {
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

export function useStockTransfers(params: { status?: string; page?: number; page_size?: number }) {
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

export function useStockAlerts(params: { status?: string; variant_id?: string; page?: number; page_size?: number }) {
  const brand = useBrand();
  return useQuery({
    queryKey: [brand, "stock", "alerts", params],
    queryFn: () => stockApi.listAlerts(params),
    refetchInterval: 30_000,
  });
}

export function useInboundShipments(params: { status?: string; page?: number; page_size?: number }) {
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
  const invalidate = (...keys: string[]) => qc.invalidateQueries({ queryKey: [brand, "stock", ...keys] });

  return {
    createLocation: useMutation({
      mutationFn: stockApi.createLocation,
      onSuccess: () => invalidate("locations"),
    }),
    updateLocation: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: Partial<Record<string, unknown>> }) =>
        stockApi.updateLocation(id, patch as never),
      onSuccess: () => invalidate("locations"),
    }),
    recordMovement: useMutation({
      mutationFn: stockApi.recordMovement,
      onSuccess: () => { invalidate("movements"); invalidate("levels"); invalidate("valuation"); },
    }),
    createAdjustment: useMutation({
      mutationFn: stockApi.createAdjustment,
      onSuccess: () => invalidate("adjustments"),
    }),
    submitAdjustment: useMutation({
      mutationFn: stockApi.submitAdjustment,
      onSuccess: () => invalidate("adjustments"),
    }),
    approveAdjustment: useMutation({
      mutationFn: stockApi.approveAdjustment,
      onSuccess: () => { invalidate("adjustments"); invalidate("levels"); invalidate("valuation"); },
    }),
    rejectAdjustment: useMutation({
      mutationFn: stockApi.rejectAdjustment,
      onSuccess: () => invalidate("adjustments"),
    }),
    postAdjustment: useMutation({
      mutationFn: stockApi.postAdjustment,
      onSuccess: () => { invalidate("adjustments"); invalidate("levels"); invalidate("valuation"); invalidate("movements"); },
    }),
    createTransfer: useMutation({
      mutationFn: stockApi.createTransfer,
      onSuccess: () => invalidate("transfers"),
    }),
    dispatchTransfer: useMutation({
      mutationFn: stockApi.dispatchTransfer,
      onSuccess: () => { invalidate("transfers"); invalidate("levels"); invalidate("movements"); },
    }),
    receiveTransfer: useMutation({
      mutationFn: ({ id, input }: { id: string; input: Record<string, unknown> }) =>
        stockApi.receiveTransfer(id, input),
      onSuccess: () => { invalidate("transfers"); invalidate("levels"); invalidate("movements"); },
    }),
    acknowledgeAlert: useMutation({
      mutationFn: stockApi.acknowledgeAlert,
      onSuccess: () => invalidate("alerts"),
    }),
    dismissAlert: useMutation({
      mutationFn: stockApi.dismissAlert,
      onSuccess: () => invalidate("alerts"),
    }),
    resolveAlert: useMutation({
      mutationFn: stockApi.resolveAlert,
      onSuccess: () => invalidate("alerts"),
    }),
    createShipment: useMutation({
      mutationFn: stockApi.createShipment,
      onSuccess: () => invalidate("shipments"),
    }),
    updateShipmentStatus: useMutation({
      mutationFn: ({ id, status }: { id: string; status: string }) =>
        stockApi.updateShipmentStatus(id, status),
      onSuccess: () => invalidate("shipments"),
    }),
    receiveShipment: useMutation({
      mutationFn: ({ id, input }: { id: string; input: Record<string, unknown> }) =>
        stockApi.receiveShipment(id, input),
      onSuccess: () => { invalidate("shipments"); invalidate("levels"); invalidate("movements"); },
    }),
  };
}
