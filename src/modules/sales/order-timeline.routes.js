/**
 * Public order timeline (F-5 / PD §6.23.6). No auth — resolve an order by its
 * public_tracking_token (across brands) and return the customer-visible
 * lifecycle events. Mounted at /api/public/order-timeline/:token.
 */

"use strict";

const express = require("express");
const timeline = require("./timeline.service");

const router = express.Router();

router.get("/:token", async (req, res, next) => {
  try {
    res.json({
      data: await timeline.getPublicTimeline({ token: req.params.token }),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
