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

export interface CourierRateCard {
  flat?: number;
  per_kg?: number;
  city_multipliers?: Record<string, number>;
  [k: string]: unknown;
}

export interface Courier {
  courier_id: string;
  courier_key: string;
  display_name: string;
  description?: string | null;
  integration_type?: string;
  is_active: boolean;
  supports_pod?: boolean;
  service_countries?: string[];
  serves_local?: boolean;
  serves_nationwide?: boolean;
  serves_international?: boolean;
  rate_card?: CourierRateCard | null;
  default_packaging?: string | null;
  display_order?: number;
  // Manual-agency profile
  contact_person?: string | null;
  contact_phone?: string | null;
  payment_terms_notes?: string | null;
  preferred_pickup_location?: string | null;
  internal_rating?: number | null;
  internal_notes?: string | null;
  /**
   * How this courier gets paid — decides where delivery costs settle.
   * 'invoice'  = agency bills periodically (DHL, GIGL) → batched expense.
   * 'per_drop' = paid at pickup (Uber and similar) → cash request.
   */
  settlement_mode?: "invoice" | "per_drop";
}

export interface CourierInput {
  courier_key?: string; // required on create, omitted on update
  display_name: string;
  description?: string;
  serves_local?: boolean;
  serves_nationwide?: boolean;
  serves_international?: boolean;
  rate_card?: CourierRateCard;
  default_packaging?: string;
  display_order?: number;
  contact_person?: string;
  contact_phone?: string;
  payment_terms_notes?: string;
  preferred_pickup_location?: string;
  internal_rating?: number;
  internal_notes?: string;
  settlement_mode?: "invoice" | "per_drop";
  is_active?: boolean;
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
  /** Server field. `occurred_at` is not returned — do not read it. */
  changed_at?: string;
  changed_by_source?: string | null;
  /** Resolved staff name behind `changed_by` — who actually did this. */
  actor_name?: string | null;
  actor_job_title?: string | null;
  created_at?: string;
}

/** Whether a delivery can actually be dispatched right now. */
export type DeliveryReadiness =
  | "ready"
  | "awaiting_studio"
  | "awaiting_fulfilment"
  | "order_blocked";

export interface DeliveryCost {
  cost_id: string;
  delivery_id: string;
  cost_type: string;
  amount_ngn: number | string;
  courier_id?: string | null;
  courier_name?: string | null;
  incurred_at: string;
  settlement_mode: "invoice" | "per_drop";
  expense_id?: string | null;
  cash_request_id?: string | null;
  settled_at?: string | null;
  notes?: string | null;
  recorded_by_name?: string | null;
  created_at: string;
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
  order_id?: string | null;
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
  scheduled_pickup_at?: string | null;
  booked_at?: string | null;
  picked_up_at?: string | null;
  delivered_at?: string | null;
  returned_at?: string | null;
  cancelled_at?: string | null;
  driver_name?: string | null;
  driver_phone?: string | null;
  created_at: string;
  updated_at: string;
  // ── Completion attribution
  completed_by?: string | null;
  completed_at?: string | null;
  completed_by_name?: string | null;
  completed_by_job_title?: string | null;
  // ── Money. `courier_fee_ngn` is the actual cost (maintained total of the
  // cost rows); `order_shipping_fee_ngn` below is what the customer paid.
  delivery_loss_ngn?: number | string | null;
  has_delivery_loss?: boolean;
  delivery_margin_ngn?: number | string | null;
  fee_waiver_reason?: string | null;
  cost_recorded_at?: string | null;
  /** Computed server-side from order + studio status. */
  readiness?: DeliveryReadiness;
  // Joined from the originating sales order (list endpoint only).
  order_number?: string | null;
  order_type?: string | null; // 'dispatch' = delivery, 'collection'/'walk_in' = pickup
  order_shipping_fee_ngn?: number | string | null; // customer-billed delivery fee
  order_status?: string | null;
  customer_name?: string | null;
  // Styling status for the order (joined list + detail). Lets dispatch see
  // whether the wig is still in the studio and deep-link to the exact job.
  service_job_id?: string | null;
  service_job_number?: string | null;
  service_job_status?: string | null;
  items?: DeliveryItem[];
  attempts?: DeliveryAttempt[];
  proofs?: DeliveryProof[];
  costs?: DeliveryCost[];
  /** Detail endpoint only. Named `history` server-side. */
  history?: StateHistoryEntry[];
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

export function useCreateCourier() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (body: CourierInput) =>
      api.post<Courier>("/logistics/couriers", body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["logistics", "couriers", brand] }),
  });
}

