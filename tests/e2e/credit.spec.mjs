// Suppliers, purchases, credit and settling up.
import { test, expect, sampleV2, savedData, seed, TODAY, watchPage } from "./helpers.mjs";
import { accountBalances } from "../../js/core/ledger.js";
import { ageing } from "../../js/core/reports.js";
import { docTotals, outstanding } from "../../js/core/documents.js";
import { sample } from "../../js/core/sample.js";

const open = async (page, path, data = sample(TODAY)) => {
  await seed(page, { data });
  await page.goto(`/index.html#/${path}`);
  await expect(page.locator("#page-title")).toBeVisible();
};

test.describe("suppliers", () => {
  test("a new supplier with an opening balance shows what you owe, with no effect on profit or cash", async ({ page }) => {
    const problems = watchPage(page);
    const s = sampleV2();
    await open(page, "suppliers", s);
    await expect(page.getByText("No suppliers yet")).toBeVisible();
    await page.getByRole("button", { name: "Add supplier" }).first().click();
    const d = page.locator("dialog");
    await d.getByRole("button", { name: "Save" }).click();
    await expect(d.getByText("Supplier name is required")).toBeVisible();
    await d.getByLabel(/^Supplier name/).fill("Acme Wholesale");
    await d.getByLabel(/You owe them from before/).fill("2500");
    await d.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("tbody tr", { hasText: "Acme Wholesale" })).toContainText("₹2,500");
    const saved = await savedData(page);
    expect(outstanding(saved, "payable")).toBe(2500);
    expect(accountBalances(saved)).toEqual(accountBalances(s));
    expect(problems).toEqual([]);
  });

  test("the detail page lists their purchases and credit entries, and handles an unknown one", async ({ page }) => {
    await open(page, "suppliers/supplier-1");
    await expect(page.locator("h1")).toHaveText("Malabar Packaging");
    await expect(page.locator("[data-history]")).toContainText("MP-2201");
    await expect(page.locator("[data-history]")).toContainText("MP-2240");
    await page.goto("/index.html#/suppliers/nobody");
    await expect(page.locator("h1")).toHaveText("Supplier not found");
  });

  test("deleting a supplier with history offers Mark inactive", async ({ page }) => {
    await open(page, "suppliers");
    await page.locator("tbody tr", { hasText: "Deccan Paper Mills" }).getByRole("button", { name: "Delete" }).click();
    const d = page.locator("dialog");
    await expect(d).toContainText("1 purchase and their payments");
    await d.getByRole("button", { name: "Mark inactive instead" }).click();
    await expect(page.locator("tbody tr", { hasText: "Deccan Paper Mills" })).toHaveClass(/row-inactive/);
    expect((await savedData(page)).purchases.filter((p) => p.supplierId === "supplier-2")).toHaveLength(1);
  });
});

