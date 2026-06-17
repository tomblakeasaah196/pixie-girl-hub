import { api } from "@/lib/api";
import type {
  StockLocation,
  StockLevel,
  StockMovement,
  StockAdjustment,
  StockTransfer,
  StockAlert,
  InboundShipment,
  Paginated,
  ValuationSummary,
  ValuationLine,
} from "./types";

function qs(params: Record<string, string | number | undefined | null>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

export const stockApi = {
  listLocations: () => api.get<StockLocation[]>("/stock/locations"),

  createLocation: (input: Partial<StockLocation>) =>
    api.post<StockLocation>("/stock/locations", input),

  updateLocation: (id: string, patch: Partial<StockLocation>) =>
    api.patch<StockLocation>(`/stock/locations/${id}`, patch),

  valuation: (filters?: { location_id?: string; variant_id?: string; product_id?: string }) =>
    api.get<{ lines: ValuationLine[]; summary: ValuationSummary }>(
      `/stock/valuation${qs(filters ?? {})}`,
    ),

  listLevels: (params: { variant_id?: string; location_id?: string; page?: number; page_size?: number }) =>
    api.get<StockLevel[]>(`/stock/levels${qs(params)}`),

  variantStock: (variantId: string) =>
    api.get<StockLevel[]>(`/stock/levels/variant/${variantId}`),

  listMovements: (params: {
    variant_id?: string;
    movement_type?: string;
    reference_id?: string;
    page?: number;
    page_size?: number;
  }) => api.get<Paginated<StockMovement>>(`/stock/movements${qs(params)}`),

  recordMovement: (input: Record<string, unknown>) =>
    api.post<StockMovement>("/stock/movements", input),

  listAdjustments: (params: { status?: string; location_id?: string; page?: number; page_size?: number }) =>
    api.get<Paginated<StockAdjustment>>(`/stock/adjustments${qs(params)}`),

  getAdjustment: (id: string) =>
    api.get<StockAdjustment>(`/stock/adjustments/${id}`),

  createAdjustment: (input: Record<string, unknown>) =>
    api.post<StockAdjustment>("/stock/adjustments", input),

  submitAdjustment: (id: string) =>
    api.post<StockAdjustment>(`/stock/adjustments/${id}/submit`),

  approveAdjustment: (id: string) =>
    api.post<StockAdjustment>(`/stock/adjustments/${id}/approve`),

  rejectAdjustment: (id: string) =>
    api.post<StockAdjustment>(`/stock/adjustments/${id}/reject`),

  postAdjustment: (id: string) =>
    api.post<StockAdjustment>(`/stock/adjustments/${id}/post`),

  listTransfers: (params: { status?: string; page?: number; page_size?: number }) =>
    api.get<Paginated<StockTransfer>>(`/stock/transfers${qs(params)}`),

  getTransfer: (id: string) =>
    api.get<StockTransfer>(`/stock/transfers/${id}`),

  createTransfer: (input: Record<string, unknown>) =>
    api.post<StockTransfer>("/stock/transfers", input),

  dispatchTransfer: (id: string) =>
    api.post<StockTransfer>(`/stock/transfers/${id}/dispatch`),

  receiveTransfer: (id: string, input: Record<string, unknown>) =>
    api.post<StockTransfer>(`/stock/transfers/${id}/receive`, input),

  listAlerts: (params: { status?: string; variant_id?: string; page?: number; page_size?: number }) =>
    api.get<Paginated<StockAlert>>(`/stock/alerts${qs(params)}`),

  acknowledgeAlert: (id: string) =>
    api.post<StockAlert>(`/stock/alerts/${id}/acknowledge`),

  dismissAlert: (id: string) =>
    api.post<StockAlert>(`/stock/alerts/${id}/dismiss`),

  resolveAlert: (id: string) =>
    api.post<StockAlert>(`/stock/alerts/${id}/resolve`),

  listShipments: (params: { status?: string; page?: number; page_size?: number }) =>
    api.get<Paginated<InboundShipment>>(`/stock/shipments${qs(params)}`),

  getShipment: (id: string) =>
    api.get<InboundShipment>(`/stock/shipments/${id}`),

  createShipment: (input: Record<string, unknown>) =>
    api.post<InboundShipment>("/stock/shipments", input),

  updateShipmentStatus: (id: string, status: string) =>
    api.patch<InboundShipment>(`/stock/shipments/${id}/status`, { status }),

  receiveShipment: (id: string, input: Record<string, unknown>) =>
    api.post<InboundShipment>(`/stock/shipments/${id}/receive`, input),
};
