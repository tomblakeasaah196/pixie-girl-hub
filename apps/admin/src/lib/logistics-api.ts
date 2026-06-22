/**
 * Logistics — typed client + TanStack hooks.
 *
 * Mirrors `src/modules/logistics` (mounted /api/v1/logistics, permission key
 * `logistics`). Couriers, deliveries (a state machine: queued → booked →
 * picked_up → in_transit → … → delivered / returned / cancelled), delivery
 * attempts, proofs, and pay-on-delivery collections.
 *
 * Ports the hub-system logistics UX, wired to THIS backend's contract (which
 * differs from the reference's dispatch/mark-delivered model).
 */

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useBusinessStore } from "@/stores/business";
import type { Tone } from "@/components/ui/primitives";

export function useBrand() {
  return useBusinessStore((s) => s.activeKey);
}

// ════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════

export type DeliveryStatus =
  | "queued"
  | "booked"
  | "picked_up"
  | "in_transit"
  | "arrived_destination_city"
  | "out_for_delivery"
  | "attempted_failed"
  | "delivered"
  | "returned_to_sender"
  | "lost"
  | "damaged"
  | "cancelled";

export interface Courier {
  courier_id: string;
  courier_key: string;
  display_name: string;
  description?: string | null;
  integration_type?: string;
  is_active: boolean;
  supports_pod?: boolean;
  service_countries?: string[];
  display_order?: number;
}

export interface DeliveryAddress {
  line1?: string;
  area?: string;
  city?: string;
  state?: string;
  country?: string;
  landmark?: string;
  recipient_name?: string;
  phone?: string;
  lat?: number;
  lng?: number;
  [k: string]: unknown;
}

export interface DeliveryItem {
  item_id?: string;
  variant_id?: string | null;
  description: string;
  quantity: number;
}

export interface StateHistoryEntry {
  history_id?: string;
  from_status: DeliveryStatus | null;
  to_status: DeliveryStatus;
  notes?: string | null;
  source?: string | null;
  occurred_at?: string;
  created_at?: string;
}

export interface DeliveryAttempt {
  attempt_id?: string;
  outcome: string;
  outcome_notes?: string | null;
  rider_name?: string | null;
  attempted_at?: string;
}

export interface DeliveryProof {
  proof_id?: string;
  proof_type: string;
  document_id?: string | null;
  created_at?: string;
}

export interface Delivery {
  delivery_id: string;
  delivery_number: string;
  status: DeliveryStatus;
  delivery_type?: string | null;
  reference_type?: string | null;
  reference_id?: string | null;
  courier_id: string;
  courier_name?: string | null;
  courier_tracking_ref?: string | null;
  courier_tracking_url?: string | null;
  recipient_contact_id?: string | null;
  recipient_name_snapshot?: string | null;
  recipient_phone_snapshot?: string | null;
  recipient_whatsapp_snapshot?: string | null;
  delivery_address_snapshot: DeliveryAddress;
  delivery_instructions?: string | null;
  courier_fee_ngn?: number | null;
  is_pay_on_delivery?: boolean;
  pod_amount_expected_ngn?: number | null;
  weight_g?: number | null;
  package_count?: number | null;
  declared_value_ngn?: number | null;
  expected_delivery_at?: string | null;
  booked_at?: string | null;
  picked_up_at?: string | null;
  delivered_at?: string | null;
  returned_at?: string | null;
  cancelled_at?: string | null;
  created_at: string;
  updated_at: string;
  items?: DeliveryItem[];
  attempts?: DeliveryAttempt[];
  proofs?: DeliveryProof[];
  state_history?: StateHistoryEntry[];
}

interface Paginated<T> {
  data: T[];
  meta?: Record<string, unknown>;
}

function unwrapList<T>(r: T[] | Paginated<T>): T[] {
  return Array.isArray(r) ? r : (r?.data ?? []);
}

// ════════════════════════════════════════════════════════════
// Couriers
// ════════════════════════════════════════════════════════════

export function useCouriers() {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["logistics", "couriers", brand],
    queryFn: () => api.get<Courier[]>("/logistics/couriers"),
    staleTime: 5 * 60_000,
  });
}

