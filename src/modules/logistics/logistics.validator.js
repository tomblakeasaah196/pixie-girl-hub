/**
 * Logistics & Delivery (V2.2 §6.10) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const money = z.coerce.number();
const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);

// ── couriers ─────────────────────────────────────────────
const courierCreate = z
  .object({
    courier_key: z.string().min(1).max(40),
    display_name: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
    integration_type: z
      .enum(["manual", "api", "webhook_only", "partner_portal"])
      .optional(),
    api_endpoint: z.string().max(300).optional(),
    webhook_secret: z.string().max(300).optional(),
    serves_local: z.boolean().optional(),
    serves_nationwide: z.boolean().optional(),
    serves_international: z.boolean().optional(),
    service_countries: z.array(z.string().max(3)).optional(),
    rate_card: z.record(z.any()).optional(),
    supports_pod: z.boolean().optional(),
    pod_fee_pct: z.coerce.number().min(0).max(100).optional(),
    default_packaging: z.string().max(60).optional(),
    display_order: z.coerce.number().int().optional(),
  })
  .strict();
const courierUpdate = courierCreate
  .omit({ courier_key: true })
  .partial()
  .extend({ is_active: z.boolean().optional() })
  .strict();

// ── deliveries ───────────────────────────────────────────
const deliveryItem = z
  .object({
    source_type: z.string().max(40).optional(),
    source_id: z.string().uuid().optional(),
    variant_id: z.string().uuid().optional(),
    description: z.string().min(1).max(500),
    quantity: z.coerce.number().int().positive(),
    weight_g: z.coerce.number().int().nonnegative().optional(),
    stock_movement_id: z.string().uuid().optional(),
    notes: z.string().max(300).optional(),
  })
  .strict();
const deliveryCreate = z
  .object({
    order_id: z.string().uuid().optional(),
    delivery_type: z
      .enum([
        "sales_order",
        "intercompany_transfer",
        "stock_transfer",
        "supplier_return",
        "partner_consignment",
        "sample",
        "other",
      ])
      .optional(),
    reference_type: z.string().max(60).optional(),
    reference_id: z.string().uuid().optional(),
    courier_id: z.string().uuid(),
    courier_tracking_ref: z.string().max(120).optional(),
    courier_tracking_url: z.string().max(300).optional(),
    from_location_id: z.string().uuid().optional(),
    recipient_contact_id: z.string().uuid().optional(),
    recipient_name_snapshot: z.string().max(160).optional(),
    recipient_phone_snapshot: z.string().max(40).optional(),
    recipient_whatsapp_snapshot: z.string().max(40).optional(),
    delivery_address_snapshot: z.record(z.any()),
    delivery_instructions: z.string().max(1000).optional(),
    courier_fee_ngn: money.nonnegative().optional(),
    is_pay_on_delivery: z.boolean().optional(),
    pod_amount_expected_ngn: money.nonnegative().optional(),
    weight_g: z.coerce.number().int().nonnegative().optional(),
    package_count: z.coerce.number().int().positive().optional(),
    declared_value_ngn: money.nonnegative().optional(),
    items: z.array(deliveryItem).optional(),
  })
  .strict();
const deliveryBook = z
  .object({
    courier_tracking_ref: z.string().max(120).optional(),
    courier_tracking_url: z.string().max(300).optional(),
    expected_delivery_at: z.string().datetime().optional(),
  })
  .strict();
const deliveryAdvance = z
  .object({
    to_status: z.enum([
      "picked_up",
      "in_transit",
      "arrived_destination_city",
      "out_for_delivery",
      "delivered",
      "returned_to_sender",
      "lost",
      "damaged",
    ]),
    notes: z.string().max(500).optional(),
    source: z
      .enum(["user", "system", "webhook", "customer", "courier_portal"])
      .optional(),
  })
  .strict();
const deliveryCancel = z
  .object({ reason: z.string().max(500).optional() })
  .strict();

const attempt = z
  .object({
    attempted_at: z.string().datetime().optional(),
    outcome: z.enum([
      "delivered",
      "recipient_unavailable",
      "address_wrong",
      "recipient_refused",
      "locked_premises",
      "rescheduled",
      "lost_in_transit",
      "damaged",
      "other_failure",
    ]),
    outcome_notes: z.string().max(500).optional(),
    rider_name: z.string().max(120).optional(),
    rider_phone: z.string().max(40).optional(),
    reported_lat: lat.optional(),
    reported_lng: lng.optional(),
    webhook_event_id: z.string().uuid().optional(),
  })
  .strict();
const proof = z
  .object({
    proof_type: z.enum([
      "photo_at_door",
      "signature",
      "recipient_id_photo",
      "sms_otp_confirmed",
      "call_confirmed",
    ]),
    document_id: z.string().uuid().optional(),
    delivery_attempt_id: z.string().uuid().optional(),
    recipient_name: z.string().max(160).optional(),
    recipient_id_type: z.string().max(40).optional(),
    recipient_id_last4: z.string().max(8).optional(),
    otp_code_used: z.string().max(8).optional(),
    notes: z.string().max(500).optional(),
  })
  .strict();

const webhookIngest = z
  .object({
    courier_id: z.string().uuid(),
    delivery_id: z.string().uuid().optional(),
    external_event_type: z.string().min(1).max(120),
    external_event_id: z.string().max(120).optional(),
    mapped_to_status: z.string().max(40).optional(),
    payload: z.record(z.any()),
    signature_valid: z.boolean(),
    shared_webhook_id: z.string().uuid().optional(),
  })
  .strict();

// ── POD collections ──────────────────────────────────────
const podCreate = z
  .object({
    delivery_id: z.string().uuid(),
    expected_amount_ngn: money.nonnegative().optional(),
    courier_fee_ngn: money.nonnegative().optional(),
    notes: z.string().max(500).optional(),
  })
  .strict();
const podCollected = z
  .object({ collected_amount_ngn: z.coerce.number().nonnegative() })
  .strict();
const podRemit = z
  .object({
    collected_amount_ngn: money.nonnegative().optional(),
    remitted_reference: z.string().max(120).optional(),
  })
  .strict();
const podReconcile = z
  .object({
    status: z
      .enum(["reconciled", "disputed", "short_paid", "written_off"])
      .optional(),
    notes: z.string().max(500).optional(),
  })
  .strict();

const mw = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body ?? {});
  next();
};

module.exports = {
  validateCourierCreate: mw(courierCreate),
  validateCourierUpdate: mw(courierUpdate),
  validateDeliveryCreate: mw(deliveryCreate),
  validateDeliveryBook: mw(deliveryBook),
  validateDeliveryAdvance: mw(deliveryAdvance),
  validateDeliveryCancel: mw(deliveryCancel),
  validateAttempt: mw(attempt),
  validateProof: mw(proof),
  validateWebhookIngest: mw(webhookIngest),
  validatePodCreate: mw(podCreate),
  validatePodCollected: mw(podCollected),
  validatePodRemit: mw(podRemit),
  validatePodReconcile: mw(podReconcile),
};
