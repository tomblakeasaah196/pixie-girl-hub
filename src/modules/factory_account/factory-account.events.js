"use strict";

const EventEmitter = require("events");
const emitter = new EventEmitter();

// Events emitted by the factory account module
// ACCOUNT_BALANCE_ALERT  — balance exceeds alert threshold
// SHIPMENT_DISPATCHED    — factory manager logged a new shipment
// SHIPMENT_STATUS_CHANGED — status transition on a shipment
// DRAFT_PO_CREATED       — system auto-created a draft PO from a shipment

module.exports = emitter;