// ════════════════════════════════════════════════════════════
// Deliveries
// ════════════════════════════════════════════════════════════

export function useDeliveries(
  filters: { status?: string; q?: string; page?: number; page_size?: number } = {},
) {
  const brand = useBrand();
  const qs = new URLSearchParams();
  if (filters.status) qs.set("status", filters.status);
  if (filters.q) qs.set("q", filters.q);
  qs.set("page_size", String(filters.page_size ?? 200));
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["logistics", "deliveries", brand, qs.toString()],
    queryFn: async () => {
      const r = await api.get<Delivery[] | Paginated<Delivery>>(
        `/logistics/deliveries?${qs}`,
      );
      return unwrapList(r);
    },
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useDelivery(id: string | undefined) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && id),
    queryKey: ["logistics", "delivery", brand, id],
    queryFn: () => api.get<Delivery>(`/logistics/deliveries/${id}`),
  });
}

export interface CreateDeliveryInput {
  courier_id: string;
  delivery_type?: string;
  reference_type?: string;
  reference_id?: string;
  recipient_contact_id?: string;
  recipient_name_snapshot?: string;
  recipient_phone_snapshot?: string;
  recipient_whatsapp_snapshot?: string;
  delivery_address_snapshot: DeliveryAddress;
  delivery_instructions?: string;
  courier_fee_ngn?: number;
  is_pay_on_delivery?: boolean;
  pod_amount_expected_ngn?: number;
  weight_g?: number;
  package_count?: number;
  declared_value_ngn?: number;
  items?: DeliveryItem[];
}

export function useCreateDelivery() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (body: CreateDeliveryInput) =>
      api.post<Delivery>("/logistics/deliveries", body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["logistics", "deliveries", brand] }),
  });
}

function invalidateDelivery(qc: ReturnType<typeof useQueryClient>, brand: string) {
  qc.invalidateQueries({ queryKey: ["logistics", "deliveries", brand] });
  qc.invalidateQueries({ queryKey: ["logistics", "delivery", brand] });
}

export function useBookDelivery() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: {
      id: string;
      courier_tracking_ref?: string;
      courier_tracking_url?: string;
      expected_delivery_at?: string;
    }) => {
      const { id, ...body } = args;
      return api.post<Delivery>(`/logistics/deliveries/${id}/book`, body);
    },
    onSuccess: () => invalidateDelivery(qc, brand),
  });
}

export function useAdvanceDelivery() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: { id: string; to_status: DeliveryStatus; notes?: string }) =>
      api.post<Delivery>(`/logistics/deliveries/${args.id}/advance`, {
        to_status: args.to_status,
        notes: args.notes,
        source: "user",
      }),
    onSuccess: () => invalidateDelivery(qc, brand),
  });
}

export function useCancelDelivery() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: { id: string; reason?: string }) =>
      api.post<Delivery>(`/logistics/deliveries/${args.id}/cancel`, {
        reason: args.reason,
      }),
    onSuccess: () => invalidateDelivery(qc, brand),
  });
}

export function useRecordAttempt() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: {
      id: string;
      outcome: string;
      outcome_notes?: string;
      rider_name?: string;
      rider_phone?: string;
    }) => {
      const { id, ...body } = args;
      return api.post<Delivery>(`/logistics/deliveries/${id}/attempts`, body);
    },
    onSuccess: () => invalidateDelivery(qc, brand),
  });
}

export function useRecordProof() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: { id: string; proof_type: string; document_id?: string }) => {
      const { id, ...body } = args;
      return api.post<Delivery>(`/logistics/deliveries/${id}/proofs`, body);
    },
    onSuccess: () => invalidateDelivery(qc, brand),
  });
}

// ════════════════════════════════════════════════════════════
// Presentation
// ════════════════════════════════════════════════════════════