test.describe("purchases", () => {
  test("a credit purchase adds to what you owe and moves no money", async ({ page }) => {
    const s = sample(TODAY);
    const owedBefore = outstanding(s, "payable", "supplier-3");
    await open(page, "purchases", s);
    await page.getByRole("button", { name: "New purchase" }).first().click();
    const d = page.locator("dialog");
    await d.getByLabel(/^Supplier/).selectOption("supplier-3");
    await d.getByLabel("Bill number").fill("NEW-1");
    await d.getByLabel("Description").first().fill("Cleaning contract");
    await d.getByLabel("Rate", { exact: true }).first().fill("1000");
    await d.getByLabel("GST percent").first().fill("18");
    await expect(d.locator("[data-total]")).toHaveText("₹1,180.00");
    await d.getByRole("button", { name: "Save purchase" }).click();
    await expect(page.getByText("Purchase saved")).toBeVisible();
    const saved = await savedData(page);
    expect(outstanding(saved, "payable", "supplier-3")).toBe(owedBefore + 1180);
    expect(accountBalances(saved)).toEqual(accountBalances(s));
    expect(saved.purchases.at(-1).due).toBeTruthy();
  });

  test("a cash purchase is paid at once and moves the balance", async ({ page }) => {
    const s = sample(TODAY);
    await open(page, "purchases", s);
    await page.getByRole("button", { name: "New purchase" }).first().click();
    const d = page.locator("dialog");
    await d.getByLabel("Description").first().fill("Cash buy");
    await d.getByLabel("Rate", { exact: true }).first().fill("500");
    await d.getByLabel("GST percent").first().fill("0");
    await d.locator(".seg label", { hasText: "Cash" }).click();
    await d.getByRole("button", { name: "Save purchase" }).click();
    await expect(page.getByText("Purchase saved")).toBeVisible();
    const saved = await savedData(page);
    expect(docTotals(saved.purchases.at(-1)).status).toBe("paid");
    expect(accountBalances(saved)["acct-cash"]).toBe(accountBalances(s)["acct-cash"] - 500);
  });

  test("a duplicate bill number from the same supplier is refused", async ({ page }) => {
    await open(page, "purchases");
    await page.getByRole("button", { name: "New purchase" }).first().click();
    const d = page.locator("dialog");
    await d.getByLabel(/^Supplier/).selectOption("supplier-1");
    await d.getByLabel("Bill number").fill("mp-2201");
    await d.getByLabel("Description").first().fill("X");
    await d.getByLabel("Rate", { exact: true }).first().fill("1");
    await d.getByRole("button", { name: "Save purchase" }).click();
    await expect(d.getByText(/This bill number is already in use/)).toBeVisible();
  });

  test("paying a bill in part updates it, and overpaying is stopped", async ({ page }) => {
    const s = sample(TODAY);
    await open(page, "purchases", s);
    const row = () => page.locator("tbody tr", { hasText: "MP-2240" });
    await row().getByRole("button", { name: "Pay" }).click();
    const d = page.locator("dialog");
    await d.getByLabel(/^Amount paid/).fill("99999");
    await d.getByRole("button", { name: "Save payment" }).click();
    await expect(d.getByText(/more than the/)).toBeVisible();
    await d.getByLabel(/^Amount paid/).fill("500");
    await d.locator(".seg label", { hasText: "Cash" }).click();
    await d.getByRole("button", { name: "Save payment" }).click();
    await expect(page.getByText(/Part payment saved/)).toBeVisible();
    await expect(row()).toContainText("₹500");
    expect(accountBalances(await savedData(page))["acct-cash"]).toBe(accountBalances(s)["acct-cash"] - 500);
  });

  test("the detail page shows lines and payments, and a payment can be deleted", async ({ page }) => {
    await open(page, "purchases/bill-2");
    await expect(page.locator("h1")).toHaveText("Purchase DP-881");
    await expect(page.locator("[data-payments]")).toContainText("₹8,000.00");
    await page.locator("[data-payments]").getByRole("button", { name: "Delete payment" }).click();
    await page.locator("dialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("No payments yet")).toBeVisible();
    await page.goto("/index.html#/purchases/nothing");
    await expect(page.locator("h1")).toHaveText("Purchase not found");
  });

  test("deleting warns about payments, and Undo restores it all", async ({ page }) => {
    const s = sample(TODAY);
    await open(page, "purchases", s);
    await page.locator("tbody tr", { hasText: "DP-881" }).getByRole("button", { name: "Delete" }).click();
    const d = page.locator("dialog");
    await expect(d).toContainText("1 payment totalling ₹8,000");
    await expect(d).toContainText("Current account balance goes up by ₹8,000");
    await d.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.locator("tbody tr", { hasText: "DP-881" })).toHaveCount(0);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("tbody tr", { hasText: "DP-881" })).toBeVisible();
    expect(accountBalances(await savedData(page))).toEqual(accountBalances(s));
  });

  test("with no suppliers, it asks for one first and carries on", async ({ page }) => {
    const s = sampleV2();
    await open(page, "purchases", s);
    await page.getByRole("button", { name: "New purchase" }).first().click();
    const d = page.locator("dialog");
    await d.getByLabel(/^Supplier name/).fill("First Supplier");
    await d.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("dialog").getByRole("button", { name: "Save purchase" })).toBeVisible();
  });

  test("Quick add opens a new purchase", async ({ page }) => {
    await open(page, "dashboard");
    await page.getByRole("button", { name: "Quick add" }).click();
    await page.getByRole("menuitem", { name: "Purchase" }).click();
    await expect(page.locator("dialog")).toContainText("New purchase");
  });
});

