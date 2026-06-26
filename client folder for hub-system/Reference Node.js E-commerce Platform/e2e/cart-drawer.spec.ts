import { test, expect, type Page } from "@playwright/test";

/**
 * In-drawer checkout — end-to-end UI flow.
 *
 * Covers: opening the bag from a product page, stepping through bag → details
 * → review, recipient validation/formatting, fallback messaging when the
 * Contact Picker API isn't available (always true on desktop Chromium), and
 * the bulk-savings / near-free-shipping links that bounce shoppers back to the
 * shop.
 */

test.describe("Cart drawer checkout", () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      try { window.localStorage.clear(); } catch {}
    });
  });

  async function addOneToBag(page: Page) {
    await page.goto("/shop");
    // First product card on the shop grid.
    await page.locator("a[href^='/product/']").first().click();
    await page.waitForURL(/\/product\//);
    await page.getByRole("button", { name: /add to bag/i }).click();
    // Drawer auto-opens after add.
    await expect(page.getByRole("heading", { name: /your bag/i })).toBeVisible();
  }

  test("walks through bag → details → review", async ({ page }) => {
    await addOneToBag(page);

    await page.getByTestId("drawer-continue").click();
    await expect(page.getByText(/fulfillment/i)).toBeVisible();

    // Manual recipient entry.
    await page.getByTestId("recipient-name").fill("Faitlyn Test");
    await page.getByTestId("recipient-phone").fill("+234 802 555 0140");

    await page.getByTestId("drawer-review").click();
    await expect(page.getByRole("heading", { name: /review & confirm/i })).toBeVisible();
  });

  test("formats recipient name and phone, strips invalid characters", async ({ page }) => {
    await addOneToBag(page);
    await page.getByTestId("drawer-continue").click();

    const name = page.getByTestId("recipient-name");
    await name.fill("Faitlyn 99 !!");
    await expect(name).toHaveValue("Faitlyn  "); // digits + bang stripped

    const phone = page.getByTestId("recipient-phone");
    await phone.fill("call me ASAP +234 802");
    // Letters dropped; +/digits/spaces kept.
    await expect(phone).toHaveValue("   +234 802");
  });

  test("shows fallback copy when Contact Picker API isn't available", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "Desktop chromium has no contacts API — exactly what we want to assert.");
    await addOneToBag(page);
    await page.getByTestId("drawer-continue").click();
    await expect(page.getByText(/contact picker not available/i)).toBeVisible();
    // The "Ship to myself" affordance always renders, picker button does not.
    await expect(page.getByRole("button", { name: /ship to myself/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /pick from contacts/i })).toHaveCount(0);
  });

  test("bulk-savings prompt is a link back to the shop", async ({ page }) => {
    await addOneToBag(page);
    const link = page.getByTestId("bulk-savings-link");
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/shop/);
  });
});
