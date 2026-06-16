/**
 * Stock (V2.2 §6.9) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const locationCreate = z
  .object({
    location_code: z.string().min(1).max(40),
    display_name: z.string().min(1).max(160),
    location_type: z.enum([
      "warehouse",
      "showroom",
      "partner_consignment",
      "in_transit",
      "production",
      "reserved_holding",
      "amazon_fba",
      "salon",
      "retail_counter",
    ]),
    address: z.string().max(400).optional(),
    city: z.string().max(120).optional(),
    state: z.string().max(120).optional(),
    country: z.string().max(120).optional(),
    latitude: z.coerce.number().optional(),
    longitude: z.coerce.number().optional(),
    available_for_storefront: z.boolean().optional(),
    available_for_pos: z.boolean().optional(),
    is_active: z.boolean().optional(),
    is_default: z.boolean().optional(),
  })
  .strict();

const movementTypes = [
  "receive",
  "sale",
  "return",
  "transfer_out",
  "transfer_in",
  "adjustment_in",
  "adjustment_out",
  "reserve",
  "release_reserve",
  "production_in",
  "production_out",
  "consignment_out",
  "consignment_return",
  "damage",
  "sample",
  "theft_writeoff",
];

const movementCreate = z
  .object({
    variant_id: z.string().uuid(),
    location_id: z.string().uuid(),
    quantity: z.coerce
      .number()
      .int()
      .refine((n) => n !== 0, "quantity cannot be 0"),
    movement_type: z.enum(movementTypes),
    sales_channel: z.string().max(40).optional(),
    reference_type: z.string().max(40).optional(),
    reference_id: z.string().uuid().optional(),
    unit_cost_ngn: z.coerce.number().nonnegative().optional(),
    counterparty_type: z.string().max(40).optional(),
    counterparty_id: z.string().uuid().optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

const adjustmentCreate = z
  .object({
    location_id: z.string().uuid(),
    adjustment_type: z.enum([
      "count",
      "damage",
      "theft",
      "found",
      "quality_reject",
      "sample",
      "other",
    ]),
    reason: z.string().min(1).max(500),
    evidence_document_id: z.string().uuid().optional(),
    approval_required_above_units: z.coerce.number().int().min(0).optional(),
    lines: z
      .array(
        z
          .object({
            variant_id: z.string().uuid(),
            system_count: z.coerce.number().int(),
            physical_count: z.coerce.number().int(),
            unit_cost_ngn: z.coerce.number().nonnegative().optional(),
            notes: z.string().max(500).optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const transferCreate = z
  .object({
    from_location_id: z.string().uuid(),
    to_location_id: z.string().uuid(),
    reason: z.string().max(500).optional(),
    carrier_name: z.string().max(160).optional(),
    tracking_reference: z.string().max(160).optional(),
    lines: z
      .array(
        z
          .object({
            variant_id: z.string().uuid(),
            qty_dispatched: z.coerce.number().int().positive(),
            notes: z.string().max(500).optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .refine((v) => v.from_location_id !== v.to_location_id, {
    message: "from and to locations must differ",
    path: ["to_location_id"],
  });

const transferReceive = z
  .object({
    lines: z
      .array(
        z
          .object({
            line_id: z.string().uuid(),
            qty_received: z.coerce.number().int().min(0),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

const shipmentCreate = z
  .object({
    origin_country: z.string().max(120).optional(),
    origin_port: z.string().max(120).optional(),
    carrier_name: z.string().max(160).optional(),
    tracking_reference: z.string().max(160).optional(),
    shipping_method: z
      .enum(["air", "sea", "land", "courier", "hand_carry"])
      .optional(),
    total_factory_cost_ngn: z.coerce.number().nonnegative().optional(),
    total_freight_ngn: z.coerce.number().nonnegative().optional(),
    total_customs_ngn: z.coerce.number().nonnegative().optional(),
    total_other_ngn: z.coerce.number().nonnegative().optional(),
    lines: z
      .array(
        z
          .object({
            variant_id: z.string().uuid(),
            po_line_id: z.string().uuid().optional(),
            qty_expected: z.coerce.number().int().positive(),
            unit_cost: z.coerce.number().nonnegative().optional(),
            unit_cost_currency: z.string().max(4).optional(),
            unit_cost_ngn: z.coerce.number().nonnegative().optional(),
            fx_rate_used: z.coerce.number().optional(),
            unit_weight_g: z.coerce.number().int().optional(),
            notes: z.string().max(500).optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

const shipmentStatus = z
  .object({
    status: z.enum([
      "in_production",
      "quality_check",
      "ready_to_ship",
      "in_transit",
      "arrived_lagos",
      "cleared_customs",
      "received",
      "cancelled",
    ]),
  })
  .strict();

const shipmentReceive = z
  .object({
    location_id: z.string().uuid().optional(),
    lines: z
      .array(
        z
          .object({
            line_id: z.string().uuid(),
            qty_received: z.coerce.number().int().min(0),
            qty_rejected: z.coerce.number().int().min(0).optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

const mw = (s) => (req, _res, next) => {
  req.body = s.parse(req.body ?? {});
  next();
};

module.exports = {
  validateLocationCreate: mw(locationCreate),
  validateLocationUpdate: mw(locationCreate.partial()),
  validateMovementCreate: mw(movementCreate),
  validateAdjustmentCreate: mw(adjustmentCreate),
  validateTransferCreate: mw(transferCreate),
  validateTransferReceive: mw(transferReceive),
  validateShipmentCreate: mw(shipmentCreate),
  validateShipmentStatus: mw(shipmentStatus),
  validateShipmentReceive: mw(shipmentReceive),
  locationCreate,
  movementCreate,
};
