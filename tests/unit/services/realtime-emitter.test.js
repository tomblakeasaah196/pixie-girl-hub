"use strict";

/**
 * Realtime broadcaster bridge (realtime/emitter.js) — returns the live
 * Socket.io server when one exists (API process), else a Redis emitter that
 * publishes through the adapter channels (worker process), else throws when
 * Redis is unavailable (tests/scripts) so callers' try/catch keeps working.
 */

const mockGetIo = jest.fn();
jest.mock("../../../src/config/socket", () => ({
  getIo: (...a) => mockGetIo(...a),
}));

const mockGetPublisher = jest.fn();
jest.mock("../../../src/config/redis", () => ({
  getPublisher: (...a) => mockGetPublisher(...a),
}));

beforeEach(() => {
  jest.resetModules(); // fresh module state (cached redisEmitter) per test
  jest.clearAllMocks();
});

function load() {
  return require("../../../src/realtime/emitter");
}

it("returns the live Socket.io server when initialised (API process)", () => {
  const fakeIo = { to: jest.fn(), emit: jest.fn() };
  mockGetIo.mockReturnValue(fakeIo);

  const { getBroadcaster } = load();
  expect(getBroadcaster()).toBe(fakeIo);
  expect(mockGetPublisher).not.toHaveBeenCalled();
});

it("falls back to a Redis emitter in a server-less (worker) process", () => {
  mockGetIo.mockImplementation(() => {
    throw new Error("socket.io not initialised");
  });
  const fakePublisher = { publish: jest.fn() };
  mockGetPublisher.mockReturnValue(fakePublisher);

  const { getBroadcaster } = load();
  const broadcaster = getBroadcaster();

  // Emitting to a room must publish through the redis client the API's
  // socket.io redis-adapter is subscribed to.
  broadcaster.to("brand:pixiegirl:stock").emit("stock:moved", { x: 1 });
  expect(fakePublisher.publish).toHaveBeenCalledTimes(1);
  const [channel] = fakePublisher.publish.mock.calls[0];
  expect(String(channel)).toContain("socket.io"); // adapter's default prefix
});

it("reuses one Redis emitter across calls", () => {
  mockGetIo.mockImplementation(() => {
    throw new Error("socket.io not initialised");
  });
  mockGetPublisher.mockReturnValue({ publish: jest.fn() });

  const { getBroadcaster } = load();
  expect(getBroadcaster()).toBe(getBroadcaster());
  expect(mockGetPublisher).toHaveBeenCalledTimes(1);
});

it("throws (for callers' try/catch) when neither socket nor redis exist", () => {
  mockGetIo.mockImplementation(() => {
    throw new Error("socket.io not initialised");
  });
  mockGetPublisher.mockImplementation(() => {
    throw new Error("redis not initialised");
  });

  const { getBroadcaster } = load();
  expect(() => getBroadcaster()).toThrow("redis not initialised");
});
