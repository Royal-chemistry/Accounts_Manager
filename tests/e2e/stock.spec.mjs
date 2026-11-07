// The stock module: items, stock in and out, history, alerts, invoices and the on/off switch.
import { test, expect, sampleV2, savedData, seed, TODAY, watchPage } from "./helpers.mjs";
import { accountBalances } from "../../js/core/ledger.js";
import { profitLoss } from "../../js/core/reports.js";
import { onHand, stockLedger } from "../../js/core/stock.js";
import { sample } from "../../js/core/sample.js";

const open = async (page, path, data = sample(TODAY)) => {
  await seed(page, { data });
  await page.goto(`/index.html#/${path}`);
  await expect(page.locator("#page-title")).toBeVisible();
};
const empty = () => { const s = sampleV2(); s.settings.modules.stock = true; return s; };

test("adding an item validates, refuses a duplicate SKU, and shows its opening stock and value", async ({ page }) => {
  const problems = watchPage(page);
  await open(page, "stock", empty());
  await expect(page.getByText("No stock items yet")).toBeVisible();
  await page.getByRole("button", { name: "Add stock item" }).first().click();
  const d = page.locator("dialog");
  await d.getByRole("button", { name: "Save" }).click();
  await expect(d.getByText("Item name is required")).toBeVisible();
  await d.getByLabel(/^Item name/).fill("Widget");
  await d.getByLabel("SKU or code").fill("W-1");
  await d.getByLabel(/^Category/).fill("Parts");
  await d.getByLabel(/^Unit/).fill("pcs");
  await d.getByLabel("Reorder level").fill("5");
  await d.getByLabel("Purchase price").fill("100");
  await d.getByLabel("Sale price").fill("150");
  await d.getByLabel("GST %").fill("18");
  await d.getByLabel("Opening quantity").fill("10");
  await d.getByRole("button", { name: "Save" }).click();
  const row = page.locator("tbody tr", { hasText: "Widget" });
  await expect(row).toContainText("10 pcs");
  await expect(row).toContainText("₹1,000");
  await expect(row).toContainText("In stock");
  const saved = await savedData(page);
  expect(saved.categories.stock).toContain("Parts");
  await page.getByRole("button", { name: "Add stock item" }).first().click();
  const again = page.locator("dialog");
  await again.getByLabel(/^Item name/).fill("Another");
  await again.getByLabel("SKU or code").fill("w-1");
  await again.getByRole("button", { name: "Save" }).click();
  await expect(again.getByText("This SKU is already in use")).toBeVisible();
  expect(problems).toEqual([]);
});

test("stock in records a purchase, adds to stock, and updates the average cost", async ({ page }) => {
  const s = sample(TODAY);
  const before = stockLedger(s).find((r) => r.item.id === "item-3");
  await open(page, "stock/item-3", s);
  await page.getByRole("button", { name: "Stock in" }).click();
  const d = page.locator("dialog");
  await expect(d).toContainText("New purchase");
  await expect(d.getByLabel("Stock item")).toHaveValue("item-3");
  await expect(d.getByLabel("Description")).toHaveValue("A4 paper ream");
  await d.getByLabel("Quantity").fill("10");
  await d.getByLabel("Rate", { exact: true }).fill("300");
  await d.getByRole("button", { name: "Save purchase" }).click();
  await expect(page.getByText("Purchase saved")).toBeVisible();
  const after = stockLedger(await savedData(page)).find((r) => r.item.id === "item-3");
  expect(after.onHand).toBe(before.onHand + 10);
  expect(after.avgCost).toBeGreaterThan(before.avgCost);
});

