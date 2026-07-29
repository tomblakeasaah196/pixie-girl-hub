"use strict";

/**
 * Unit tests for the out-of-app ring (calls.push): who gets a ring push for
 * each routing scope, who gets a cancel when the ring is over, that the
 * per-user opt-out is honoured, and — the load-bearing one — that a broken
 * push service can never break the ring itself.
 *
 * The module event bus is real (handlers register on require), so these tests
 * drive it exactly as calls.service does.
 */

jest.mock("../../../src/config/database", () => ({
  query: jest.fn(),
  ex: jest.fn(),
  transaction: jest.fn(),
}));
jest.mock("../../../src/modules/calls/calls.repo", () => ({
  findRingAudience: jest.fn(),
  getChannelOwner: jest.fn(),
}));
jest.mock("../../../src/shared/push/push.service", () => ({
  sendToUsers: jest.fn(async () => 1),
}));
jest.mock("../../../src/services/notifications.service", () => ({
  isChannelEnabled: jest.fn(async () => true),
}));

const events = require("../../../src/modules/calls/calls.events");
const repo = require("../../../src/modules/calls/calls.repo");
const push = require("../../../src/shared/push/push.service");
const notifications = require("../../../src/services/notifications.service");

// Requiring the module registers its subscribers (side effect, as in prod).
const callsPush = require("../../../src/modules/calls/calls.push");

