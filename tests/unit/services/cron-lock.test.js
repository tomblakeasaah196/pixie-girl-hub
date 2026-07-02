"use strict";

/**
 * Cron lock (jobs/cron-lock.js) — advisory-lock acquire/skip/unlock semantics
 * against a mocked pg pool client.
 */

const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};
const mockConnect = jest.fn(async () => mockClient);
jest.mock("../../../src/config/database", () => ({
  getPool: () => ({ connect: mockConnect }),
}));

const { withCronLock } = require("../../../src/jobs/cron-lock");

const lockAcquired = { rows: [{ acquired: true }] };
const lockHeldElsewhere = { rows: [{ acquired: false }] };
const unlocked = { rows: [{ pg_advisory_unlock: true }] };

beforeEach(() => {
  jest.clearAllMocks();
});

it("runs fn and unlocks on the SAME client when the lock is acquired", async () => {
  mockClient.query
    .mockResolvedValueOnce(lockAcquired) // pg_try_advisory_lock
    .mockResolvedValueOnce(unlocked); // pg_advisory_unlock
  const fn = jest.fn(async () => "done");

  const result = await withCronLock("email-campaign-send", fn);

  expect(result).toBe("done");
  expect(fn).toHaveBeenCalledTimes(1);
  expect(mockClient.query).toHaveBeenNthCalledWith(
    1,
    expect.stringContaining("pg_try_advisory_lock"),
    ["cron:email-campaign-send"],
  );
  expect(mockClient.query).toHaveBeenNthCalledWith(
    2,
    expect.stringContaining("pg_advisory_unlock"),
    ["cron:email-campaign-send"],
  );
  expect(mockClient.release).toHaveBeenCalledWith(); // returned to pool clean
});

it("skips fn (returns undefined) when another instance holds the lock", async () => {
  mockClient.query.mockResolvedValueOnce(lockHeldElsewhere);
  const fn = jest.fn();

  const result = await withCronLock("subscription-billing", fn);

  expect(result).toBeUndefined();
  expect(fn).not.toHaveBeenCalled();
  expect(mockClient.query).toHaveBeenCalledTimes(1); // no unlock issued
  expect(mockClient.release).toHaveBeenCalledTimes(1);
});

it("still unlocks and releases when fn throws, propagating the error", async () => {
  mockClient.query
    .mockResolvedValueOnce(lockAcquired)
    .mockResolvedValueOnce(unlocked);
  const boom = new Error("job exploded");

  await expect(
    withCronLock("low-stock-alerts", async () => {
      throw boom;
    }),
  ).rejects.toThrow("job exploded");

  expect(mockClient.query).toHaveBeenNthCalledWith(
    2,
    expect.stringContaining("pg_advisory_unlock"),
    ["cron:low-stock-alerts"],
  );
  expect(mockClient.release).toHaveBeenCalledTimes(1);
});

it("destroys the connection (release(err)) when the unlock itself fails", async () => {
  const unlockErr = new Error("connection reset");
  mockClient.query
    .mockResolvedValueOnce(lockAcquired)
    .mockRejectedValueOnce(unlockErr);

  const result = await withCronLock("invoice-reminders", async () => "ok");

  expect(result).toBe("ok");
  // released WITH the error so pg destroys the session — the advisory lock
  // must die with the connection, never ride a recycled one back to the pool.
  expect(mockClient.release).toHaveBeenCalledTimes(1);
  expect(mockClient.release).toHaveBeenCalledWith(unlockErr);
});

it("releases the client even if the lock query itself fails", async () => {
  mockClient.query.mockRejectedValueOnce(new Error("db down"));

  await expect(withCronLock("fx-rate-refresh", jest.fn())).rejects.toThrow(
    "db down",
  );
  expect(mockClient.release).toHaveBeenCalledTimes(1);
});
