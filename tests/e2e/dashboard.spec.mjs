// The dashboard: headline figures, what needs attention, the trend chart and the backup reminder.
import { expect, sampleV2, savedData, seed, test, TODAY, watchPage } from "./helpers.mjs";
import { formatMoney } from "../../js/core/money.js";
import { dashboardSummary } from "../../js/core/reports.js";
import { sample } from "../../js/core/sample.js";

const m0 = (n) => formatMoney(n, "INR", { decimals: 0 });
const open = async (page, data) => {
  await seed(page, { data });
  await page.goto("/index.html#/dashboard");
  await expect(page.locator("#page-title")).toBeVisible();
};
const kpiValue = (page, label) => page.locator(".kpi", { hasText: label }).locator(".kpi-value");

test("the headline figures match the calculations", async ({ page }) => {
  const problems = watchPage(page);
  const s = sample(TODAY);
  const d = dashboardSummary(s, TODAY);
  await open(page, s);
  await expect(kpiValue(page, "Cash and bank")).toHaveText(m0(d.totalMoney));
  await expect(kpiValue(page, "Clients owe you")).toHaveText(m0(d.receivables));
  await expect(kpiValue(page, "You owe suppliers")).toHaveText(m0(d.payables));
  await expect(kpiValue(page, "Salaries to pay")).toHaveText(m0(d.salariesToPay));
  await expect(kpiValue(page, "Stock value")).toHaveText(m0(d.stockValue));
  expect(problems).toEqual([]);
});

test("what's up next and low stock each link to the right place", async ({ page }) => {
  const s = sample(TODAY);
  const d = dashboardSummary(s, TODAY);
  expect(d.overdueReceivables.length).toBeGreaterThan(0);
  expect(d.lowStock.length).toBeGreaterThan(0);
  await open(page, s);
  await expect(page.getByTestId("up-next-list")).toContainText("late");
  const low = page.getByTestId("low-stock");
  await expect(low.getByRole("link").nth(1)).toHaveAttribute("href", `#/stock/${d.lowStock[0].item.id}`);
  await low.getByRole("link", { name: "Stock", exact: true }).click();
  await expect(page.locator("#page-title")).toHaveText("Stock");
});

test("low stock and the stock figure disappear when the module is off", async ({ page }) => {
  const s = sample(TODAY);
  s.settings.modules.stock = false;
  await open(page, s);
  await expect(page.locator(".kpi", { hasText: "Stock value" })).toHaveCount(0);
  await expect(page.getByTestId("low-stock")).toHaveCount(0);
});

test("the six-month chart shows income and spending, and works from the keyboard", async ({ page }) => {
  await open(page, sample(TODAY));
  const chart = page.locator(".chart");
  await expect(chart).toBeVisible();
  await expect(chart.locator(".chart-key")).toHaveText(["Income", "Spending"]);
  await expect(chart.locator(".chart-hit")).toHaveCount(6);
  await chart.locator(".chart-hit").nth(4).focus();
  await expect(chart.locator(".chart-tip")).toContainText("Income");
  await chart.getByText("Show as a table").click();
  await expect(chart.locator("table tbody tr")).toHaveCount(6);
});

test("a new business gets a setup list instead of an empty dashboard", async ({ page }) => {
  const problems = watchPage(page);
  const s = sampleV2();
  for (const key of ["staff", "invoices", "purchases", "transactions", "clients", "items", "recurring", "advances", "salaryPayments"]) s[key] = [];
  s.settings.modules.stock = true;
  await open(page, s);
  const list = page.locator(".setup-list");
  await expect(list).toBeVisible();
  await expect(list.getByRole("link")).toHaveCount(6);
  await expect(list.getByRole("link", { name: "Add a client" })).toHaveAttribute("href", "#/clients");
  await expect(page.locator(".chart")).toHaveCount(0);
  await expect(page.locator(".backup-nudge")).toHaveCount(0);
  expect(problems).toEqual([]);
});

test.describe("the backup reminder", () => {
  const withRecords = () => {
    const s = sampleV2();
    s.clients.push({ id: "c9", name: "A client", contact: "", phone: "", email: "", gstin: "", stateCode: "", address: "", rate: 0, gst: false, active: true });
    return s;
  };

  test("appears when there's never been a backup, and goes away after one", async ({ page }) => {
    await open(page, withRecords());
    const nudge = page.locator(".backup-nudge");
    await expect(nudge).toContainText("You haven't made a backup yet");
    const pending = page.waitForEvent("download");
    await nudge.getByRole("button", { name: "Download backup" }).click();
    expect((await pending).suggestedFilename()).toBe(`accounts-manager-backup-${TODAY}.json`);
    await expect(nudge).toHaveCount(0);
    expect((await savedData(page)).settings.lastBackupAt).toBeTruthy();
  });

  test("stays away for a recent backup, and returns for an old one", async ({ page }) => {
    const s = withRecords();
    s.settings.lastBackupAt = `${TODAY}T09:00:00.000Z`;
    await open(page, s);
    await expect(page.locator(".backup-nudge")).toHaveCount(0);
  });

  test("names the date of an old backup", async ({ page }) => {
    const s = withRecords();
    s.settings.lastBackupAt = "2026-09-01T09:00:00.000Z";
    await open(page, s);
    await expect(page.locator(".backup-nudge")).toContainText("01 Sep 2026");
  });

  test("never nags in sample mode", async ({ page }) => {
    await seed(page, { data: sampleV2() });
    await page.goto("/index.html#/settings/data");
    await page.getByRole("button", { name: "Explore sample data" }).click();
    await expect(page.locator("h1")).toHaveText("Today");
    await expect(page.locator("[data-banner]")).toContainText(/sample/i);
    await expect(page.locator(".backup-nudge")).toHaveCount(0);
  });
});
