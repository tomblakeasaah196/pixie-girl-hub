"use strict";

/**
 * email-receipts — the ESP webhook adapters.
 *
 * These parsers are the only thing standing between a provider's payload shape
 * and a wrong claim on a customer-facing ledger ("delivered" when it bounced).
 * Every payload below is the documented shape from the provider's own webhook
 * reference, so a provider changing its schema fails here rather than silently
 * dropping receipts in production.
 *
 * The signature verifiers are tested for the three outcomes that matter:
 * null when unconfigured (never process an unverifiable payload), false on a
 * bad signature, true on a good one computed the way the provider computes it.
 */

const crypto = require("crypto");

const ENV = {};
jest.mock("../../../src/config/env", () => ({ config: ENV }));

const receipts = require("../../../src/services/email-receipts.service");

beforeEach(() => {
  for (const k of Object.keys(ENV)) delete ENV[k];
});

describe("refHeaders", () => {
  it("sets a metadata header for every supported provider", () => {
    const h = receipts.refHeaders("ref123");
    expect(h["X-Entity-Ref-ID"]).toBe("ref123");
    expect(JSON.parse(h["X-SMTPAPI"]).unique_args.comms_ref).toBe("ref123");
    expect(JSON.parse(h["X-Mailgun-Variables"]).comms_ref).toBe("ref123");
    expect(h["X-PM-Metadata-comms_ref"]).toBe("ref123");
    expect(h["X-SES-MESSAGE-TAGS"]).toBe("comms_ref=ref123");
  });

  it("adds nothing when there is no ref to correlate on", () => {
    expect(receipts.refHeaders(null)).toEqual({});
  });

  it("mints refs that are safe as an SES tag value", () => {
    // SES rejects a message outright if a tag value has anything outside
    // [A-Za-z0-9_-] — a plain base64 ref would break every send.
    for (let i = 0; i < 50; i += 1) {
      expect(receipts.newMessageRef()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe("SendGrid", () => {
  const events = [
    {
      event: "delivered",
      email: "adaeze@example.com",
      timestamp: 1754200000,
      sg_event_id: "sg-1",
      "smtp-id": "<abc@hub>",
      comms_ref: "ref123",
    },
    {
      event: "open",
      email: "adaeze@example.com",
      timestamp: 1754200600,
      sg_event_id: "sg-2",
      comms_ref: "ref123",
    },
    { event: "processed", sg_event_id: "sg-3", comms_ref: "ref123" },
    {
      event: "bounce",
      email: "adaeze@example.com",
      timestamp: 1754200900,
      sg_event_id: "sg-4",
      comms_ref: "ref123",
      reason: "550 5.1.1 unknown recipient",
    },
  ];

  it("maps a batched POST onto our ledger vocabulary", () => {
    const out = receipts.parse("sendgrid", events);
    expect(out.map((e) => e.status)).toEqual(["delivered", "opened", "bounced"]);
  });

  it("ignores in-flight noise rather than inventing a status", () => {
    expect(receipts.parse("sendgrid", [{ event: "processed" }])).toEqual([]);
    expect(receipts.parse("sendgrid", [{ event: "deferred" }])).toEqual([]);
  });

  it("carries the correlation ref, event id and bounce reason through", () => {
    const [delivered, , bounced] = receipts.parse("sendgrid", events);
    expect(delivered).toMatchObject({
      provider: "sendgrid",
      provider_event_id: "sg-1",
      message_ref: "ref123",
      provider_ref: "abc@hub", // angle brackets stripped
      recipient: "adaeze@example.com",
    });
    expect(delivered.event_at).toBe("2025-08-03T05:46:40.000Z");
    expect(bounced.error).toBe("550 5.1.1 unknown recipient");
  });

  it("cannot be verified without the key, and rejects a bad signature", () => {
    const body = Buffer.from("{}");
    expect(receipts.verify("sendgrid", body, {})).toBeNull();
    ENV.SENDGRID_WEBHOOK_PUBLIC_KEY = "not-a-real-key";
    expect(receipts.verify("sendgrid", body, {})).toBe(false); // headers missing
  });

  it("accepts a signature produced by SendGrid's own scheme", () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    ENV.SENDGRID_WEBHOOK_PUBLIC_KEY = publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
    const body = Buffer.from(JSON.stringify(events));
    const ts = "1754200000";
    const signature = crypto
      .createSign("sha256")
      .update(Buffer.concat([Buffer.from(ts), body]))
      .sign(privateKey)
      .toString("base64");
    expect(
      receipts.verify("sendgrid", body, {
        "x-twilio-email-event-webhook-signature": signature,
        "x-twilio-email-event-webhook-timestamp": ts,
      }),
    ).toBe(true);
    // Same signature over different bytes must fail.
    expect(
      receipts.verify("sendgrid", Buffer.from("[]"), {
        "x-twilio-email-event-webhook-signature": signature,
        "x-twilio-email-event-webhook-timestamp": ts,
      }),
    ).toBe(false);
  });
});

describe("Mailgun", () => {
  const delivered = {
    "event-data": {
      event: "delivered",
      id: "mg-1",
      timestamp: 1754200000.123,
      recipient: "adaeze@example.com",
      "user-variables": { comms_ref: "ref123" },
      message: { headers: { "message-id": "abc@hub" } },
    },
  };

  it("maps a delivered event", () => {
    const [e] = receipts.parse("mailgun", delivered);
    expect(e).toMatchObject({
      provider: "mailgun",
      provider_event_id: "mg-1",
      status: "delivered",
      message_ref: "ref123",
      provider_ref: "abc@hub",
      recipient: "adaeze@example.com",
    });
  });

  it("treats a PERMANENT failure as a bounce", () => {
    const [e] = receipts.parse("mailgun", {
      "event-data": {
        event: "failed",
        severity: "permanent",
        id: "mg-2",
        "delivery-status": { message: "mailbox does not exist" },
      },
    });
    expect(e).toMatchObject({ status: "bounced", error: "mailbox does not exist" });
  });

  it("reports nothing for a TEMPORARY failure — Mailgun will retry", () => {
    // Recording this as a bounce would tell staff to fix an address that is fine.
    expect(
      receipts.parse("mailgun", {
        "event-data": { event: "failed", severity: "temporary", id: "mg-3" },
      }),
    ).toEqual([]);
  });

  it("verifies the documented HMAC over timestamp+token", () => {
    ENV.MAILGUN_WEBHOOK_SIGNING_KEY = "key-secret";
    const timestamp = "1754200000";
    const token = "tok";
    const signature = crypto
      .createHmac("sha256", "key-secret")
      .update(`${timestamp}${token}`)
      .digest("hex");
    const payload = { signature: { timestamp, token, signature } };
    expect(receipts.verify("mailgun", Buffer.from("{}"), {}, payload)).toBe(true);
    payload.signature.signature = "0".repeat(64);
    expect(receipts.verify("mailgun", Buffer.from("{}"), {}, payload)).toBe(false);
  });
});

describe("Postmark", () => {
  it("maps Delivery / Open / Bounce / SpamComplaint", () => {
    const cases = [
      ["Delivery", "delivered"],
      ["Open", "opened"],
      ["Bounce", "bounced"],
      ["SpamComplaint", "complained"],
    ];
    for (const [RecordType, status] of cases) {
      const [e] = receipts.parse("postmark", {
        RecordType,
        MessageID: "pm-1",
        Recipient: "adaeze@example.com",
        Metadata: { comms_ref: "ref123" },
      });
      expect(e.status).toBe(status);
      // No per-event id from Postmark — message+type is unique per outcome.
      expect(e.provider_event_id).toBe(`pm-1:${RecordType}`);
      expect(e.message_ref).toBe("ref123");
    }
  });

  it("verifies the shared token Postmark is configured to send", () => {
    expect(receipts.verify("postmark", Buffer.from("{}"), {})).toBeNull();
    ENV.POSTMARK_WEBHOOK_SECRET = "s3cret-token";
    expect(receipts.verify("postmark", Buffer.from("{}"), {})).toBe(false);
    expect(
      receipts.verify("postmark", Buffer.from("{}"), {
        "x-postmark-webhook-token": "s3cret-token",
      }),
    ).toBe(true);
    expect(
      receipts.verify("postmark", Buffer.from("{}"), {
        "x-postmark-webhook-token": "wrong",
      }),
    ).toBe(false);
  });
});

describe("Amazon SES", () => {
  const snsWrap = (note) => ({
    Type: "Notification",
    TopicArn: "arn:aws:sns:eu-west-1:1:hub-email",
    Message: JSON.stringify(note),
  });

  it("unwraps the SNS envelope SES notifications arrive in", () => {
    const [e] = receipts.parse(
      "ses",
      snsWrap({
        eventType: "Delivery",
        mail: {
          messageId: "ses-1",
          timestamp: "2026-08-03T06:26:40.000Z",
          destination: ["adaeze@example.com"],
          tags: { comms_ref: ["ref123"] },
        },
      }),
    );
    expect(e).toMatchObject({
      provider: "ses",
      status: "delivered",
      message_ref: "ref123", // tag arrays flattened
      recipient: "adaeze@example.com",
      provider_event_id: "ses-1:Delivery",
    });
  });

  it("carries the SMTP diagnostic code on a bounce", () => {
    const [e] = receipts.parse(
      "ses",
      snsWrap({
        eventType: "Bounce",
        mail: { messageId: "ses-2", tags: {} },
        bounce: {
          bounceSubType: "General",
          bouncedRecipients: [{ diagnosticCode: "smtp; 550 5.1.1 no mailbox" }],
        },
      }),
    );
    expect(e).toMatchObject({
      status: "bounced",
      error: "smtp; 550 5.1.1 no mailbox",
    });
  });

  it("accepts only the configured topic ARN", () => {
    const body = Buffer.from("{}");
    expect(receipts.verify("ses", body, {}, {})).toBeNull();
    ENV.SES_SNS_TOPIC_ARN = "arn:aws:sns:eu-west-1:1:hub-email";
    expect(
      receipts.verify("ses", body, {}, { TopicArn: "arn:aws:sns:eu-west-1:1:hub-email" }),
    ).toBe(true);
    expect(
      receipts.verify("ses", body, {}, { TopicArn: "arn:aws:sns:eu-west-1:9:someone-else" }),
    ).toBe(false);
  });

  it("survives an unparseable SNS Message rather than throwing", () => {
    expect(
      receipts.parse("ses", { Type: "Notification", Message: "not json" }),
    ).toEqual([]);
  });
});

describe("Resend", () => {
  const event = {
    type: "email.delivered",
    created_at: "2026-08-03T06:26:40.000Z",
    data: {
      email_id: "re-1",
      to: ["adaeze@example.com"],
      headers: [{ name: "X-Entity-Ref-ID", value: "ref123" }],
    },
  };

  it("reads the correlation ref back out of the echoed headers", () => {
    const [e] = receipts.parse("resend", event, { "svix-id": "msg_1" });
    expect(e).toMatchObject({
      provider: "resend",
      status: "delivered",
      message_ref: "ref123",
      recipient: "adaeze@example.com",
      provider_event_id: "msg_1",
    });
  });

  it("ignores email.sent — we already recorded our own send", () => {
    expect(receipts.parse("resend", { ...event, type: "email.sent" }, {})).toEqual([]);
  });

  it("verifies the Svix signature and rejects a stale replay", () => {
    const secret = crypto.randomBytes(24).toString("base64");
    ENV.RESEND_WEBHOOK_SECRET = `whsec_${secret}`;
    const body = Buffer.from(JSON.stringify(event));
    const id = "msg_1";
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = crypto
      .createHmac("sha256", Buffer.from(secret, "base64"))
      .update(`${id}.${ts}.${body.toString("utf8")}`)
      .digest("base64");
    const headers = {
      "svix-id": id,
      "svix-timestamp": ts,
      "svix-signature": `v1,${sig}`,
    };
    expect(receipts.verify("resend", body, headers)).toBe(true);

    // A capture replayed an hour later must not be accepted.
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    expect(
      receipts.verify("resend", body, { ...headers, "svix-timestamp": old }),
    ).toBe(false);
  });
});

describe("provider registry", () => {
  it("refuses to verify an unknown provider", () => {
    expect(receipts.isProvider("mailchimp")).toBe(false);
    expect(receipts.verify("mailchimp", Buffer.from("{}"), {})).toBeNull();
    expect(receipts.parse("mailchimp", {})).toEqual([]);
  });

  it("reports which providers are actually configured", () => {
    expect(receipts.configuredProviders()).toEqual([]);
    ENV.RESEND_WEBHOOK_SECRET = "whsec_x";
    ENV.MAILGUN_WEBHOOK_SIGNING_KEY = "key";
    expect(receipts.configuredProviders().sort()).toEqual(["mailgun", "resend"]);
  });
});

describe("timestamp normalisation", () => {
  it("handles seconds, milliseconds and ISO alike", () => {
    expect(receipts.toIso(1754200000)).toBe("2025-08-03T05:46:40.000Z");
    expect(receipts.toIso(1754200000000)).toBe("2025-08-03T05:46:40.000Z");
    expect(receipts.toIso("2026-08-03T06:26:40.000Z")).toBe(
      "2026-08-03T06:26:40.000Z",
    );
  });

  it("returns null for junk instead of an Invalid Date", () => {
    expect(receipts.toIso(null)).toBeNull();
    expect(receipts.toIso("")).toBeNull();
    expect(receipts.toIso("not a date")).toBeNull();
  });
});
