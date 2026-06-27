"use strict";
// date-fns-tz v3 API: utcToZonedTime → toZonedTime, zonedTimeToUtc →
// fromZonedTime, and formatInTimeZone replaces format(zonedDate,{timeZone}).
const { fromZonedTime, toZonedTime, formatInTimeZone } = require("date-fns-tz");
const { config } = require("../config/env");

// Read TZ lazily (config is a Proxy that validates env on first property
// access). Resolving it inside each call — not at module load — keeps merely
// requiring this util side-effect-free, so it's safe to import from anywhere
// (including modules loaded in unit tests that don't set the full env).
const tz = () => config.TZ;

function nowInTz() {
  return toZonedTime(new Date(), tz());
}

function toUtc(date) {
  return fromZonedTime(date, tz());
}

function formatTz(date, fmt = "yyyy-MM-dd HH:mm:ss zzz") {
  return formatInTimeZone(date, tz(), fmt);
}

module.exports = {
  nowInTz,
  toUtc,
  formatTz,
  get TZ() {
    return config.TZ;
  },
};