export function useUpdateCourier() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: { id: string; patch: Partial<CourierInput> }) =>
      api.patch<Courier>(`/logistics/couriers/${args.id}`, args.patch),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["logistics", "couriers", brand] }),
  });
}

// ════════════════════════════════════════════════════════════
// Deliveries
// ════════════════════════════════════════════════════════════

export function useDeliveries(
  filters: {
    status?: string;
    q?: string;
    page?: number;
    page_size?: number;
    readiness?: DeliveryReadiness;
    has_delivery_loss?: boolean;
    cost_missing?: boolean;
    delivered_from?: string;
    delivered_to?: string;
  } = {},
) {
  const brand = useBrand();
  const qs = new URLSearchParams();
  if (filters.status) qs.set("status", filters.status);
  if (filters.q) qs.set("q", filters.q);
  if (filters.readiness) qs.set("readiness", filters.readiness);
  if (filters.has_delivery_loss !== undefined)
    qs.set("has_delivery_loss", String(filters.has_delivery_loss));
  if (filters.cost_missing) qs.set("cost_missing", "true");
  if (filters.delivered_from) qs.set("delivered_from", filters.delivered_from);
  if (filters.delivered_to) qs.set("delivered_to", filters.delivered_to);
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

export interface BookDeliveryInput {
  id: string;
  courier_id?: string;
  courier_fee_ngn?: number;
  courier_tracking_ref?: string;
  courier_tracking_url?: string;
  expected_delivery_at?: string;
  scheduled_pickup_at?: string;
  driver_name?: string;
  driver_phone?: string;
  /** Required when the delivery is not ready — the API refuses without it. */
  acknowledge_not_ready?: boolean;
  not_ready_reason?: string;
  /**
   * The customer is told her delivery is booked (shipper, waybill, ETA) by
   * default. Send `false` to book silently.
   */
  notify_customer?: boolean;
}

/** What the API reports back about the notice it just tried to send. */
export interface CustomerNotification {
  sent: boolean;
  channel?: CommsChannel;
  recipient?: string;
  reason?: string;
  duplicate?: boolean;
}

/** Booking echoes the delivery plus the outcome of the customer notice. */
export type BookedDelivery = Delivery & {
  customer_notification?: CustomerNotification;
};

export function useBookDelivery() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: BookDeliveryInput) => {
      const { id, ...body } = args;
      return api.post<BookedDelivery>(`/logistics/deliveries/${id}/book`, body);
    },
    onSuccess: () => invalidateDelivery(qc, brand),
  });
}

// ── Customer comms on a delivery ────────────────────────────
// "Was it sent, did it land, did she open it?" — the same ledger the invoice
// and receipt screens read, scoped to one delivery.

export type CommsChannel = "email" | "whatsapp" | "instagram" | "sms";
export type CommsStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "opened"
  | "failed"
  | "bounced"
  /** Customer pressed "this is junk" — the mail arrived, so it is not a bounce. */
  | "complained";

export interface DeliveryCommsEntry {
  log_id: string;
  business: string | null;
  channel: CommsChannel;
  event_key: string | null;
  recipient: string | null;
  subject: string | null;
  status: CommsStatus;
  provider_ref: string | null;
  error: string | null;
  created_at: string;
  /** Which ESP reported this row. Null on rows we wrote ourselves at send time. */
  provider?: string | null;
  /** When the provider says it happened — preferred over `created_at` for display. */
  event_at?: string | null;
}

export interface DeliveryComms {
  delivery_id: string;
  delivery_number: string;
  status: DeliveryStatus;
  sent_at: string | null;
  sent_via: CommsChannel | null;
  delivered_at: string | null;
  first_viewed_at: string | null;
  booked_notice_sent_at: string | null;
  booked_notice_via: CommsChannel | null;
  history: DeliveryCommsEntry[];
}

export function useDeliveryComms(id: string | undefined) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && id),
    queryKey: ["logistics", "delivery-comms", brand, id],
    queryFn: () => api.get<DeliveryComms>(`/logistics/deliveries/${id}/comms`),
  });
}

/** Staff-triggered (re)send of the booking notice — bypasses the dedup slot. */
export function useNotifyBooked() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<CustomerNotification>(
        `/logistics/deliveries/${id}/notify-booked`,
      ),
    onSuccess: () => {
      invalidateDelivery(qc, brand);
      qc.invalidateQueries({ queryKey: ["logistics", "delivery-comms", brand] });
    },
  });
}

