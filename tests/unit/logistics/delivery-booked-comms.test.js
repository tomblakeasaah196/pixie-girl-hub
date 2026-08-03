"use strict";

/**
 * delivery-comms — the "your delivery is booked" notice.
 *
 * Two things matter here and neither is visible from the delivery record:
 *   1. The shipment facts the customer actually receives. A missing waybill or
 *      a wrong ETA reaches a real person, so the token builder is locked down
 *      line by line — including that the HTML and plain-text variants carry the
 *      SAME facts (an operator switching the automation to WhatsApp must not
 *      silently lose the details).
 *   2. That every attempt lands on the delivery's outbound ledger, whichever
 *      channel the CEO picked — that ledger is what the Delivery-comms panel
 *      reads to answer "was it sent, did it land, did she open it?".
 */

const mockDispatch = jest.fn(async () => ({ dispatched: true, channel: "email" }));
const mockRecord = jest.fn(async () => {});
const mockHasStatus = jest.fn(async () => false);
const mockListForReference = jest.fn(async () => []);
const mockGetContext = jest.fn();

jest.mock("../../../src/modules/comms_studio/comms-studio.service", () => ({
  dispatch: mockDispatch,
}));
jest.mock("../../../src/services/comms-log.service", () => ({
  record: mockRecord,
  hasStatus: mockHasStatus,
  listForReference: mockListForReference,
}));
jest.mock("../../../src/utils/brand-urls", () => ({
  publicBaseUrl: jest.fn(async () => "https://shop.example"),
}));
jest.mock("../../../src/modules/logistics/logistics.repo", () => ({
  getNotificationContext: mockGetContext,
}));

const comms = require("../../../src/modules/logistics/delivery-comms.service");

const brand = "faitlynhair";

/** A fully-specified booking — every optional detail present. */
const fullCtx = () => ({
  delivery_id: "del-1",
  delivery_number: "FLH-DEL-0079",
  order_id: "ord-1",
  order_number: "FLH-SO-1024",
  order_tracking_token: "tok-abc",
  contact_id: "contact-1",
  contact_email: "adaeze@example.com",
  contact_first_name: "Adaeze",
  recipient_name_snapshot: "Adaeze Okoro",
  recipient_phone_snapshot: "+2348030000000",
  courier_name: "GIG Logistics",
  courier_phone: "+2348011111111",
  courier_tracking_ref: "AWB-889213",
  courier_tracking_url: "https://gig.example/t/AWB-889213",
  expected_delivery_at: "2026-08-12T10:00:00.000Z",
  scheduled_pickup_at: "2026-08-11T09:00:00.000Z",
  driver_name: "Musa Bello",
  driver_phone: "0803 000 0000",
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDispatch.mockResolvedValue({ dispatched: true, channel: "email" });
  mockGetContext.mockResolvedValue(fullCtx());
});

describe("buildBookedVariables", () => {
  const build = (over = {}) =>
    comms.buildBookedVariables({
      ctx: { ...fullCtx(), ...over },
      tracking_url: "https://shop.example/track/tok-abc",
    });

  it("carries every shipment fact the operator typed at booking", () => {
    const v = build();
    expect(v.courier_name).toBe("GIG Logistics");
    expect(v.tracking_ref).toBe("AWB-889213");
    expect(v.driver_text).toBe("Musa Bello · 0803 000 0000");
    expect(v.order_number).toBe("FLH-SO-1024");
    expect(v.tracking_url).toBe("https://shop.example/track/tok-abc");
  });

  it("puts the same facts in the HTML and the plain-text detail blocks", () => {
    const v = build();
    for (const fact of ["GIG Logistics", "AWB-889213", "Musa Bello"]) {
      expect(v.shipment_details_html).toContain(fact);
      expect(v.shipment_details_text).toContain(fact);
    }
  });

  it("omits the lines a walk-in booking has no answer for", () => {
    const v = build({
      courier_tracking_ref: null,
      expected_delivery_at: null,
      scheduled_pickup_at: null,
      driver_name: null,
      driver_phone: null,
      courier_tracking_url: null,
    });
    expect(v.shipment_details_html).toBe("<strong>Shipper:</strong> GIG Logistics");
    expect(v.shipment_details_html).not.toContain("Waybill");
    expect(v.driver_text).toBe("");
    // No courier portal → no dangling "Track directly with…" sentence.
    expect(v.courier_tracking_html).toBe("");
  });

  it("falls back to a neutral shipper name rather than an empty sentence", () => {
    expect(build({ courier_name: null }).courier_name).toBe("our courier");
  });

  it("addresses the person receiving the parcel, not the buyer", () => {
    // A gift ships to someone other than whoever paid.
    expect(build({ recipient_name_snapshot: "Ngozi Eze" }).first_name).toBe("Ngozi");
  });

  it("escapes courier-supplied text so it cannot inject markup into the email", () => {
    const v = build({ courier_name: '<script>alert(1)</script>' });
    expect(v.shipment_details_html).not.toContain("<script>");
    expect(v.shipment_details_html).toContain("&lt;script&gt;");
  });
});

