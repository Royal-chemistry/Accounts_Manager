// Reports: every tab, the period picker, the basis switch, CSV against the screen, and real print output.
import { readFileSync } from "node:fs";
import { expect, sampleV2, seed, test, TODAY, watchPage } from "./helpers.mjs";
import { periodPresets } from "../../js/core/dates.js";
import { formatMoney } from "../../js/core/money.js";
import { ageing, cashFlow, gstSummary, profitLoss, staffPaySummary, stockReport } from "../../js/core/reports.js";
import { sample } from "../../js/core/sample.js";

const data = () => sample(TODAY);
const presets = periodPresets(TODAY, 4);
const range = (id) => { const p = presets.find((x) => x.id === id); return { from: p.from, to: p.to }; };
const LAST_MONTH = range("last-month");
const m0 = (n) => formatMoney(n, "INR", { decimals: 0 });

const open = async (page, path, state = data()) => {
  await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  await seed(page, { data: state });
  await page.goto(`/index.html#/${path}`);
  await expect(page.locator("#page-title")).toBeVisible();
};
const kpiValue = (page, label) => page.locator(".kpi", { hasText: label }).locator(".kpi-value");
const parseCSV = (text) => text.replace(/^﻿/, "").trim().split(/\r?\n/).map((l) => l.split(",").map((c) => c.replace(/^"|"$/g, "")));
const grabCSV = async (page) => {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV" }).click();
  const d = await pending;
  return { file: d.suggestedFilename(), rows: parseCSV(readFileSync(await d.path(), "utf8")) };
};
const rowOf = (rows, label) => rows.find((r) => r[0] === label);

test.describe("every report", () => {
  for (const [tab, heading] of [["profit", "Net profit"], ["cash", "Closing balance"], ["receivable", "Total owed to you"], ["payable", "Total you owe"], ["gst", "GST collected"], ["stock", "Stock value today"], ["staff", "Gross pay"]]) {
    test(`${tab} opens cleanly and exports`, async ({ page }) => {
      const problems = watchPage(page);
      await open(page, `reports/${tab}`);
      await expect(page.locator('.tab[aria-current="page"]')).toHaveAttribute("href", `#/reports/${tab}`);
      await expect(page.locator(".kpi", { hasText: heading })).toBeVisible();
      const { file, rows } = await grabCSV(page);
      expect(file).toMatch(/\.csv$/);
      expect(rows.length).toBeGreaterThan(1);
      expect(problems).toEqual([]);
    });
  }

  test("reports for switched-off modules aren't offered", async ({ page }) => {
    const s = data();
    s.settings.modules = { stock: false, payroll: false, gst: false };
    await open(page, "reports/stock", s);
    const nav = page.getByRole("navigation", { name: "Reports" });
    await expect(nav.getByRole("link")).toHaveText(["Profit & Loss", "Cash flow", "Who owes you", "Who you owe"]);
    // A link to a switched-off report lands on Profit & Loss instead of an empty page.
    await expect(page.locator(".kpi", { hasText: "Net profit" })).toBeVisible();
  });

  test("a new business sees friendly empty reports, with no errors", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "reports/receivable", sampleV2());
    for (const tab of ["profit", "cash", "payable", "gst", "stock", "staff"]) {
      await page.goto(`/index.html#/reports/${tab}`);
      await expect(page.locator("#page-title")).toBeVisible();
    }
    expect(problems).toEqual([]);
  });
});