/** Handlers are fire-and-forget; let their promise chains settle. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

const RING = {
  call_id: "call-1",
  brand: "pixiegirl",
  caller_name: "Ada Obi",
  from_number: "+2348011112222",
  contact_id: "contact-1",
  channel_id: "chan-1",
  started_at: "2026-07-29T10:00:00.000Z",
};

beforeEach(() => {
  jest.clearAllMocks();
  push.sendToUsers.mockResolvedValue(1);
  notifications.isChannelEnabled.mockResolvedValue(true);
  repo.findRingAudience.mockResolvedValue(["agent-1", "agent-2", "ceo-1"]);
  repo.getChannelOwner.mockResolvedValue("agent-1");
});

describe("ring fanout", () => {
  it("owner-first rings only the assigned agent", async () => {
    events.emit("call.ringing", {
      ...RING,
      scope: "owner",
      owner_user_id: "agent-1",
    });
    await flush();

    expect(repo.findRingAudience).not.toHaveBeenCalled();
    expect(push.sendToUsers).toHaveBeenCalledTimes(1);
    const arg = push.sendToUsers.mock.calls[0][0];
    expect(arg.user_ids).toEqual(["agent-1"]);
    expect(arg.kind).toBe("call_ring");
    expect(arg.title).toContain("Ada Obi");
  });

  it("an unassigned thread rings everyone who could answer", async () => {
    events.emit("call.ringing", { ...RING, scope: "brand" });
    await flush();

    expect(repo.findRingAudience).toHaveBeenCalledWith({
      brand: "pixiegirl",
      channel_id: "chan-1",
    });
    expect(push.sendToUsers.mock.calls[0][0].user_ids).toEqual([
      "agent-1",
      "agent-2",
      "ceo-1",
    ]);
  });

  it("escalation skips the owner, who is already ringing", async () => {
    events.emit("call.escalated", { ...RING, scope: "brand" });
    await flush();

    expect(push.sendToUsers.mock.calls[0][0].user_ids).toEqual([
      "agent-2",
      "ceo-1",
    ]);
  });

  it("a released claim re-rings the whole team", async () => {
    events.emit("call.claim_released", RING);
    await flush();

    expect(push.sendToUsers.mock.calls[0][0].user_ids).toEqual([
      "agent-1",
      "agent-2",
      "ceo-1",
    ]);
  });

  it("carries the answer + decline deep links and a short TTL", async () => {
    events.emit("call.ringing", { ...RING, scope: "brand" });
    await flush();

    const arg = push.sendToUsers.mock.calls[0][0];
    expect(arg.urgency).toBe("high");
    expect(arg.ttl).toBe(callsPush.RING_PUSH_TTL_SECONDS);
    expect(arg.require_interaction).toBe(true);
    expect(arg.tag).toBe("pgh-call-call-1");
    expect(arg.data.answer_url).toBe(
      "/smartcomm?channel=chan-1&answer_call=call-1",
    );
    expect(arg.data.decline_url).toBe(
      "/smartcomm?channel=chan-1&decline_call=call-1",
    );
    expect(arg.actions.map((a) => a.action)).toEqual(["answer", "decline"]);
  });

  it("builds a usable link even for a call with no thread yet", async () => {
    expect(callsPush.answerUrl({ call_id: "c9", channel_id: null })).toBe(
      "/smartcomm?answer_call=c9",
    );
  });
});

describe("preferences", () => {
  it("drops users who turned call pushes off", async () => {
    notifications.isChannelEnabled.mockImplementation(async ({ user_id }) =>
      user_id !== "agent-2",
    );
    events.emit("call.ringing", { ...RING, scope: "brand" });
    await flush();

    expect(push.sendToUsers.mock.calls[0][0].user_ids).toEqual([
      "agent-1",
      "ceo-1",
    ]);
  });

  it("never sends when the whole audience opted out", async () => {
    notifications.isChannelEnabled.mockResolvedValue(false);
    events.emit("call.ringing", { ...RING, scope: "brand" });
    await flush();

    expect(push.sendToUsers).not.toHaveBeenCalled();
  });

  it("keeps ringing when the preference lookup itself fails", async () => {
    notifications.isChannelEnabled.mockRejectedValue(new Error("db down"));
    events.emit("call.ringing", { ...RING, scope: "owner", owner_user_id: "agent-1" });
    await flush();

    expect(push.sendToUsers.mock.calls[0][0].user_ids).toEqual(["agent-1"]);
  });
});

describe("cancel fanout", () => {
  it("claimed clears the ring on every device but the winner's", async () => {
    events.emit("call.claimed", {
      call_id: "call-1",
      brand: "pixiegirl",
      channel_id: "chan-1",
      answered_by: "agent-2",
      answered_by_name: "Tunde",
    });
    await flush();

    const arg = push.sendToUsers.mock.calls[0][0];
    expect(arg.kind).toBe("call_cancel");
    expect(arg.user_ids).toEqual(["agent-1", "ceo-1"]);
    expect(arg.tag).toBe("pgh-call-call-1");
    expect(arg.silent).toBe(true);
    expect(arg.body).toContain("Tunde");
  });

  it("a missed call clears the ring everywhere", async () => {
    events.emit("call.ended", {
      call_id: "call-1",
      brand: "pixiegirl",
      channel_id: "chan-1",
      status: "missed",
      caller_name: "Ada Obi",
    });
    await flush();

    const arg = push.sendToUsers.mock.calls[0][0];
    expect(arg.kind).toBe("call_cancel");
    expect(arg.user_ids).toEqual(["agent-1", "agent-2", "ceo-1"]);
    expect(arg.data.reason).toBe("missed");
  });

  it("an answered call sends no second cancel — claimed already did it", async () => {
    events.emit("call.ended", {
      call_id: "call-1",
      brand: "pixiegirl",
      channel_id: "chan-1",
      status: "completed",
      answered_by: "agent-2",
      duration_seconds: 92,
    });
    await flush();

    expect(push.sendToUsers).not.toHaveBeenCalled();
  });
});

describe("isolation from the ring path", () => {
  it("a throwing push service does not propagate out of emit()", async () => {
    push.sendToUsers.mockRejectedValue(new Error("FCM unreachable"));
    expect(() =>
      events.emit("call.ringing", { ...RING, scope: "brand" }),
    ).not.toThrow();
    await flush();
  });

  it("an audience lookup failure does not propagate out of emit()", async () => {
    repo.findRingAudience.mockRejectedValue(new Error("db down"));
    expect(() =>
      events.emit("call.ringing", { ...RING, scope: "brand" }),
    ).not.toThrow();
    await flush();
    expect(push.sendToUsers).not.toHaveBeenCalled();
  });
});