test.describe("settling up", () => {
  test("paying a supplier goes to the oldest bill first, moves the bank balance, and undoes as one", async ({ page }) => {
    const s = sample(TODAY);
    const before = accountBalances(s)["acct-current"];
    const owed = outstanding(s, "payable", "supplier-3");
    await open(page, "suppliers", s);
    await page.locator("tbody tr", { hasText: "City Cleaning Supplies" }).getByRole("button", { name: "Pay supplier" }).click();
    const d = page.locator("dialog");
    await expect(d.locator("[data-alloc]")).toHaveCount(2);
    const amount = d.locator('input[name="amount"]');
    await expect(amount).toHaveValue(String(owed));
    await amount.fill("4000");
    await amount.press("Tab");
    await expect(d.locator("[data-alloc]").nth(0)).toHaveValue("3500");
    await expect(d.locator("[data-alloc]").nth(1)).toHaveValue("500");
    await d.locator(".seg label", { hasText: "Bank" }).click();
    await d.getByLabel("Account").selectOption("acct-current");
    await d.getByRole("button", { name: "Pay supplier" }).click();
    await expect(page.getByText(/Paid ₹4,000.00 to City Cleaning Supplies/)).toBeVisible();

    let saved = await savedData(page);
    expect(accountBalances(saved)["acct-current"]).toBe(before - 4000);
    expect(outstanding(saved, "payable", "supplier-3")).toBe(owed - 4000);
    const payments = [...saved.purchases.flatMap((p) => p.payments), ...saved.transactions.flatMap((t) => t.payments || [])].filter((p) => p.settlementId);
    expect(payments).toHaveLength(2);
    expect(new Set(payments.map((p) => p.settlementId)).size).toBe(1);

    // Deleting one of the two undoes both.
    await page.goto("/index.html#/purchases/bill-4");
    await page.locator("[data-payments]").getByRole("button", { name: "Delete payment" }).click();
    const warn = page.locator("dialog");
    await expect(warn).toContainText("Undo this settlement of ₹4,000");
    await warn.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("No payments yet")).toBeVisible();
    saved = await savedData(page);
    expect(accountBalances(saved)["acct-current"]).toBe(before);
    expect(outstanding(saved, "payable", "supplier-3")).toBe(owed);
  });

  test("paying more than is owed is stopped, and an edited split has to add up", async ({ page }) => {
    await open(page, "suppliers/supplier-3");
    await page.getByRole("button", { name: "Pay supplier" }).click();
    const d = page.locator("dialog");
    const amount = d.locator('input[name="amount"]');
    await amount.fill("999999");
    await d.getByRole("button", { name: "Pay supplier" }).click();
    await expect(d.getByText(/That's more than the/)).toBeVisible();
    await amount.fill("1000");
    await amount.press("Tab");
    await d.locator("[data-alloc]").nth(1).fill("50");
    await d.getByRole("button", { name: "Pay supplier" }).click();
    await expect(d.getByText(/The split adds up to/)).toBeVisible();
  });

  test("receiving from a client reduces receivables and ageing ties to the page", async ({ page }) => {
    const s = sample(TODAY);
    const owed = outstanding(s, "receivable", "client-3");
    await open(page, "clients", s);
    const row = page.locator("tbody tr", { hasText: "Coastal Chemicals" });
    await row.getByRole("button", { name: "Receive payment" }).click();
    const d = page.locator("dialog");
    await d.locator(".seg label", { hasText: "UPI" }).click();
    await d.getByRole("button", { name: "Receive payment" }).click();
    await expect(page.getByText(/Received/)).toBeVisible();
    const saved = await savedData(page);
    expect(owed).toBeGreaterThan(0);
    expect(outstanding(saved, "receivable", "client-3")).toBe(0);
    expect(ageing(saved, { side: "receivable", asOf: TODAY }).totals.total).toBe(outstanding(saved, "receivable"));
    await expect(page.locator("tbody tr", { hasText: "Coastal Chemicals" }).getByRole("button", { name: "Receive payment" })).toHaveCount(0);
  });

  test("a credit expense can be settled straight from the cash book", async ({ page }) => {
    await open(page, "cashbook");
    const row = page.locator("tbody tr", { hasText: "Van service" });
    await expect(row).toContainText("open");
    await row.getByRole("button", { name: "Settle" }).click();
    await expect(page.locator("dialog")).toContainText("Pay City Cleaning Supplies");
  });

  test("nothing outstanding means nothing to settle", async ({ page }) => {
    const s = sample(TODAY);
    s.purchases = s.purchases.filter((p) => p.supplierId !== "supplier-2");
    await open(page, "suppliers/supplier-2", s);
    await expect(page.getByRole("button", { name: "Pay supplier" })).toHaveCount(0);
  });
});
