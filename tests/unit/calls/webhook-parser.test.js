"use strict";

/**
 * Unit tests for the `calls` webhook parser (calls.service). Pure
 * functions over Meta's payload shapes — hermetic via the same mock set
 * the smartcomm parser tests use.
 */

jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn(),
  query: jest.fn(),
  ex: jest.fn(),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/modules/calls/calls.repo", () => ({}));
jest.mock("../../../src/modules/smartcomm/smartcomm.repo", () => ({
  findMessagingAccount: jest.fn(),
}));
jest.mock("../../../src/services/whatsapp-calling.service", () => ({
  getIceServers: jest.fn(() => []),
}));

const {
  parseMetaWhatsAppCalls,
  payloadHasCalls,
} = require("../../../src/modules/calls/calls.service");

const CONNECT_PAYLOAD = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA_ID",
      changes: [
        {
          field: "calls",
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "2348010000000",
              phone_number_id: "PHONE_ID_123",
            },
            contacts: [{ wa_id: "2348012345678", profile: { name: "Ada" } }],
            calls: [
              {
                id: "wacid.ABC123",
                from: "2348012345678",
                to: "2348010000000",
                event: "connect",
                timestamp: "1720000000",
                direction: "USER_INITIATED",
                session: { sdp_type: "offer", sdp: "v=0\r\no=- 46117 2 IN IP4..." },
              },
            ],
          },
        },
      ],
    },
  ],
};

const TERMINATE_PAYLOAD = {
  entry: [
    {
      changes: [
        {
          field: "calls",
          value: {
            metadata: { phone_number_id: "PHONE_ID_123" },
            calls: [
              {
                id: "wacid.ABC123",
                event: "terminate",
                status: "COMPLETED",
                timestamp: "1720000300",
                start_time: "1720000010",
                end_time: "1720000290",
                duration: 280,
              },
            ],
          },
        },
      ],
    },
  ],
};

describe("calls webhook parser", () => {
  test("parses a connect event with SDP offer + caller profile", () => {
    const evts = parseMetaWhatsAppCalls(CONNECT_PAYLOAD);
    expect(evts).toHaveLength(1);
    expect(evts[0]).toMatchObject({
      external_account_id: "PHONE_ID_123",
      wa_call_id: "wacid.ABC123",
      event: "connect",
      direction: "USER_INITIATED",
      from: "2348012345678",
      to: "2348010000000",
      caller_name: "Ada",
    });
    expect(evts[0].sdp).toContain("v=0");
    expect(evts[0].timestamp).toBe(new Date(1720000000 * 1000).toISOString());
  });

  test("parses a terminate event with status + duration + times", () => {
    const evts = parseMetaWhatsAppCalls(TERMINATE_PAYLOAD);
    expect(evts).toHaveLength(1);
    expect(evts[0]).toMatchObject({
      wa_call_id: "wacid.ABC123",
      event: "terminate",
      status: "COMPLETED",
      duration: 280,
    });
    expect(evts[0].end_time).toBe(new Date(1720000290 * 1000).toISOString());
    expect(evts[0].sdp).toBeNull();
  });

  test("ignores non-calls field changes (messages stay with smartcomm)", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "PHONE_ID_123" },
                messages: [{ id: "wamid.X", from: "234", type: "text" }],
              },
            },
          ],
        },
      ],
    };
    expect(parseMetaWhatsAppCalls(payload)).toHaveLength(0);
    expect(payloadHasCalls(payload)).toBe(false);
  });

  test("payloadHasCalls flags calls changes", () => {
    expect(payloadHasCalls(CONNECT_PAYLOAD)).toBe(true);
  });

  test("survives malformed payloads without throwing", () => {
    expect(parseMetaWhatsAppCalls(null)).toEqual([]);
    expect(parseMetaWhatsAppCalls({})).toEqual([]);
    expect(
      parseMetaWhatsAppCalls({
        entry: [{ changes: [{ field: "calls", value: { calls: [{}] } }] }],
      }),
    ).toEqual([]); // a call without an id is dropped
    expect(payloadHasCalls(null)).toBe(false);
  });

  test("missing timestamps parse to null, bad durations to a number", () => {
    const evts = parseMetaWhatsAppCalls({
      entry: [
        {
          changes: [
            {
              field: "calls",
              value: {
                metadata: { phone_number_id: "P" },
                calls: [
                  { id: "wacid.X", event: "terminate", duration: "not-a-number" },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(evts[0].timestamp).toBeNull();
    expect(evts[0].end_time).toBeNull();
    expect(evts[0].duration).toBe(0);
  });
});
