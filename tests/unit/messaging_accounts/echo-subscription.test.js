"use strict";

/**
 * The Instagram echo-subscription watchdog. The `message_echoes` webhook
 * field is the ONLY signal Meta sends when a staffer replies from the
 * Instagram app; it is subscribed on the professional account itself and
 * has repeatedly drifted off (re-subscribes REPLACE the field list).
 * These tests pin the self-heal contract:
 *
 *   - a complete subscription is left untouched (no POST)
 *   - a drifted one is repaired with the UNION of fields, audited, and
 *     the CEO is notified (once per day, not per hourly tick)
 *   - one account's failure never blocks the other brand's check
 */

jest.mock(
  "../../../src/modules/messaging_accounts/messaging-accounts.repo",
  () => ({
    listActiveByPlatform: jest.fn(),
  }),
);
jest.mock("../../../src/services/encryption.service", () => ({
  encrypt: jest.fn((s) => `enc:${s}`),
  decrypt: jest.fn((s) => s.replace(/^enc:/, "")),
}));
jest.mock("../../../src/middleware/audit", () => ({
  audit: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../../src/config/env", () => ({
  config: { META_GRAPH_VERSION: "v21.0" },
}));
jest.mock("axios", () => ({
  get: jest.fn(),
  post: jest.fn(),
}));
jest.mock("../../../src/modules/smartcomm/smartcomm.repo", () => ({}));
jest.mock("../../../src/config/database", () => ({
  query: jest.fn(),
}));
jest.mock("../../../src/services/notifications.service", () => ({
  notify: jest.fn().mockResolvedValue(null),
}));

const repo = require("../../../src/modules/messaging_accounts/messaging-accounts.repo");
const axios = require("axios");
const { query } = require("../../../src/config/database");
const notifications = require("../../../src/services/notifications.service");
const { audit } = require("../../../src/middleware/audit");
const service = require("../../../src/modules/messaging_accounts/messaging-accounts.service");

const FULL_FIELDS = [
  "messages",
  "message_echoes",
  "message_reactions",
  "messaging_seen",
];

function subscribedAppsResponse(fields) {
  return { data: { data: [{ subscribed_fields: fields }] } };
}

// CEO lookup → found; recent-notification dedup → none.
function mockCeoQueries() {
  query.mockImplementation((sql) => {
    if (/is_ceo/.test(sql)) {
      return Promise.resolve({ rows: [{ user_id: "ceo-1" }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

describe("ensureInstagramEchoSubscriptions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCeoQueries();
  });

  test("a complete subscription is left untouched — no POST, no notification", async () => {
    repo.listActiveByPlatform.mockResolvedValue([
      {
        account_id: "acc-1",
        business: "faitlynhair",
        access_token_enc: "enc:IGAA-flh",
      },
    ]);
    axios.get.mockResolvedValue(subscribedAppsResponse(FULL_FIELDS));

    const summary = await service.ensureInstagramEchoSubscriptions();

    expect(summary).toMatchObject({ checked: 1, ok: 1, healed: 0, failed: 0 });
    expect(axios.post).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  test("a drifted subscription is re-subscribed with the UNION, audited, and the CEO is told", async () => {
    repo.listActiveByPlatform.mockResolvedValue([
      {
        account_id: "acc-1",
        business: "faitlynhair",
        access_token_enc: "enc:IGAA-flh",
      },
    ]);
    // Drifted list keeps an extra field someone added — the repair must not
    // drop it (subscribed_apps REPLACES, never appends).
    let calls = 0;
    axios.get.mockImplementation(() => {
      calls += 1;
      return Promise.resolve(
        subscribedAppsResponse(
          calls === 1
            ? ["messages", "messaging_postbacks"]
            : [...FULL_FIELDS, "messaging_postbacks"],
        ),
      );
    });
    axios.post.mockResolvedValue({ data: { success: true } });

    const summary = await service.ensureInstagramEchoSubscriptions();

    expect(summary).toMatchObject({ checked: 1, healed: 1, failed: 0 });
    const [url, , opts] = axios.post.mock.calls[0];
    expect(url).toContain("/me/subscribed_apps");
    const sent = opts.params.subscribed_fields.split(",");
    expect(sent).toEqual(
      expect.arrayContaining([...FULL_FIELDS, "messaging_postbacks"]),
    );
    expect(opts.headers.Authorization).toBe("Bearer IGAA-flh");
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action_key: "messaging_accounts.echo_subscription_healed",
        business: "faitlynhair",
      }),
    );
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "ceo-1",
        business: "faitlynhair",
        type: "ig_echo_sync_healed",
        priority: "high",
      }),
    );
  });

  test("the CEO is notified at most once per day per brand", async () => {
    repo.listActiveByPlatform.mockResolvedValue([
      {
        account_id: "acc-1",
        business: "faitlynhair",
        access_token_enc: "enc:IGAA-flh",
      },
    ]);
    let calls = 0;
    axios.get.mockImplementation(() => {
      calls += 1;
      return Promise.resolve(
        subscribedAppsResponse(calls === 1 ? ["messages"] : FULL_FIELDS),
      );
    });
    axios.post.mockResolvedValue({ data: { success: true } });
    // Dedup query finds a notification from earlier today.
    query.mockImplementation((sql) => {
      if (/is_ceo/.test(sql)) {
        return Promise.resolve({ rows: [{ user_id: "ceo-1" }] });
      }
      return Promise.resolve({ rows: [{ exists: 1 }] });
    });

    const summary = await service.ensureInstagramEchoSubscriptions();

    expect(summary.healed).toBe(1); // still healed…
    expect(notifications.notify).not.toHaveBeenCalled(); // …but no repeat ping
  });

  test("one account's failure never blocks the other brand — and raises the broken alert", async () => {
    repo.listActiveByPlatform.mockResolvedValue([
      {
        account_id: "acc-bad",
        business: "pixiegirl",
        access_token_enc: "enc:IGAA-revoked",
      },
      {
        account_id: "acc-good",
        business: "faitlynhair",
        access_token_enc: "enc:IGAA-flh",
      },
    ]);
    axios.get
      .mockRejectedValueOnce(
        Object.assign(new Error("Request failed with status code 400"), {
          response: {
            status: 400,
            data: { error: { message: "Invalid OAuth access token", code: 190 } },
          },
        }),
      )
      .mockResolvedValueOnce(subscribedAppsResponse(FULL_FIELDS));

    const summary = await service.ensureInstagramEchoSubscriptions();

    expect(summary).toMatchObject({ checked: 2, ok: 1, failed: 1, healed: 0 });
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        business: "pixiegirl",
        type: "ig_echo_sync_broken",
        priority: "urgent",
        body: expect.stringContaining("Invalid OAuth access token"),
      }),
    );
  });
});