test.describe("Profit & Loss", () => {
  test("shows the same figures as the calculations, on both bases", async ({ page }) => {
    const accrual = profitLoss(data(), { ...LAST_MONTH, basis: "accrual" });
    const cash = profitLoss(data(), { ...LAST_MONTH, basis: "cash" });
    expect(accrual.revenue.total).toBeGreaterThan(0);
    expect(accrual.netProfit).not.toBe(cash.netProfit);
    await open(page, "reports/profit");
    await expect(kpiValue(page, "Revenue")).toHaveText(m0(accrual.revenue.total));
    await expect(kpiValue(page, "Net profit")).toHaveText(m0(accrual.netProfit));
    await page.locator(".seg label", { hasText: "When paid" }).click();
    await expect(kpiValue(page, "Net profit")).toHaveText(m0(cash.netProfit));
    await expect(page.getByText("Counted when money was received or paid")).toBeVisible();
    // The choice survives moving to another report and back.
    await page.getByRole("link", { name: "Cash flow" }).click();
    await expect(page.locator(".kpi", { hasText: "Closing balance" })).toBeVisible();
    await page.getByRole("link", { name: "Profit & Loss" }).click();
    await expect(kpiValue(page, "Net profit")).toHaveText(m0(cash.netProfit));
  });

  test("the CSV has the figures on screen", async ({ page }) => {
    const p = profitLoss(data(), { ...LAST_MONTH, basis: "accrual" });
    await open(page, "reports/profit");
    const { file, rows } = await grabCSV(page);
    expect(file).toBe(`profit-and-loss-${LAST_MONTH.from}-to-${LAST_MONTH.to}.csv`);
    expect(Number(rowOf(rows, "Total revenue")[1])).toBe(p.revenue.total);
    expect(Number(rowOf(rows, "Net profit")[1])).toBe(p.netProfit);
  });

  test("a longer period shows months, with a chart anyone can read", async ({ page, isMobile }) => {
    await open(page, "reports/profit");
    await expect(page.locator(".chart")).toHaveCount(0);
    await page.getByLabel("Period").selectOption("this-fy");
    const chart = page.locator(".chart");
    await expect(chart).toBeVisible();
    await expect(chart.locator(".chart-key")).toHaveText(["Revenue", "Spending"]);
    await expect(page.getByRole("heading", { name: "Month by month" })).toBeVisible();

    // The tooltip works from the keyboard, and Escape closes it.
    const bars = chart.locator(".chart-hit");
    const label = await bars.last().getAttribute("aria-label");
    expect(label).toContain("Revenue");
    await bars.last().focus();
    const tip = chart.locator(".chart-tip");
    await expect(tip).toBeVisible();
    await expect(tip).toContainText("Revenue");
    await page.keyboard.press("Escape");
    await expect(tip).toBeHidden();
    if (!isMobile) {
      await bars.first().hover();
      await expect(tip).toBeVisible();
    }

    // The same numbers are available as a table.
    await chart.getByText("Show as a table").click();
    await expect(chart.locator("table tbody tr")).toHaveCount(await bars.count());
  });

  test("arrow keys move between months, with one stop in the tab order", async ({ page }) => {
    await open(page, "reports/profit");
    await page.getByLabel("Period").selectOption("this-fy");
    const bars = page.locator(".chart-hit");
    const count = await bars.count();
    expect(count).toBeGreaterThan(1);
    await expect(page.locator('.chart-hit[tabindex="0"]')).toHaveCount(1);
    await bars.last().focus();
    await page.keyboard.press("ArrowLeft");
    await expect(bars.nth(count - 2)).toBeFocused();
    await expect(page.locator('.chart-hit[tabindex="0"]')).toHaveCount(1);
    await page.keyboard.press("Home");
    await expect(bars.first()).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(bars.first()).toBeFocused();
    await page.keyboard.press("End");
    await expect(bars.last()).toBeFocused();
  });

  test("empty months are left out of the table and chart, but not the totals", async ({ page }) => {
    const p = profitLoss(data(), { ...range("this-fy"), basis: "accrual" });
    const withActivity = p.monthly.filter((x) => x.revenue || x.costOfSales || x.expenses || x.staffCost || x.loanInterest);
    expect(withActivity.length).toBeLessThan(p.monthly.length);
    await open(page, "reports/profit");
    await page.getByLabel("Period").selectOption("this-fy");
    await expect(page.locator(".report-table tbody tr")).toHaveCount(withActivity.length);
    await expect(page.locator(".chart-hit")).toHaveCount(withActivity.length);
    await expect(page.locator(".report-table tfoot")).toContainText(formatMoney(p.netProfit, "INR", { decimals: 2 }));
  });

  test("the chart stays inside the phone screen and the tooltip inside the chart", async ({ page }) => {
    await open(page, "reports/profit");
    await page.getByLabel("Period").selectOption("this-fy");
    const plot = page.locator(".chart-plot");
    const bars = page.locator(".chart-hit");
    await bars.first().focus();
    const within = async () => {
      const p = await plot.boundingBox();
      const t = await page.locator(".chart-tip").boundingBox();
      expect(t.x).toBeGreaterThanOrEqual(p.x - 1);
      expect(t.x + t.width).toBeLessThanOrEqual(p.x + p.width + 1);
    };
    await within();
    await bars.last().focus();
    await within();
  });
});

