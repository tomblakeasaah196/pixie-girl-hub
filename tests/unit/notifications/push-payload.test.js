"use strict";

/**
 * The push payload is a WIRE CONTRACT with apps/admin/public/sw.js: the service
 * worker branches on `kind` and reads snake_case keys off the JSON. A rename
 * here silently stops call notifications from ringing (the worker falls through
 * to the generic branch and shows a plain notification with no Answer button),
 * so the shape is pinned by tests rather than by convention.
 */

jest.mock("../../../src/config/database", () => ({ query: jest.fn() }));
jest.mock("../../../src/config/env", () => ({ config: {} }));

const { buildPayload } = require("../../../src/shared/push/push.service");

const parse = (input) => JSON.parse(buildPayload(input));

describe("buildPayload", () => {
  it("keeps the legacy notification shape intact", () => {
    expect(
      parse({ title: "Approval required", body: "PO-0007", url: "/purchasing" }),
    ).toEqual({
      title: "Approval required",
      body: "PO-0007",
      url: "/purchasing",
    });
  });

  it("fills sensible defaults for a bare payload", () => {
    expect(parse({})).toEqual({
      title: "Pixie Hub",
      body: "",
      url: "/notifications",
    });
  });

  it("omits every optional key that wasn't set", () => {
    const keys = Object.keys(parse({ title: "Hi" }));
    expect(keys).not.toContain("kind");
    expect(keys).not.toContain("actions");
    expect(keys).not.toContain("vibrate");
    expect(keys).not.toContain("require_interaction");
    expect(keys).not.toContain("data");
  });

  it("carries the full ring shape the service worker branches on", () => {
    const payload = parse({
      kind: "call_ring",
      title: "📞 Ada Obi is calling",
      body: "Incoming WhatsApp call — tap to answer",
      url: "/smartcomm?channel=c1&answer_call=k1",
      tag: "pgh-call-k1",
      actions: [
        { action: "answer", title: "Answer" },
        { action: "decline", title: "Decline" },
      ],
      require_interaction: true,
      renotify: true,
      vibrate: [600, 250, 600],
      data: { call_id: "k1", brand: "pixiegirl" },
    });

    expect(payload.kind).toBe("call_ring");
    expect(payload.tag).toBe("pgh-call-k1");
    expect(payload.require_interaction).toBe(true);
    expect(payload.renotify).toBe(true);
    expect(payload.vibrate).toEqual([600, 250, 600]);
    expect(payload.actions).toHaveLength(2);
    expect(payload.data.call_id).toBe("k1");
  });

  it("marks a cancel silent so closing a ring never makes a noise", () => {
    const payload = parse({
      kind: "call_cancel",
      title: "Call answered",
      tag: "pgh-call-k1",
      silent: true,
      data: { call_id: "k1", reason: "claimed" },
    });
    expect(payload.kind).toBe("call_cancel");
    expect(payload.silent).toBe(true);
    expect(payload.data.reason).toBe("claimed");
  });

  it("stays well inside the 4 KB push limit for a real ring", () => {
    const json = buildPayload({
      kind: "call_ring",
      title: "📞 A customer with a rather long display name is calling",
      body: "Incoming WhatsApp call — tap to answer",
      url: "/smartcomm?channel=11111111-2222-3333-4444-555555555555&answer_call=66666666-7777-8888-9999-000000000000",
      tag: "pgh-call-66666666-7777-8888-9999-000000000000",
      actions: [
        { action: "answer", title: "Answer" },
        { action: "decline", title: "Decline" },
      ],
      require_interaction: true,
      renotify: true,
      vibrate: [600, 250, 600, 250, 600],
      data: {
        call_id: "66666666-7777-8888-9999-000000000000",
        brand: "faitlynhair",
        channel_id: "11111111-2222-3333-4444-555555555555",
        contact_id: "22222222-3333-4444-5555-666666666666",
        caller_name: "A customer with a rather long display name",
        from_number: "+2348011112222",
        started_at: "2026-07-29T10:00:00.000Z",
        scope: "brand",
        answer_url:
          "/smartcomm?channel=11111111-2222-3333-4444-555555555555&answer_call=66666666-7777-8888-9999-000000000000",
        decline_url:
          "/smartcomm?channel=11111111-2222-3333-4444-555555555555&decline_call=66666666-7777-8888-9999-000000000000",
      },
    });
    expect(Buffer.byteLength(json, "utf8")).toBeLessThan(3000);
  });
});
