// Every page, detail page, tab and form, at every width, in both themes. Fails on console errors, crashes,
// failed or third-party requests, sideways scrolling, or anything axe finds. Saves screenshots for review.
import { mkdirSync } from "node:fs";
import { test, expect, ALL_PAGES, expectAccessible, expectNoHorizontalScroll, seed, TODAY, watchPage } from "./helpers.mjs";
import { moveToBin } from "../../js/core/bin.js";
import { sample } from "../../js/core/sample.js";
import { blank } from "../../js/core/schema.js";

const WIDTHS = [375, 768, 1024, 1440];
const THEMES = ["light", "dark"];
const SHOTS = "screenshots/current";
mkdirSync(SHOTS, { recursive: true });

/** The sample business, with something in the Recycle Bin. */
function richState() {
  const s = sample(TODAY);
  return moveToBin(s, "advance", s.advances[0].id, { now: new Date(`${TODAY}T10:00:00Z`) }).state;
}

function routes(s) {
  return [
    ...ALL_PAGES,
    `clients/${s.clients[0].id}`, `invoices/${s.invoices[0].id}`, `suppliers/${s.suppliers[0].id}`, `purchases/${s.purchases[0].id}`,
    "banks/loans", "banks/activity", `banks/${s.accounts[0].id}`, `staff/${s.staff[0].id}`, "attendance/pay",
    "stock/movements", `stock/${s.items[0].id}`,
    "reports/cash", "reports/receivable", "reports/payable", "reports/gst", "reports/stock", "reports/staff",
    "settings/payroll", "settings/invoices", "settings/categories", "settings/modules", "settings/data",
  ];
}

const check = async (page, label, shot) => {
  await page.evaluate(() => document.fonts.ready);
  if (shot) await page.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: true });
  await expectNoHorizontalScroll(page, label);
  await expectAccessible(page, label);
};

const phone = (width) => (width === 375 ? { hasTouch: true, isMobile: true } : {});

for (const width of WIDTHS) {
  for (const theme of THEMES) {
    test.describe(`${width}px ${theme}`, () => {
      test.use({ viewport: { width, height: 900 }, ...phone(width) });

      test(`every page and tab passes at ${width}px in ${theme}`, async ({ page }) => {
        test.setTimeout(300_000);
        const problems = watchPage(page);
        const state = richState();
        await seed(page, { data: state, theme });
        for (const route of routes(state)) {
          await page.goto(`/index.html#/${route}`);
          await expect(page.locator("#page-title")).toBeVisible();
          await check(page, `${route} at ${width}px in ${theme}`, `${width}-${theme}-${route.replaceAll("/", "-")}`);
        }
        expect(problems).toEqual([]);
      });
    });
  }
}

// The widest and narrowest are enough for these: forms don't change much in between.
for (const width of [375, 1440]) {
  for (const theme of THEMES) {
    test.describe(`${width}px ${theme}, forms and empty pages`, () => {
      test.use({ viewport: { width, height: 900 }, ...phone(width) });

      test(`every "add" form passes at ${width}px in ${theme}`, async ({ page }) => {
        test.setTimeout(180_000);
        const problems = watchPage(page);
        await seed(page, { data: richState(), theme });
        for (const route of ["invoices", "purchases", "clients", "suppliers", "stock", "staff", "advances", "recurring", "banks", "cashbook"]) {
          await page.goto(`/index.html#/${route}`);
          await page.locator("[data-add]").first().click();
          const dialog = page.locator("dialog");
          await expect(dialog).toBeVisible();
          await check(page, `the ${route} form at ${width}px in ${theme}`);
          await dialog.getByRole("button", { name: "Cancel" }).click();
          await expect(dialog).toBeHidden();
        }
        expect(problems).toEqual([]);
      });

      test(`every page passes with nothing in it at ${width}px in ${theme}`, async ({ page }) => {
        test.setTimeout(180_000);
        const problems = watchPage(page);
        const state = blank(TODAY);
        state.profile = { ...state.profile, onboarded: true, name: "New Business" };
        state.settings.modules.stock = true;
        await seed(page, { data: state, theme });
        for (const route of ALL_PAGES) {
          await page.goto(`/index.html#/${route}`);
          await expect(page.locator("#page-title")).toBeVisible();
          await check(page, `empty ${route} at ${width}px in ${theme}`, `${width}-${theme}-empty-${route}`);
        }
        expect(problems).toEqual([]);
      });
    });
  }
}

// A 1440 by 900 screen at 200% browser zoom leaves this much room, and WCAG requires pages to keep working there.
test.describe("at 200% zoom", () => {
  test.use({ viewport: { width: 720, height: 450 } });

  test("pages still work and nothing is cut off", async ({ page }) => {
    test.setTimeout(120_000);
    await seed(page, { data: richState(), theme: "light" });
    for (const route of ["dashboard", "invoices", "reports/profit", "salary", "attendance", "settings"]) {
      await page.goto(`/index.html#/${route}`);
      await expect(page.locator("#page-title")).toBeVisible();
      await check(page, `${route} at 200% zoom`, `zoom200-${route.replaceAll("/", "-")}`);
    }
    await page.goto("/index.html#/invoices");
    await page.locator("[data-add]").first().click();
    const save = page.locator("dialog").getByRole("button", { name: "Create invoice" });
    // A short window has to scroll the form, so saving must still be possible.
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeInViewport();
    await page.screenshot({ path: `${SHOTS}/zoom200-invoice-form.png` });
  });
});