test.describe("the period picker", () => {
  test("changes the range, and stays chosen when moving between reports", async ({ page }) => {
    await open(page, "reports/cash");
    const year = range("this-fy");
    const c = cashFlow(data(), year);
    await page.getByLabel("Period").selectOption("this-fy");
    await expect(kpiValue(page, "Money in")).toHaveText(m0(c.inflow.total));
    await page.getByRole("link", { name: "GST" }).click();
    await expect(page.getByLabel("Period")).toHaveValue("this-fy");
  });

  test("custom dates work, and a backwards range is refused", async ({ page }) => {
    await open(page, "reports/cash");
    await page.getByLabel("Period").selectOption("custom");
    const from = page.getByLabel("From");
    const to = page.getByLabel("To", { exact: true });
    await expect(from).toHaveValue(LAST_MONTH.from);
    await expect(to).toHaveValue(LAST_MONTH.to);

    await from.fill("2099-01-01");
    await from.dispatchEvent("change");
    await expect(from).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator(".page-sub")).toContainText("Oct");

    const custom = { from: range("this-fy").from, to: TODAY };
    await from.fill(custom.from);
    await from.dispatchEvent("change");
    await expect(page.getByLabel("From")).toHaveValue(custom.from);
    await page.getByLabel("To", { exact: true }).fill(custom.to);
    await page.getByLabel("To", { exact: true }).dispatchEvent("change");
    await expect(kpiValue(page, "Closing balance")).toHaveText(m0(cashFlow(data(), custom).closing));
  });
});

test("changing the period doesn't make a button fire twice", async ({ page }) => {
  await open(page, "reports/gst");
  await page.getByLabel("Period").selectOption("this-fy");
  await page.getByLabel("Period").selectOption("last-month");
  await expect(page.getByLabel("Period")).toHaveValue("last-month");
  let downloads = 0;
  page.on("download", () => { downloads += 1; });
  await grabCSV(page);
  await page.waitForTimeout(300);
  expect(downloads).toBe(1);
  await page.getByRole("button", { name: "Print or save as PDF" }).click();
  expect(await page.evaluate(() => window.__printed)).toBe(1);
  await page.getByRole("button", { name: "Record GST payment" }).click();
  await expect(page.locator("dialog")).toHaveCount(1);
});

test.describe("following the dashboard", () => {
  test("each dashboard figure opens a report showing the same number", async ({ page }) => {
    await seed(page, { data: data() });
    await page.goto("/index.html#/dashboard");
    const pairs = [["Clients owe you", "Total owed to you"], ["You owe suppliers", "Total you owe"], ["Profit, Oct 26", "Net profit"]];
    for (const [tile, target] of pairs) {
      const figure = await kpiValue(page, tile).innerText();
      await page.locator(".kpi", { hasText: tile }).click();
      await expect(kpiValue(page, target)).toHaveText(figure);
      await page.goto("/index.html#/dashboard");
    }
  });

  test("reports open on the month in the top bar, until a period is chosen", async ({ page }) => {
    const s = data();
    s.settings.month = "2026-09";
    await open(page, "reports/profit", s);
    await expect(page.getByLabel("Period")).toHaveValue("custom");
    await expect(page.getByLabel("From")).toHaveValue("2026-09-01");
    await expect(page.getByLabel("To", { exact: true })).toHaveValue("2026-09-30");
    await expect(kpiValue(page, "Net profit")).toHaveText(m0(profitLoss(s, { from: "2026-09-01", to: "2026-09-30" }).netProfit));
  });
});

