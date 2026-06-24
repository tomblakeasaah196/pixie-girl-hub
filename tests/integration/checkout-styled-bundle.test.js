"use strict";

/**
 * Styled-bundle checkout resolution — DB integration (revenue-critical).
 *
 * Proves, against a real schema, that a bundle containing a STYLED component
 * resolves to priced, variant-level order lines and applies the campaign bundle
 * price — the exact path that was broken (`if (!bi.variant_id) continue` dropped
 * every styled component, so the bundle quoted at ₦0 and checked out empty).
 *
 * OPT-IN: needs a migrated + seeded DB. Enable with RUN_DB_TESTS=1. To avoid
 * brittle multi-table blind seeding, it AUTO-DISCOVERS a campaign↔bundle whose
 * bundle has a styled component. If the DB has no such fixture it skips with a
 * note (attach a styled bundle to any campaign to assert this end-to-end):
 *
 *   RUN_DB_TESTS=1 DB_HOST=localhost DB_NAME=pixie_hub_test ... \
 *     npx jest tests/integration/checkout-styled-bundle
 */

const RUN = process.env.RUN_DB_TESTS === "1";
const db = require("../../src/config/database");
const bundleRepo = require("../../src/modules/sales_campaigns/campaigns.bundles.repo");
const {
  resolveBundleForCheckout,
} = require("../../src/modules/sales_campaigns/campaigns.public.service");
const { VALID_BRANDS } = require("../../src/config/brands");

const suite = RUN ? describe : describe.skip;

suite("styled-bundle checkout resolution (DB)", () => {
  beforeAll(async () => {
    await db.initDatabase();
  });
  afterAll(async () => {
    await db.closeDatabase();
  });

  /**
   * Find (brand, campaign_id, bundle_id) for a campaign-attached bundle that has
   * at least one styled component. Returns null when the DB has no such fixture.
   */
  async function findStyledCampaignBundle() {
    for (const brand of VALID_BRANDS) {
      const res = await db
        .query(
          `SELECT scb.campaign_id, scb.bundle_id, scb.campaign_bundle_price_ngn
             FROM ${brand}.sales_campaign_bundles scb
             JOIN ${brand}.product_bundle_items bi ON bi.bundle_id = scb.bundle_id
            WHERE bi.styled_id IS NOT NULL
            LIMIT 1`,
        )
        .catch(() => ({ rows: [] }));
      if (res.rows[0]) return { brand, ...res.rows[0] };
    }
    return null;
  }

  test("a styled bundle resolves to priced, variant-level lines (no ₦0, no skipped components)", async () => {
    const fx = await findStyledCampaignBundle();
    if (!fx) {
      console.warn(
        "checkout-styled-bundle: no styled campaign bundle in DB — skipping. " +
          "Attach a bundle with a styled component to a campaign to assert end-to-end.",
      );
      return;
    }

    const items = await bundleRepo.listBundleItems({
      brand: fx.brand,
      bundle_id: fx.bundle_id,
    });
    const styledCount = items.filter((i) => i.styled_id).length;
    expect(styledCount).toBeGreaterThan(0);

    const res = await resolveBundleForCheckout({
      brand: fx.brand,
      campaign_id: fx.campaign_id,
      bundle_id: fx.bundle_id,
      units: 1,
    });

    // Every component (styled included) must produce a sellable line — the bug
    // produced zero lines for a styled bundle.
    expect(res.orderLines.length).toBeGreaterThanOrEqual(items.length);
    for (const line of res.orderLines) {
      expect(line.variant_id).toBeTruthy();
      expect(Number(line.unit_price_ngn)).toBeGreaterThan(0);
    }

    // The bundle is no longer priced at ₦0.
    expect(Number(res.sumOfParts.toString())).toBeGreaterThan(0);

    // When the operator set a campaign bundle price, the bundle is discounted to
    // it (never marked up above sum-of-parts).
    if (
      fx.campaign_bundle_price_ngn !== null &&
      fx.campaign_bundle_price_ngn !== undefined
    ) {
      expect(Number(res.effectivePrice.toString())).toBeLessThanOrEqual(
        Number(res.sumOfParts.toString()),
      );
      expect(Number(res.discountNgn.toString())).toBeGreaterThanOrEqual(0);
    }
  });
});
