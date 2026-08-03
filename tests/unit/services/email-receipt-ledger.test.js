"use strict";

/**
 * Correlating an ESP receipt back to the send it belongs to.
 *
 * We send over SMTP, so a webhook arrives knowing nothing about our rows. Get
 * this wrong and a "delivered" lands on the wrong customer's order — which is
 * worse than no receipt at all. The rules under test:
 *
 *   • our own `message_ref` is the primary key, the SMTP Message-ID the fallback;
 *   • the event row INHERITS the send's contact + document context, so the
 *     delivery/invoice screens light up without extra wiring;
 *   • repeat opens collapse to the first (the question is "when did she FIRST
 *     see it", and a mail client can fire the pixel on every scroll);
 *   • a fresh batch that matched nothing throws so the outbox retries (a
 *     receipt can beat our own send row), but an OLD one is dropped rather
 *     than retried 25 times for mail that predates the feature.
 */

const mockQuery = jest.fn();
jest.mock("../../../src/config/database", () => ({ query: mockQuery }));

const commsLog = require("../../../src/services/comms-log.service");

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [] });
});

const sendRow = {
  log_id: "log-1",
  business: "faitlynhair",
  contact_id: "contact-1",
  channel: "email",
  event_key: "delivery_booked",
  recipient: "adaeze@example.com",
  subject: "Delivery FLH-DEL-0079 booked",
  reference_type: "delivery",
  reference_id: "del-1",
  message_ref: "ref123",
};

describe("findSendForEvent", () => {
  it("correlates on our own ref first", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [sendRow] });
    const found = await commsLog.findSendForEvent({ message_ref: "ref123" });
    expect(found).toEqual(sendRow);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toContain("message_ref = $1");
  });

  it("falls back to the SMTP Message-ID when the ref did not match", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // ref miss
      .mockResolvedValueOnce({ rows: [sendRow] }); // message-id hit
    const found = await commsLog.findSendForEvent({
      message_ref: "ref123",
      provider_ref: "abc@hub",
    });
    expect(found).toEqual(sendRow);
    expect(mockQuery.mock.calls[1][0]).toContain("provider_ref = $1");
  });

  it("returns null rather than guessing when neither key matches", async () => {
    expect(
      await commsLog.findSendForEvent({ message_ref: "nope", provider_ref: "nope" }),
    ).toBeNull();
  });

  it("does not query at all with nothing to correlate on", async () => {
    expect(await commsLog.findSendForEvent({})).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("recordProviderEvent", () => {
  const event = {
    provider: "sendgrid",
    provider_event_id: "sg-1",
    status: "delivered",
    provider_ref: "abc@hub",
    recipient: "adaeze@example.com",
    event_at: "2026-08-03T06:26:40.000Z",
    error: null,
  };

  it("inherits the send's contact and document context", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ log_id: "log-2" }] });
    const r = await commsLog.recordProviderEvent({ send: sendRow, event });
    expect(r).toEqual({ recorded: true });
    const params = mockQuery.mock.calls[0][1];
    // business, contact, reference_type/id all come from the SEND, not the event.
    expect(params).toEqual(
      expect.arrayContaining([
        "faitlynhair",
        "contact-1",
        "delivery",
        "del-1",
        "delivered",
        "sendgrid",
        "sg-1",
      ]),
    );
  });

  it("is a no-op when the provider redelivers the same event", async () => {
    // ON CONFLICT DO NOTHING → no returned row.
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await commsLog.recordProviderEvent({ send: sendRow, event })).toEqual({
      recorded: false,
      reason: "duplicate_event",
    });
  });

  it("records only the FIRST open, not every pixel fire", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] }); // already opened
    const r = await commsLog.recordProviderEvent({
      send: sendRow,
      event: { ...event, status: "opened", provider_event_id: "sg-2" },
    });
    expect(r).toEqual({ recorded: false, reason: "already_opened" });
    // Guard query only — no insert attempted.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("lets a second open through when there was no first", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // not opened yet
      .mockResolvedValueOnce({ rows: [{ log_id: "log-3" }] });
    const r = await commsLog.recordProviderEvent({
      send: sendRow,
      event: { ...event, status: "opened", provider_event_id: "sg-2" },
    });
    expect(r).toEqual({ recorded: true });
  });

  it("does not collapse a bounce the way it collapses opens", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ log_id: "log-4" }] });
    const r = await commsLog.recordProviderEvent({
      send: sendRow,
      event: { ...event, status: "bounced", error: "550 no mailbox" },
    });
    expect(r).toEqual({ recorded: true });
    expect(mockQuery).toHaveBeenCalledTimes(1); // straight to the insert
  });

  it("never throws — a ledger hiccup must not fail the webhook", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db is down"));
    await expect(
      commsLog.recordProviderEvent({ send: sendRow, event }),
    ).resolves.toEqual({ recorded: false, reason: "insert_failed" });
  });
});