test.describe("on a phone", () => {
  test("zero lines are left out of the cards, but kept on a desktop", async ({ page, isMobile }) => {
    await open(page, "reports/staff");
    const pf = page.locator(".report-table tbody tr").first().locator('td[data-label="PF"]');
    if (isMobile) await expect(pf).toBeHidden();
    else await expect(pf).toBeVisible();
  });
});

test.describe("cash flow", () => {
  test("adds up, and agrees with the accounts", async ({ page }) => {
    const c = cashFlow(data(), { from: range("this-fy").from, to: TODAY });
    expect(c.closing).toBe(c.actualClosing);
    await open(page, "reports/cash");
    await expect(page.getByText("The closing balance matches your accounts")).toBeVisible();
  });

  test("the CSV has opening, in, out and closing", async ({ page }) => {
    const c = cashFlow(data(), LAST_MONTH);
    await open(page, "reports/cash");
    const { rows } = await grabCSV(page);
    expect(Number(rowOf(rows, "Opening balance")[1])).toBe(c.opening);
    expect(Number(rowOf(rows, "Money in")[1])).toBe(c.inflow.total);
    expect(Number(rowOf(rows, "Money out")[1])).toBe(-c.outflow.total);
    expect(Number(rowOf(rows, "Closing balance")[1])).toBe(c.closing);
  });
});