export const STATUS_META: Record<DeliveryStatus, { label: string; tone: Tone }> = {
  queued: { label: "Queued", tone: "neutral" },
  booked: { label: "Booked", tone: "info" },
  picked_up: { label: "Picked up", tone: "info" },
  in_transit: { label: "In transit", tone: "accent" },
  arrived_destination_city: { label: "Arrived city", tone: "accent" },
  out_for_delivery: { label: "Out for delivery", tone: "warn" },
  attempted_failed: { label: "Attempt failed", tone: "warn" },
  delivered: { label: "Delivered", tone: "success" },
  returned_to_sender: { label: "Returned", tone: "danger" },
  lost: { label: "Lost", tone: "danger" },
  damaged: { label: "Damaged", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

/** Allowed transitions (mirrors the backend FLOW). */
export const FLOW: Partial<Record<DeliveryStatus, DeliveryStatus[]>> = {
  queued: ["booked", "cancelled"],
  booked: ["picked_up", "cancelled"],
  picked_up: ["in_transit", "cancelled"],
  in_transit: [
    "arrived_destination_city",
    "out_for_delivery",
    "attempted_failed",
    "lost",
    "damaged",
  ],
  arrived_destination_city: ["out_for_delivery", "attempted_failed"],
  out_for_delivery: ["delivered", "attempted_failed", "returned_to_sender"],
  attempted_failed: ["out_for_delivery", "returned_to_sender", "cancelled"],
};

/** `advance` accepts these target states (the rest go via book/attempt/cancel). */
export const ADVANCE_STATES = new Set<DeliveryStatus>([
  "picked_up",
  "in_transit",
  "arrived_destination_city",
  "out_for_delivery",
  "delivered",
  "returned_to_sender",
  "lost",
  "damaged",
]);

export const TAB_STATUSES: Record<string, DeliveryStatus[]> = {
  queue: ["queued", "booked"],
  active: ["picked_up", "in_transit", "arrived_destination_city", "out_for_delivery"],
  delivered: ["delivered"],
  issues: ["attempted_failed", "returned_to_sender", "lost", "damaged", "cancelled"],
};

export function addressLine(a?: DeliveryAddress): string {
  if (!a) return "—";
  return [a.line1, a.area, a.city, a.state, a.country]
    .filter(Boolean)
    .join(", ");
}

// ════════════════════════════════════════════════════════════
// Delivery zones (geofenced fees)
// ════════════════════════════════════════════════════════════

export interface ZoneGeometry {
  points?: [number, number][]; // polygon: [lng,lat] pairs
  center?: [number, number]; // radius: [lng,lat]
  radius_km?: number;
}

export type ZoneGeometryType = "polygon" | "radius" | "country";

export interface DeliveryZone {
  zone_id: string;
  name: string;
  description?: string | null;
  geometry_type: ZoneGeometryType;
  geometry: ZoneGeometry;
  fee_ngn: number;
  country_code?: string | null;
  priority: number;
  is_active: boolean;
}

export interface ZoneInput {
  name: string;
  description?: string;
  geometry_type: ZoneGeometryType;
  geometry?: ZoneGeometry;
  fee_ngn: number;
  country_code?: string;
  priority?: number;
  is_active?: boolean;
}

export function useZones() {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand),
    queryKey: ["logistics", "zones", brand],
    queryFn: () => api.get<DeliveryZone[]>("/logistics/zones"),
    staleTime: 60_000,
  });
}

export function useCreateZone() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (body: ZoneInput) =>
      api.post<DeliveryZone>("/logistics/zones", body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["logistics", "zones", brand] }),
  });
}

export function useUpdateZone() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: { id: string; patch: Partial<ZoneInput> }) =>
      api.patch<DeliveryZone>(`/logistics/zones/${args.id}`, args.patch),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["logistics", "zones", brand] }),
  });
}

export function useDeleteZone() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/logistics/zones/${id}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["logistics", "zones", brand] }),
  });
}

export interface ZoneQuote {
  zone_id: string | null;
  zone_name: string | null;
  fee_ngn: number | null;
  currency: string;
}

export function useZoneQuote() {
  return useMutation({
    mutationFn: (args: { lat: number; lng: number; country?: string }) => {
      const qs = new URLSearchParams({
        lat: String(args.lat),
        lng: String(args.lng),
      });
      if (args.country) qs.set("country", args.country);
      return api.get<ZoneQuote>(`/logistics/zones/quote?${qs}`);
    },
  });
}