// ── Delivery costs + loss ───────────────────────────────────
export interface AddDeliveryCostInput {
  id: string;
  amount_ngn: number;
  cost_type?: string;
  courier_id?: string;
  incurred_at?: string;
  settlement_mode?: "invoice" | "per_drop";
  notes?: string;
}

/** Server echoes the recomputed comparison so the UI can flag an overspend inline. */
export interface DeliveryCostResult {
  cost: DeliveryCost;
  delivery: Delivery;
  loss: {
    revenue_ngn: string;
    cost_ngn: string;
    loss_ngn: string;
    has_loss: boolean;
  };
}

export function useAddDeliveryCost() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: AddDeliveryCostInput) => {
      const { id, ...body } = args;
      return api.post<DeliveryCostResult>(
        `/logistics/deliveries/${id}/costs`,
        body,
      );
    },
    onSuccess: () => invalidateDelivery(qc, brand),
  });
}

export function useRemoveDeliveryCost() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: { id: string; cost_id: string }) =>
      api.delete<Delivery>(
        `/logistics/deliveries/${args.id}/costs/${args.cost_id}`,
      ),
    onSuccess: () => invalidateDelivery(qc, brand),
  });
}

export function useSetFeeWaiver() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (args: { id: string; reason: string | null }) =>
      api.post<Delivery>(`/logistics/deliveries/${args.id}/fee-waiver`, {
        reason: args.reason,
      }),
    onSuccess: () => invalidateDelivery(qc, brand),
  });
}

export interface ReconciliationRow {
  courier_id?: string | null;
  courier_name?: string | null;
  destination?: string;
  settlement_mode?: string | null;
  deliveries: number;
  revenue_ngn: number | string;
  cost_ngn: number | string;
  margin_ngn: number | string;
  loss_ngn: number | string;
  loss_count?: number;
}

export interface ReconciliationReport {
  totals: ReconciliationRow & {
    waived_count: number;
    cost_missing_count: number;
  };
  by_courier: ReconciliationRow[];
  by_destination: ReconciliationRow[];
}

export function useDeliveryReconciliation(from: string, to: string) {
  const brand = useBrand();
  return useQuery({
    enabled: Boolean(brand && from && to),
    queryKey: ["logistics", "reconciliation", brand, from, to],
    queryFn: () =>
      api.get<ReconciliationReport>(
        `/logistics/reconciliation?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
  });
}

export function useNotifyDelivered() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ sent: boolean; reason?: string }>(
        `/logistics/deliveries/${id}/notify-delivered`,
      ),
    onSuccess: () => {
      invalidateDelivery(qc, brand);
      qc.invalidateQueries({ queryKey: ["logistics", "delivery-comms", brand] });
    },
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

export interface RateTier {
  label: string;
  min_qty: number;
  max_qty: number | null;
  fee_ngn: number;
}

export interface RateCard {
  tiers: RateTier[];
  add_on_per_2_ngn?: number;
}

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
  rate_card?: RateCard | null;
  courier_key?: string | null;
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
  rate_card?: RateCard;
  courier_key?: string;
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
  country_code: string | null;
  courier_key: string | null;
  fee_ngn: number | null;
  // 'priced' = a real positive fee; 'free' = an explicitly free-delivery
  // zone (charge ₦0 on purpose); 'pending' = resolved to ₦0 but not marked
  // free (a rate-card gap — confirm before dispatch); 'unserviceable' = no
  // zone covers this location at all (fee_ngn is null).
  fee_status?: "priced" | "free" | "pending" | "unserviceable";
  is_free_delivery?: boolean;
  rate_card: RateCard | null;
  currency: string;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
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

export function useRateCardQuote() {
  return useMutation({
    mutationFn: (args: { country_code: string; qty: number }) => {
      const qs = new URLSearchParams({
        country: args.country_code,
        qty: String(args.qty),
      });
      return api.get<ZoneQuote>(`/logistics/zones/quote?${qs}`);
    },
  });
}

export function useImportRates() {
  const qc = useQueryClient();
  const brand = useBrand();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.postForm<ImportResult>("/logistics/zones/rates-import", form);
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["logistics", "zones", brand] }),
  });
}

export async function downloadRatesTemplate(): Promise<void> {
  return api.download(
    "/logistics/zones/rates-template",
    "delivery-zones-template.xlsx",
  );
}