test.describe("ageing", () => {
  for (const [tab, side, label] of [["receivable", "receivable", "Total owed to you"], ["payable", "payable", "Total you owe"]]) {
    test(`${tab}: buckets add up to the total, on screen and in the CSV`, async ({ page }) => {
      const a = ageing(data(), { side, asOf: TODAY });
      expect(a.rows.length).toBeGreaterThan(0);
      await open(page, `reports/${tab}`);
      await expect(kpiValue(page, label)).toHaveText(m0(a.totals.total));
      await expect(page.locator(".page-sub")).toContainText("As of");
      const { rows } = await grabCSV(page);
      const total = rowOf(rows, "Total");
      const parts = total.slice(1, -1).map(Number);
      expect(Math.round(parts.reduce((x, y) => x + y, 0) * 100) / 100).toBe(a.totals.total);
      expect(Number(total.at(-1))).toBe(a.totals.total);
    });
  }

  test("the as-of date looks back in time, and names the export", async ({ page }) => {
    const asOf = "2026-10-15";
    const earlier = ageing(data(), { side: "receivable", asOf });
    expect(earlier.totals.total).not.toBe(ageing(data(), { side: "receivable", asOf: TODAY }).totals.total);
    await open(page, "reports/receivable");
    await expect(page.getByLabel("Period")).toHaveCount(0);
    await expect(page.getByLabel("As of")).toHaveValue(TODAY);
    await page.getByLabel("As of").fill(asOf);
    await page.getByLabel("As of").dispatchEvent("change");
    await expect(kpiValue(page, "Total owed to you")).toHaveText(m0(earlier.totals.total));
    await expect(page.locator(".page-sub")).toHaveText("As of 15 Oct 2026");
    expect((await grabCSV(page)).file).toBe(`receivables-ageing-as-of-${asOf}.csv`);
  });

  test("a name links to that client", async ({ page }) => {
    await open(page, "reports/receivable");
    const link = page.locator(".report-table a").first();
    await expect(link).toHaveAttribute("href", /#\/clients\//);
  });
});

test.describe("GST", () => {
  test("shows output and input tax, and what's left to pay", async ({ page }) => {
    const g = gstSummary(data(), LAST_MONTH);
    expect(g.output.gst).toBeGreaterThan(0);
    await open(page, "reports/gst");
    await expect(kpiValue(page, "GST collected")).toHaveText(m0(g.output.gst));
    await expect(kpiValue(page, "GST on purchases")).toHaveText(m0(g.input.gst));
    await expect(kpiValue(page, g.netPayable >= 0 ? "Net GST payable" : "GST credit")).toHaveText(m0(Math.abs(g.netPayable)));
    await expect(page.getByText("not a tax filing")).toBeVisible();
    const { rows } = await grabCSV(page);
    expect(Number(rowOf(rows, "Net payable")[1])).toBe(g.netPayable);
  });

  test("recording a GST payment reduces what's left, and isn't an expense in profit", async ({ page }) => {
    const before = gstSummary(data(), LAST_MONTH);
    const profitBefore = profitLoss(data(), LAST_MONTH).netProfit;
    await open(page, "reports/gst");
    await page.getByRole("button", { name: "Record GST payment" }).click();
    const d = page.locator("dialog");
    await expect(d.getByLabel(/^Category/)).toHaveValue("GST payment");
    await d.locator('input[name="amount"]').fill("1000");
    await d.locator('input[name="date"]').fill(LAST_MONTH.to);
    await d.getByRole("button", { name: "Save", exact: true }).click();
    await expect(d).toBeHidden();
    await expect(kpiValue(page, "GST collected")).toHaveText(m0(before.output.gst));
    const label = before.netPayable - before.gstPaid >= 0 ? "Net GST payable" : "GST credit";
    await expect(page.locator(".kpi", { hasText: label }).locator(".kpi-sub")).toContainText("paid");
    await page.getByRole("link", { name: "Profit & Loss" }).click();
    await expect(kpiValue(page, "Net profit")).toHaveText(m0(profitBefore));
  });
});

test.describe("stock and staff", () => {
  test("stock shows the value and movements", async ({ page }) => {
    const r = stockReport(data(), LAST_MONTH);
    await open(page, "reports/stock");
    await expect(kpiValue(page, "Stock value today")).toHaveText(m0(r.totalValue));
    await expect(page.locator(".report-table tbody tr")).toHaveCount(r.rows.length);
    const { rows } = await grabCSV(page);
    expect(rows[0].slice(0, 3)).toEqual(["Item", "SKU", "Unit"]);
  });

  test("staff pay matches the calculations and adds up", async ({ page }) => {
    const r = staffPaySummary(data(), LAST_MONTH);
    expect(r.rows.length).toBe(8);
    await open(page, "reports/staff");
    await expect(kpiValue(page, "Gross pay")).toHaveText(m0(r.totals.gross));
    await expect(kpiValue(page, "Pending")).toHaveText(m0(r.totals.pending));
    await expect(page.getByRole("heading", { name: "By team" })).toBeVisible();
    const { rows } = await grabCSV(page);
    expect(Number(rowOf(rows, "Total")[3])).toBe(r.totals.gross);
  });
});

test.describe("print and PDF", () => {
  test("each report prints on a clean page with the business and period on it", async ({ page, isMobile }) => {
    await open(page, "reports/profit");
    await page.getByRole("button", { name: "Print or save as PDF" }).click();
    expect(await page.evaluate(() => window.__printed)).toBe(1);
    const doc = page.locator("#print-root .doc");
    await expect(doc).toContainText("Sunrise Traders");
    await expect(doc).toContainText("Profit & Loss");
    await expect(doc).toContainText("Net profit");
    await expect(doc.locator("tr.total", { hasText: "Net profit" })).toBeVisible();
    await expect(doc.locator("tr.total", { hasText: "Rent" })).toHaveCount(0);
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".app")).toBeHidden();
    await expect(page.locator("#print-root")).toBeVisible();
    if (!isMobile) {
      const pdf = await page.pdf({ format: "A4" });
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
      expect(pdf.length).toBeGreaterThan(5000);
    }
    await page.emulateMedia({ media: "screen" });

    for (const [tab, name, word] of [["cash", "Cash flow", "Closing balance"], ["receivable", "Who owes you", "Total"], ["gst", "GST summary", "GST collected on sales"], ["stock", "Stock report", "Average cost"], ["staff", "Staff pay", "Gross"]]) {
      await page.goto(`/index.html#/reports/${tab}`);
      await expect(page.locator('.tab[aria-current="page"]')).toHaveAttribute("href", `#/reports/${tab}`);
      await page.getByRole("button", { name: "Print or save as PDF" }).click();
      await expect(page.locator("#print-root .doc")).toContainText(name);
      await expect(page.locator("#print-root .doc")).toContainText(word);
    }
  });
});
