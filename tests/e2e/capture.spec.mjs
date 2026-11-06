// Screens that only appear after an interaction, or that need particular data, captured for milestone reviews.
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fixture, sampleV2, seed } from "./helpers.mjs";

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

for (const tab of ["payroll", "categories", "data"]) {
  test(`settings ${tab}`, async ({ page }, info) => {
    await seed(page, { data: sampleV2(), theme: "light" });
    await page.goto(`/index.html#/settings/${tab}`);
    await expect(page.locator("h1")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-settings-${tab}.png`, fullPage: true });
  });
}
