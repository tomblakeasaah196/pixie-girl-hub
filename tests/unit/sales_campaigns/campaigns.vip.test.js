"use strict";

/**
 * VIP rollup regression tests.
 *
 * Guards the "Compute VIP gifts" path: the lifetime-spend promotion check must
 * derive spend from the order `status` (there is NO `payment_status` column on
 * sales_orders). A stray `payment_status = 'paid'` predicate crashed the whole
 * grant with `column "payment_status" does not exist`, so the admin button
 * silently did nothing.
 */

const collectedSql = [];

jest.mock("../../../src/config/database", () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock("../../../src/modules/sales_campaigns/campaigns.repo", () => ({
  findById: jest.fn(),
}));

jest.mock("../../../src/modules/sales_campaigns/campaigns.events", () => ({
  emit: jest.fn(),
}));

jest.mock("../../../src/middleware/audit", () => ({
  audit: jest.fn().mockResolvedValue(undefined),
}));

const db = require("../../../src/config/database");
const repo = require("../../../src/modules/sales_campaigns/campaigns.repo");
const vip = require("../../../src/modules/sales_campaigns/campaigns.vip.service");

function fakeClient() {
  return {
    query: jest.fn(async (text) => {
      collectedSql.push(text);
      if (/SUM\(total_ngn\)[\s\S]*AS lifetime/.test(text)) {
        return { rows: [{ lifetime: "6000000" }] };
      }
      if (/INTO shared\.contact_tags/.test(text)) return { rows: [] };
      if (/INTO .*sales_campaign_vip_grants/.test(text)) {
        return {
          rows: [
            {
              grant_id: "g-1",
              praxis_gift_suggestion: "branded wig + handwritten letter",
              gift_task_id: null,
            },
          ],
        };
      }
      if (/INTO shared\.tasks/.test(text)) {
        return { rows: [{ task_id: "task-1" }] };
      }
      if (/UPDATE .*sales_campaign_vip_grants SET gift_task_id/.test(text)) {
        return { rows: [] };
      }
      return { rows: [] };
    }),
  };
}

describe("grantTopSpenders — lifetime spend derives from status, not payment_status", () => {
  beforeEach(() => {
    collectedSql.length = 0;
    jest.clearAllMocks();

    repo.findById.mockResolvedValue({
      campaign_id: "camp-1",
      name: "Black Friday",
      vip_top_n: 10,
      vip_lifetime_threshold_ngn: 3000000,
    });

    // listTopSpenders() runs on the module-level query()
    db.query.mockResolvedValue({
      rows: [
        {
          contact_id: "c-1",
          first_name: "Ada",
          last_name: "Obi",
          email: "ada@example.com",
          phone: "+2348000000000",
          total_spend_ngn: "6000000",
          orders_count: 3,
        },
      ],
    });

    // transaction(fn) simply invokes fn with a fake client
    db.transaction.mockImplementation(async (fn) => fn(fakeClient()));
  });

  test("never references payment_status; filters by order status", async () => {
    const result = await vip.grantTopSpenders({
      brand: "pixiegirl",
      user: { user_id: "u-1" },
      request_id: "req-1",
      campaign_id: "camp-1",
    });

    expect(result.granted).toBe(1);
    // Crossed the 3,000,000 lifetime threshold → promoted.
    expect(result.lifetime_promoted).toBe(1);

    const allSql = collectedSql.join("\n");
    expect(allSql).not.toMatch(/payment_status/);

    const lifetimeSql = collectedSql.find((s) =>
      /SUM\(total_ngn\)[\s\S]*AS lifetime/.test(s),
    );
    expect(lifetimeSql).toBeDefined();
    expect(lifetimeSql).toMatch(/status IN \('paid'/);
  });

  test("listTopSpenders campaign-spend query also filters by status", async () => {
    await vip.listTopSpenders({ brand: "pixiegirl", campaign_id: "camp-1" });
    const [sql] = db.query.mock.calls[0];
    expect(sql).not.toMatch(/payment_status/);
    expect(sql).toMatch(/so\.status IN \('paid'/);
  });
});
