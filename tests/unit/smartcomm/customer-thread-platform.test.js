"use strict";

/**
 * Customer threads are one-per-platform. The outbound job builder derives
 * the wire protocol from the thread's external_platform, so a
 * cross-platform thread match silently flips the send channel — the bug
 * where a staff member picked "Email" in the composer and the message
 * went out over the contact's existing WhatsApp thread. These tests pin
 * the platform-scoped lookup at both layers.
 */

jest.mock("../../../src/modules/smartcomm/smartcomm.repo", () => ({
  findCustomerThread: jest.fn(),
  findCustomerThreadByExternalRef: jest.fn(),
  createChannel: jest.fn(),
  addMember: jest.fn(),
}));
jest.mock("../../../src/modules/smartcomm/smartcomm.events", () => ({
  emit: jest.fn(),
  on: jest.fn(),
}));
jest.mock("../../../src/jobs/queue-producer", () => ({
  enqueue: jest.fn(async () => ({})),
}));
jest.mock("../../../src/middleware/audit", () => ({
  audit: jest.fn(async () => {}),
}));
jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn(),
  query: jest.fn(async () => ({ rows: [] })),
  ex: jest.fn(),
}));
jest.mock("../../../src/services/storage.service", () => ({
  absoluteUrl: jest.fn((key) => `https://hub.example.com/media/${key}`),
  publicUrl: jest.fn((key) => `/media/${key}`),
}));

const repo = require("../../../src/modules/smartcomm/smartcomm.repo");
const service = require("../../../src/modules/smartcomm/smartcomm.service");

describe("findOrCreateCustomerThread — platform scoping", () => {
  beforeEach(() => jest.clearAllMocks());

  test("looks up the contact's thread FOR the requested platform", async () => {
    repo.findCustomerThread.mockResolvedValueOnce({
      channel_id: "ch-email",
      external_platform: "email",
    });
    const th = await service.findOrCreateCustomerThread({
      client: {},
      brand: "faitlynhair",
      contact_id: "c-1",
      platform: "email",
    });
    expect(repo.findCustomerThread).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "email" }),
    );
    expect(th.channel_id).toBe("ch-email");
    expect(repo.createChannel).not.toHaveBeenCalled();
  });

  test("creates a NEW email thread when the contact only has WhatsApp history", async () => {
    // Platform-scoped lookup finds nothing (the WhatsApp thread no longer
    // matches an email request) → a fresh email thread is created.
    repo.findCustomerThread.mockResolvedValueOnce(null);
    repo.createChannel.mockResolvedValueOnce({
      channel_id: "ch-new",
      external_platform: "email",
    });
    repo.addMember.mockResolvedValueOnce({});
    const th = await service.findOrCreateCustomerThread({
      client: {},
      brand: "faitlynhair",
      contact_id: "c-1",
      platform: "email",
    });
    expect(repo.createChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: expect.objectContaining({ external_platform: "email" }),
      }),
    );
    expect(th.channel_id).toBe("ch-new");
  });
});

describe("repo.findCustomerThread — SQL filters on external_platform", () => {
  const realRepo = jest.requireActual(
    "../../../src/modules/smartcomm/smartcomm.repo",
  );
  const { ex } = require("../../../src/config/database");

  test("the query binds brand, contact AND platform", async () => {
    const run = jest.fn(async () => ({ rows: [] }));
    ex.mockReturnValueOnce(run);
    await realRepo.findCustomerThread({
      client: {},
      brand: "faitlynhair",
      contact_id: "c-1",
      platform: "email",
    });
    const [sql, params] = run.mock.calls[0];
    expect(sql).toMatch(/external_platform\s*=\s*\$3/);
    expect(params).toEqual(["faitlynhair", "c-1", "email"]);
  });
});