describe("sendBookedNotice", () => {
  it("dispatches the delivery_booked automation through the Studio funnel", async () => {
    const res = await comms.sendBookedNotice({ brand, delivery_id: "del-1" });
    expect(res).toMatchObject({ sent: true, channel: "email" });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        brand,
        event_key: "delivery_booked",
        contact_id: "contact-1",
        reference_type: "delivery",
        reference_id: "del-1",
        dedup_key: "delivery_booked:del-1",
      }),
    );
  });

  it("records the email handoff on the delivery's ledger", async () => {
    await comms.sendBookedNotice({ brand, delivery_id: "del-1" });
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        reference_type: "delivery",
        reference_id: "del-1",
        status: "queued",
        channel: "email",
        recipient: "adaeze@example.com",
      }),
    );
  });

  it("records a WhatsApp send itself — the dispatcher does not log that channel", async () => {
    mockDispatch.mockResolvedValue({ dispatched: true, channel: "whatsapp" });
    const res = await comms.sendBookedNotice({ brand, delivery_id: "del-1" });
    expect(res).toMatchObject({ sent: true, channel: "whatsapp" });
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "whatsapp", status: "sent" }),
    );
  });

  it("logs WHY nothing went out when the automation is switched off", async () => {
    mockDispatch.mockResolvedValue({ dispatched: false, reason: "disabled" });
    const res = await comms.sendBookedNotice({ brand, delivery_id: "del-1" });
    expect(res).toEqual({ sent: false, reason: "disabled" });
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", error: "disabled" }),
    );
  });

  it("treats an at-least-once redelivery as already-handled, not a failure row", async () => {
    mockDispatch.mockResolvedValue({
      dispatched: false,
      duplicate: true,
      reason: "already_sent",
    });
    const res = await comms.sendBookedNotice({ brand, delivery_id: "del-1" });
    expect(res).toMatchObject({ sent: false, duplicate: true });
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("claims a fresh dedup slot on a manual resend so a fixed waybill re-sends", async () => {
    await comms.sendBookedNotice({ brand, delivery_id: "del-1", manual: true });
    const { dedup_key } = mockDispatch.mock.calls[0][0];
    expect(dedup_key).toMatch(/^delivery_booked:del-1:manual:\d+$/);
  });

  it("says nothing to nobody — a stock transfer has no customer", async () => {
    mockGetContext.mockResolvedValue({ ...fullCtx(), contact_id: null });
    const res = await comms.sendBookedNotice({ brand, delivery_id: "del-1" });
    expect(res).toEqual({ sent: false, reason: "no_customer_on_delivery" });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("never throws — a comms failure must not surface as a booking failure", async () => {
    mockDispatch.mockRejectedValue(new Error("redis is down"));
    await expect(
      comms.sendBookedNotice({ brand, delivery_id: "del-1" }),
    ).resolves.toEqual({ sent: false, reason: "send_failed" });
  });
});

describe("getCommsView", () => {
  // listForReference returns newest-first; the stamps must report the FIRST
  // time each stage was reached, not the most recent row.
  const rows = [
    { log_id: "3", status: "opened", channel: "email", event_key: "delivery.tracking_opened", created_at: "2026-08-12T09:00:00.000Z" },
    { log_id: "2", status: "sent", channel: "email", event_key: "delivery_booked", created_at: "2026-08-11T08:00:00.000Z" },
    { log_id: "1", status: "queued", channel: "email", event_key: "delivery_booked", created_at: "2026-08-11T07:59:00.000Z" },
  ];

  it("derives the sent / opened stamps from the oldest matching row", async () => {
    mockListForReference.mockResolvedValue(rows);
    const view = await comms.getCommsView({ delivery_id: "del-1" });
    expect(view.sent_at).toBe("2026-08-11T08:00:00.000Z");
    expect(view.first_viewed_at).toBe("2026-08-12T09:00:00.000Z");
    expect(view.booked_notice_sent_at).toBe("2026-08-11T08:00:00.000Z");
    expect(view.booked_notice_via).toBe("email");
    expect(view.history).toHaveLength(3);
  });

  it("reports an untouched delivery as nothing-sent rather than guessing", async () => {
    mockListForReference.mockResolvedValue([]);
    const view = await comms.getCommsView({ delivery_id: "del-1" });
    expect(view).toMatchObject({
      sent_at: null,
      first_viewed_at: null,
      booked_notice_sent_at: null,
      history: [],
    });
  });

  it("does not report the delivered-confirmation as the booking notice", async () => {
    mockListForReference.mockResolvedValue([
      { log_id: "1", status: "sent", channel: "email", event_key: "delivery_delivered", created_at: "2026-08-12T18:00:00.000Z" },
    ]);
    const view = await comms.getCommsView({ delivery_id: "del-1" });
    expect(view.sent_at).toBe("2026-08-12T18:00:00.000Z");
    expect(view.booked_notice_sent_at).toBeNull();
  });
});

describe("markTrackingOpened", () => {
  const delivery = { delivery_id: "del-1", delivery_number: "FLH-DEL-0079" };

  it("stamps the first open — the only honest read signal on plain SMTP", async () => {
    await comms.markTrackingOpened({ brand, delivery, contact_id: "contact-1" });
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "opened",
        reference_type: "delivery",
        reference_id: "del-1",
        contact_id: "contact-1",
      }),
    );
  });

  it("stamps once, not once per poll of the tracking page", async () => {
    mockHasStatus.mockResolvedValue(true);
    await comms.markTrackingOpened({ brand, delivery, contact_id: "contact-1" });
    expect(mockRecord).not.toHaveBeenCalled();
  });
});
