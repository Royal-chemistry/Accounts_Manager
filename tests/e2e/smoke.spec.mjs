// A short trip through the main flow. CI also runs this in Firefox and Safari's engine.
import { test, expect, savedData, watchPage } from "./helpers.mjs";

test("a new business bills a client, gets paid, and sees it in the reports", async ({ page }) => {
  const problems = watchPage(page);
  await page.addInitScript(() => { window.print = () => { window.__printed = true; }; });

  await page.goto("/index.html");
  await page.getByLabel(/^Business name/).fill("Smoke Test Traders");
  await page.getByLabel(/^Type of business/).selectOption("trading");
  await page.getByRole("button", { name: "Get started" }).click();
  await expect(page.locator("h1")).toHaveText("Today");

  await page.goto("/index.html#/clients");
  await page.getByRole("button", { name: "Add client" }).first().click();
  let d = page.locator("dialog");
  await d.getByLabel(/^Client name/).fill("Smoke Client");
  await d.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("tbody tr", { hasText: "Smoke Client" })).toBeVisible();

  await page.goto("/index.html#/invoices");
  await page.getByRole("button", { name: "New invoice" }).first().click();
  d = page.locator("dialog");
  await d.getByLabel("Description").first().fill("Goods");
  await d.getByLabel("Rate", { exact: true }).first().fill("1000");
  await d.getByLabel("GST percent").first().fill("18");
  await d.getByRole("button", { name: "Create invoice" }).click();
  const row = page.locator("tbody tr", { hasText: "Smoke Client" });
  await expect(row).toContainText("₹1,180");

  await row.getByRole("button", { name: "Receive" }).click();
  d = page.locator("dialog");
  await d.getByLabel(/^Amount received/).fill("1180");
  await d.getByRole("button", { name: "Save payment" }).click();
  await expect(row).toContainText("Paid");

  await page.goto("/index.html#/reports/receivable");
  await expect(page.getByText("Nothing outstanding")).toBeVisible();
  await page.goto("/index.html#/reports/gst");
  await expect(page.locator(".kpi", { hasText: "GST collected" }).locator(".kpi-value")).toContainText("₹");
  await page.getByRole("button", { name: "Print or save as PDF" }).click();
  expect(await page.evaluate(() => window.__printed)).toBe(true);

  // Dates, the dark theme and a safe delete: the parts browsers tend to treat differently.
  await page.goto("/index.html#/cashbook");
  await page.getByRole("button", { name: "Colour theme" }).click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.goto("/index.html#/invoices");
  await row.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.locator("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(row).toBeVisible();

  await page.reload();
  await expect(row).toContainText("Paid");
  expect((await savedData(page)).invoices).toHaveLength(1);
  expect(problems).toEqual([]);
});
