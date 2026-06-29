/**
 * Coupon engine (F-3 / PD §6.23.2) — HTTP controller. Authenticated; uses
 * req.brand. Validation/redemption at checkout is also exposed so the
 * storefront/POS "apply code" UX can quote a discount before order placement.
 */

"use strict";

const service = require("./coupon.service");

async function create(req, res) {
  res.status(201).json({
    data: await service.createCoupon({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      input: req.body,
    }),
  });
}

async function list(req, res) {
  res.json({
    data: await service.listCoupons({
      brand: req.brand,
      only_active: req.query.active === "true",
    }),
  });
}

async function getOne(req, res) {
  res.json({
    data: await service.getCoupon({ brand: req.brand, id: req.params.id }),
  });
}

async function update(req, res) {
  res.json({
    data: await service.updateCoupon({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      id: req.params.id,
      patch: req.body,
    }),
  });
}

async function setActive(req, res) {
  res.json({
    data: await service.setCouponActive({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      id: req.params.id,
      is_active: req.body.is_active,
    }),
  });
}

async function check(req, res) {
  res.json({
    data: await service.validateCoupon({
      brand: req.brand,
      code: req.body.code,
      contact_id: req.body.contact_id,
      order_subtotal_ngn: req.body.order_subtotal_ngn,
    }),
  });
}

async function remove(req, res) {
  res.json({
    data: await service.deleteCoupon({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      id: req.params.id,
    }),
  });
}

module.exports = { create, list, getOne, update, setActive, check, remove };
