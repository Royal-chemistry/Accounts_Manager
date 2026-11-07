// Screens that only appear after an interaction, or that need particular data, captured for milestone reviews.
import { mkdirSync } from "node:fs";
import { test, expect, fixture, sampleV2, seed, TODAY } from "./helpers.mjs";
import { sample } from "../../js/core/sample.js";

const SHOTS = "screenshots/current";
mkdirSync(SHOTS, { recursive: true });

test("form errors", async ({ page }, info) => {
  await seed(page, { data: sampleV2(), theme: "light" });
  await page.goto("/index.html#/styleguide");
  await page.locator("[data-demo-form]").click();
  await page.locator("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.locator("dialog").getByText("Name is required")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-form-errors.png` });
});

test("welcome and upgrade screens", async ({ page }, info) => {
  await seed(page, { theme: "light" });
  await page.goto("/index.html");
  await expect(page.locator("h1")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-welcome.png`, fullPage: true });
});

test("upgrade screen", async ({ page }, info) => {
  await seed(page, { v1: fixture("v1-sample"), theme: "light" });
  await page.goto("/index.html");
  await expect(page.locator("h1")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-upgrade.png`, fullPage: true });
});

test("pay sheet and payslip", async ({ page }, info) => {
  await page.addInitScript(() => { window.print = () => {}; });
  await seed(page, { data: sampleV2(), theme: "light" });
  await page.goto("/index.html#/attendance/pay");
  await expect(page.locator(".pay-sheet")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-pay-sheet.png`, fullPage: true });
  await page.goto("/index.html#/salary");
  await page.getByRole("button", { name: "Print payslips" }).click();
  await page.emulateMedia({ media: "print" });
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-payslip.png` });
  await page.emulateMedia({ media: "screen" });
});

test("invoice form and printed invoice", async ({ page }, info) => {
  await page.addInitScript(() => { window.print = () => {}; });
  const s = sampleV2();
  s.profile.stateCode = "32";
  await seed(page, { data: s, theme: "light" });
  await page.goto("/index.html#/invoices");
  await page.getByRole("button", { name: "New invoice" }).first().click();
  const d = page.locator("dialog");
  await d.getByLabel("Description").first().fill("Packing material");
  await d.getByLabel("Quantity").first().fill("400");
  await d.getByLabel("Rate", { exact: true }).first().fill("95");
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-invoice-form.png` });
  await d.getByRole("button", { name: "Cancel" }).click();
  await d.getByRole("button", { name: "Discard changes" }).click();
  await page.locator("tbody tr", { hasText: "ST-003" }).getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Print" }).click();
  await page.emulateMedia({ media: "print" });
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-invoice-print.png` });
  await page.emulateMedia({ media: "screen" });
});

test("delete warning", async ({ page }, info) => {
  await seed(page, { data: sampleV2(), theme: "light" });
  await page.goto("/index.html#/invoices");
  await page.locator("tbody tr", { hasText: "ST-002" }).getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.locator("dialog")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-delete-warning.png` });
});

for (const [name, path] of [["invoices", "invoices"], ["cashbook", "cashbook"], ["banks", "banks"], ["recurring", "recurring"]]) {
  test(`list page ${name}`, async ({ page }, info) => {
    await seed(page, { data: sampleV2(), theme: "light" });
    await page.goto(`/index.html#/${path}`);
    await expect(page.locator("h1")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-${name}.png`, fullPage: true });
  });
}

test("suppliers, purchases and settling up", async ({ page }, info) => {
  const shot = (name, opts = {}) => page.screenshot({ path: `${SHOTS}/${info.project.name}-${name}.png`, ...opts });
  await seed(page, { data: sample(TODAY), theme: "light" });
  await page.goto("/index.html#/suppliers");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await shot("suppliers", { fullPage: true });
  await page.locator("tbody tr", { hasText: "City Cleaning Supplies" }).getByRole("button", { name: "Pay supplier" }).click();
  const d = page.locator("dialog");
  await expect(d.locator("[data-alloc]")).toHaveCount(2);
  await shot("settle");
  await d.getByRole("button", { name: "Cancel" }).click();
  await page.goto("/index.html#/purchases");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await shot("purchases", { fullPage: true });
  await page.getByRole("button", { name: "New purchase" }).first().click();
  await expect(d).toContainText("New purchase");
  await shot("purchase-form");
});

test("stock", async ({ page }, info) => {
  const shot = (name, opts = {}) => page.screenshot({ path: `${SHOTS}/${info.project.name}-${name}.png`, ...opts });
  await seed(page, { data: sample(TODAY), theme: "light" });
  await page.goto("/index.html#/stock");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await shot("stock", { fullPage: true });
  await page.goto("/index.html#/stock/item-5");
  await expect(page.locator("h1")).toHaveText("Delivery bags (bundle)");
  await shot("stock-item", { fullPage: true });
  await page.getByRole("button", { name: "Stock in" }).click();
  await expect(page.locator("dialog")).toBeVisible();
  await shot("stock-in");
  await page.locator("dialog").getByRole("button", { name: "Cancel" }).click();
  await page.goto("/index.html#/dashboard");
  await expect(page.getByTestId("low-stock")).toBeVisible();
  await shot("dashboard-low-stock", { fullPage: true });
});

for (const tab of ["payroll", "categories", "data"]) {
  test(`settings ${tab}`, async ({ page }, info) => {
    await seed(page, { data: sampleV2(), theme: "light" });
    await page.goto(`/index.html#/settings/${tab}`);
    await expect(page.locator("h1")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-settings-${tab}.png`, fullPage: true });
  });
}
