"use strict";

/**
 * Delivery completion shortcut — state-machine level tests.
 *
 * Staff can mark a delivery delivered from any live state (riders phone in
 * "delivered" without anyone having clicked through the intermediate states).
 * The skip is recorded rather than prevented: the states jumped over are
 * written to the timeline as system-sourced rows so "time in transit" stays
 * coherent. These tests cover the pure decision logic, no database.
 */

const {
  _internals,
} = require("../../../src/modules/logistics/logistics.service");

const { skippedStatesTo, canShortcutToDelivered, TERMINAL } = _internals;

describe("canShortcutToDelivered", () => {
  it("allows the shortcut from every live pre-delivery state", () => {
    for (const s of ["queued", "booked", "picked_up", "in_transit"]) {
      expect(canShortcutToDelivered(s)).toBe(true);
    }
  });

  it("is not a shortcut from out_for_delivery — that is a normal transition", () => {
    expect(canShortcutToDelivered("out_for_delivery")).toBe(false);
  });

  it("refuses the shortcut from terminal states", () => {
    for (const s of TERMINAL) {
      expect(canShortcutToDelivered(s)).toBe(false);
    }
  });

  it("refuses completing a cancelled delivery", () => {
    expect(canShortcutToDelivered("cancelled")).toBe(false);
  });
});

describe("skippedStatesTo", () => {
  it("fills the whole happy path when marking a queued delivery delivered", () => {
    expect(skippedStatesTo("queued", "delivered")).toEqual([
      "booked",
      "picked_up",
      "in_transit",
      "out_for_delivery",
    ]);
  });

  it("fills only what was actually skipped", () => {
    expect(skippedStatesTo("in_transit", "delivered")).toEqual([
      "out_for_delivery",
    ]);
  });

  it("returns nothing for an adjacent transition", () => {
    expect(skippedStatesTo("out_for_delivery", "delivered")).toEqual([]);
  });

  it("invents nothing when the origin is off the happy path", () => {
    // attempted_failed is a real state but not on the linear path — there is
    // no sensible sequence to infer, so none is fabricated.
    expect(skippedStatesTo("attempted_failed", "delivered")).toEqual([]);
  });

  it("never walks backwards", () => {
    expect(skippedStatesTo("delivered", "booked")).toEqual([]);
  });
});
