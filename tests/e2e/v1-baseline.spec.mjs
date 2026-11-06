// Baseline of the current app. Replaced by full parity tests once the new UI reaches M5.
import { test, expect } from "@playwright/test";
import { watchPage } from "./helpers.mjs";

const TABS = ["dashboard", "guards", "register", "sheet", "advances", "clients", "invoices", "cash", "recurring", "banks", "settings"];

test("sample data shows the known figures and every page opens cleanly", async ({ page }) => {
  // v1 loads Google Fonts and has no favicon. Both go away in M2.
  const problems = watchPage(page, { allowHosts: ["googleapis.com", "gstatic.com"], ignore: [/favicon\.ico/] });
  await page.goto("/");
  await page.getByRole("button", { name: "Sample data" }).click();
  const kpis = page.locator("#dash-kpis");
  await expect(kpis).toContainText("₹8,34,481");
  await expect(kpis).toContainText("₹1,70,150");
  await expect(kpis).toContainText("₹49,771");
  for (const tab of TABS) {
    // A direct event: v1's sideways-scrolling phone menu moves under real taps, and M2 replaces it.
    await page.locator(`#nav button[data-tab="${tab}"]`).dispatchEvent("click");
    await expect(page.locator(`#tab-${tab}`)).toBeVisible();
  }
  expect(problems).toEqual([]);
});
