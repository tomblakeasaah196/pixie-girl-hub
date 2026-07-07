/**
 * Attendance + device-binding real-time relay.
 *
 * Subscribes to hr_payroll domain events and broadcasts them into the
 * canonical rooms brand:{brand}:attendance and brand:{brand}:hr_devices.
 * Per ARCHITECTURE.md, modules emit domain events; this relay (not the
 * service) talks to Socket.io. Registered once during socket init and again
 * in the worker process.
 *
 *   clock_event   → attendance:punch   (live row for the Attendance tab)
 *   device_changed→ hr_devices:changed (HR "Devices" view refresh signal)
 *
 * Payloads carry just what a client needs to render the update; anything
 * heavier is re-queried.
 */

"use strict";

const events = require("../shared/hr_payroll/hr.events");
const { ROOMS } = require("./rooms");
const { getBroadcaster } = require("./emitter");
const { logger } = require("../config/logger");

function emitToBrand(room, channel, payload) {
  try {
    getBroadcaster().to(room).emit(channel, payload);
  } catch (err) {
    // Redis unavailable (tests/scripts without initRedis).
    logger.debug({ err: err.message }, "attendance realtime emit skipped");
  }
}

let registered = false;

function registerAttendanceRealtime() {
  // Idempotent: socket init (API) and startWorkers (worker/in-process dev)
  // may both call this; the second call must not duplicate emissions.
  if (registered) return;
  registered = true;

  // Live attendance punch. `live_row` is the ready-to-render record; a client
  // showing the Attendance tab appends/updates the row for that employee.
  events.on("clock_event", ({ brand, event_id, live_row }) => {
    if (!brand || !live_row) return;
    emitToBrand(ROOMS.attendance(brand), "attendance:punch", {
      event_id,
      ...live_row,
    });
  });

  // Device enrol/remove/flag — refresh signal for the HR Devices view + feed.
  events.on("device_changed", ({ brand, profile_id, device_id, action }) => {
    if (!brand) return;
    emitToBrand(ROOMS.hr_devices(brand), "device:changed", {
      profile_id,
      device_id,
      action,
    });
  });
}

module.exports = { registerAttendanceRealtime };