test("a quick sale reduces stock, moves money, counts GST, and warns when selling more than you have", async ({ page }) => {
  const s = sample(TODAY);
  const before = onHand(s, "item-3");
  await open(page, "stock/item-3", s);
  await page.getByRole("button", { name: "Sell" }).click();
  const d = page.locator("dialog");
  await expect(d).toContainText(`${before} pack in stock`);
  await d.getByLabel(/^Quantity/).fill("9999");
  await expect(d.getByText(/more than the/)).toBeVisible();
  await d.getByLabel(/^Quantity/).fill("2");
  await d.locator(".seg label", { hasText: "Cash" }).click();
  await expect(d.locator("[data-foot-note]")).toContainText("₹694.40");
  await d.getByRole("button", { name: "Save sale" }).click();
  await expect(page.getByText("Sold 2 pack of A4 paper ream")).toBeVisible();
  const saved = await savedData(page);
  expect(onHand(saved, "item-3")).toBe(before - 2);
  const t = saved.transactions.at(-1);
  expect(t.amount).toBe(694.4);
  expect(t.gstAmount).toBe(74.4);
  expect(accountBalances(saved)["acct-cash"]).toBe(accountBalances(s)["acct-cash"] + 694.4);
});

test("a sale can be on credit, and needs a client for that", async ({ page }) => {
  await open(page, "stock/item-4");
  await page.getByRole("button", { name: "Sell" }).click();
  const d = page.locator("dialog");
  await d.locator(".seg label", { hasText: "Credit" }).click();
  await d.getByRole("button", { name: "Save sale" }).click();
  await expect(d.getByText("Choose who this is on credit with")).toBeVisible();
  await d.getByLabel(/^Client/).selectOption("client-1");
  await d.getByRole("button", { name: "Save sale" }).click();
  await expect(page.getByText(/Sold 1/)).toBeVisible();
  expect((await savedData(page)).transactions.at(-1).mode).toBe("credit");
});

test("selling beyond what's there is allowed and flagged", async ({ page }) => {
  await open(page, "stock/item-4");
  await page.getByRole("button", { name: "Sell" }).click();
  const d = page.locator("dialog");
  await d.getByLabel(/^Quantity/).fill("100");
  await d.locator(".seg label", { hasText: "Cash" }).click();
  await d.getByRole("button", { name: "Save sale" }).click();
  await expect(page.getByText("More has been sold or used than recorded as bought")).toBeVisible();
  await page.goto("/index.html#/stock");
  await expect(page.locator("tbody tr", { hasText: "Floor cleaner" })).toContainText("Below zero");
});

test("used or damaged stock moves no money but counts against profit, and can be deleted", async ({ page }) => {
  const s = sample(TODAY);
  const range = { from: "2020-01-01", to: "2030-12-31" };
  const before = profitLoss(s, range).netProfit;
  await open(page, "stock/item-1", s);
  await page.getByRole("button", { name: "Used or recounted" }).click();
  const d = page.locator("dialog");
  await d.getByLabel("What happened?").selectOption("damage");
  await d.getByLabel(/^Quantity/).fill("5");
  await d.getByLabel("Note").fill("Crushed");
  await d.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Stock updated")).toBeVisible();
  const saved = await savedData(page);
  expect(accountBalances(saved)).toEqual(accountBalances(s));
  expect(profitLoss(saved, range).netProfit).toBeLessThan(before);
  const row = page.locator("[data-history] tbody tr", { hasText: "Crushed" });
  await row.getByRole("button", { name: "Delete movement" }).click();
  await page.locator("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator("[data-history] tbody tr", { hasText: "Crushed" })).toHaveCount(0);
  expect(onHand(await savedData(page), "item-1")).toBe(onHand(s, "item-1"));
});

test("a recount adjusts stock by the difference", async ({ page }) => {
  const s = sample(TODAY);
  await open(page, "stock/item-2", s);
  await page.getByRole("button", { name: "Used or recounted" }).click();
  const d = page.locator("dialog");
  await d.getByLabel("What happened?").selectOption("count");
  await expect(d.getByLabel(/^Quantity/)).toBeHidden();
  await d.getByLabel(/^Real quantity/).fill("7");
  await d.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Stock updated")).toBeVisible();
  expect(onHand(await savedData(page), "item-2")).toBe(7);
});

test("an invoice with a stock item reduces stock, and deleting it puts the stock back", async ({ page }) => {
  const s = sample(TODAY);
  const before = onHand(s, "item-5");
  await open(page, "invoices", s);
  await page.getByRole("button", { name: "New invoice" }).first().click();
  const d = page.locator("dialog");
  await d.getByLabel("Stock item", { exact: true }).selectOption("item-5");
  await expect(d.getByLabel("Description")).toHaveValue("Delivery bags (bundle)");
  await expect(d.getByLabel("Rate", { exact: true })).toHaveValue("260");
  await expect(d.getByLabel("GST percent")).toHaveValue("5");
  await expect(d.getByLabel("HSN or SAC code")).toHaveValue("3923");
  await d.getByLabel("Quantity").fill("3");
  await d.getByRole("button", { name: "Create invoice" }).click();
  await expect(page.getByText(/created/)).toBeVisible();
  expect(onHand(await savedData(page), "item-5")).toBe(before - 3);
  const row = page.locator("tbody tr", { hasText: "ST-007" });
  await row.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const warn = page.locator("dialog");
  await expect(warn).toContainText("Stock of Delivery bags (bundle) goes up by 3 pack");
  await warn.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator("tbody tr", { hasText: "ST-007" })).toHaveCount(0);
  expect(onHand(await savedData(page), "item-5")).toBe(before);
});

