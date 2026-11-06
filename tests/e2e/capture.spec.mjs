// Screens that only appear after an interaction, captured for milestone reviews. Runs with the other flows.
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { sampleV2, seed } from "./helpers.mjs";

const SHOTS = "screenshots/current";
mkdirSync(SHOTS, { recursive: true });

test("form and menu screens render cleanly", async ({ page }, info) => {
  await seed(page, { data: sampleV2(), theme: "light" });
  await page.goto("/index.html#/styleguide");
  await page.locator("[data-demo-form]").click();
  await page.locator("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.locator("dialog").getByText("Name is required")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-form-errors.png` });
});
