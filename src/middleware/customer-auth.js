/**
 * Storefront CUSTOMER authentication (distinct from staff auth.middleware).
 * The customer principal is a shared.contacts row. A short-lived access JWT
 * (typ:"customer") is sent as a Bearer token by the website; the refresh token
 * lives in an httpOnly cookie and rotates via shared.customer_sessions.
 *
 *  - customerAuthOptional: sets req.customer = { contact_id } if a valid token
 *    is present; otherwise continues as a guest. Used on cart/checkout so a
 *    logged-in shopper resolves to their contact while guests still work.
 *  - requireCustomer: 401 unless req.customer is set. Used on account routes.
 */

"use strict";

const jwt = require("jsonwebtoken");
const { config } = require("../config/env");

function readBearer(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

function customerAuthOptional(req, _res, next) {
  const token = readBearer(req);
  if (token) {
    try {
      const p = jwt.verify(token, config.JWT_SECRET);
      if (p && p.typ === "customer" && p.sub) {
        req.customer = { contact_id: p.sub };
      }
    } catch {
      // Invalid/expired access token -> treat as guest (client will refresh).
    }
  }
  next();
}

function requireCustomer(req, res, next) {
  if (!req.customer || !req.customer.contact_id) {
    return res.status(401).json({
      error: { code: "AUTH_REQUIRED", userMessage: "Please sign in to continue." },
    });
  }
  next();
}

module.exports = { customerAuthOptional, requireCustomer };
