"use strict";
const { utcToZonedTime, zonedTimeToUtc, format } = require("date-fns-tz");
const { config } = require("../config/env");

const TZ = config.TZ;

function nowInTz() {
  return utcToZonedTime(new Date(), TZ);
}

function toUtc(date) {
  return zonedTimeToUtc(date, TZ);
}

function formatTz(date, fmt = "yyyy-MM-dd HH:mm:ss zzz") {
  return format(utcToZonedTime(date, TZ), fmt, { timeZone: TZ });
}

module.exports = { TZ, nowInTz, toUtc, formatTz };