test("unticking Reduce stock leaves stock alone", async ({ page }) => {
  const s = sample(TODAY);
  const before = onHand(s, "item-5");
  await open(page, "invoices", s);
  await page.getByRole("button", { name: "New invoice" }).first().click();
  const d = page.locator("dialog");
  await d.getByLabel("Stock item", { exact: true }).selectOption("item-5");
  await d.getByLabel(/Reduce stock/).uncheck();
  await d.getByRole("button", { name: "Create invoice" }).click();
  await expect(page.getByText(/created/)).toBeVisible();
  expect(onHand(await savedData(page), "item-5")).toBe(before);
});

test("the movements page lists everything, and links back to its source", async ({ page }) => {
  await open(page, "stock/movements");
  await expect(page.locator("tbody")).toContainText("Invoice ST-001");
  await expect(page.locator("tbody")).toContainText("Purchase MP-2201");
  await page.getByLabel("In and out").selectOption("in");
  await expect(page.locator("tbody")).not.toContainText("Invoice ST-001");
  await page.getByRole("link", { name: "Purchase MP-2201" }).click();
  await expect(page.locator("h1")).toHaveText("Purchase MP-2201");
});

test("low stock shows on the stock page and the dashboard", async ({ page }) => {
  await open(page, "stock");
  await expect(page.locator("tbody tr", { hasText: "Floor cleaner" })).toContainText("Low stock");
  await page.getByLabel("All stock levels").selectOption("low");
  await expect(page.locator("tbody tr", { hasText: "Corrugated box" })).toHaveCount(0);
  await page.goto("/index.html#/dashboard");
  await expect(page.getByTestId("low-stock")).toContainText("Floor cleaner");
});

test("deleting an item with history offers Mark inactive, and invoices keep their text", async ({ page }) => {
  await open(page, "stock");
  await page.locator("tbody tr", { hasText: "Floor cleaner" }).getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const d = page.locator("dialog");
  await expect(d).toContainText("keep their text but lose the link");
  await d.getByRole("button", { name: "Delete everything" }).click();
  const saved = await savedData(page);
  expect(saved.items.some((i) => i.id === "item-4")).toBe(false);
  expect(saved.invoices.find((i) => i.id === "inv-3").lines[0].desc).toBe("Floor cleaner 5L");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("tbody tr", { hasText: "Floor cleaner" })).toBeVisible();
});

test("switching stock off hides it everywhere, and invoice lines stop asking", async ({ page, isMobile }) => {
  const s = sample(TODAY);
  s.settings.modules.stock = false;
  await open(page, "invoices", s);
  if (!isMobile) await expect(page.getByRole("navigation", { name: "Pages" }).getByRole("link", { name: "Stock" })).toHaveCount(0);
  await page.getByRole("button", { name: "New invoice" }).first().click();
  await expect(page.locator("dialog").getByLabel("Stock item")).toHaveCount(0);
  await expect(page.locator("dialog").getByLabel(/Reduce stock/)).toHaveCount(0);
});

test("stock CSV exports the visible items", async ({ page }) => {
  await open(page, "stock");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV" }).click();
  expect((await download).suggestedFilename()).toBe("stock.csv");
});
