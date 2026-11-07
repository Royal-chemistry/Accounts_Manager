// Clients, invoices, the cash book, recurring payments, banks and loans.
import { readFileSync } from "node:fs";
import { test, expect, fixture, sampleV2, savedData, seed, TODAY, watchPage } from "./helpers.mjs";
import { accountBalances, loanOutstanding } from "../../js/core/ledger.js";
import { docTotals } from "../../js/core/documents.js";
import { formatMoney } from "../../js/core/money.js";
import { migrate } from "../../js/core/migrate.js";
import { profitLoss } from "../../js/core/reports.js";
import { cycleStatus } from "../../js/core/recurring.js";

const open = async (page, path, data = sampleV2()) => {
  await seed(page, { data });
  await page.goto(`/index.html#/${path}`);
  await expect(page.locator("#page-title")).toBeVisible();
};
const OCT = { from: "2026-10-01", to: "2026-10-31" };

/** Fills the first line of an invoice. */
async function fillLine(dialog, { desc, qty, rate, gst }) {
  await dialog.getByLabel("Description").first().fill(desc);
  if (qty !== undefined) await dialog.getByLabel("Quantity").first().fill(String(qty));
  await dialog.getByLabel("Rate", { exact: true }).first().fill(String(rate));
  if (gst !== undefined) await dialog.getByLabel("GST percent").first().fill(String(gst));
}

test("an invoice with no lines names the one problem, instead of marking every box wrong", async ({ page }) => {
  await open(page, "invoices");
  await page.getByRole("button", { name: "New invoice" }).first().click();
  const dialog = page.locator("dialog");
  await dialog.getByRole("button", { name: "Create invoice" }).click();
  await expect(dialog.getByText("Add at least one line")).toBeVisible();
  await expect(dialog.getByLabel("Quantity")).not.toHaveAttribute("aria-invalid", "true");
});

test.describe("clients", () => {
  test("adding one reads the state from their GSTIN, and carries an opening balance", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "clients");
    await page.getByRole("button", { name: "Add client" }).first().click();
    const dialog = page.locator("dialog");
    await dialog.getByLabel(/^Client name/).fill("New Hotel");
    await dialog.getByLabel("GSTIN").fill("27AAPFU0939F1ZV");
    await dialog.getByLabel("GSTIN").press("Tab");
    await expect(dialog.getByLabel("State")).toHaveValue("27");
    await dialog.getByLabel(/They owe you from before/).fill("5000");
    await dialog.getByRole("button", { name: "Save" }).click();
    const row = page.locator("tbody tr", { hasText: "New Hotel" });
    await expect(row).toContainText("₹5,000");
    const saved = await savedData(page);
    const opening = saved.transactions.find((t) => t.opening);
    expect(opening.mode).toBe("credit");
    expect(opening.partyId).toBe(saved.clients.at(-1).id);
    expect(profitLoss(saved, { from: TODAY, to: TODAY }).netProfit).toBe(0);
    expect(problems).toEqual([]);
  });

  test("a client with invoices offers Mark inactive, and deleting takes the invoices too", async ({ page }) => {
    await open(page, "clients");
    await page.locator("tbody tr", { hasText: "Harbour View Hotel" }).getByRole("button", { name: "Delete" }).click();
    const dialog = page.locator("dialog");
    await expect(dialog).toContainText("2 invoices and their payments");
    await expect(dialog.getByRole("button", { name: "Mark inactive instead" })).toBeVisible();
    await dialog.getByRole("button", { name: "Delete everything" }).click();
    expect((await savedData(page)).invoices.filter((i) => i.clientId === "c1")).toHaveLength(0);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("tbody tr", { hasText: "Harbour View Hotel" })).toBeVisible();
    expect((await savedData(page)).invoices.filter((i) => i.clientId === "c1")).toHaveLength(2);
  });

  test("the detail page shows what they owe and their history", async ({ page }) => {
    await open(page, "clients/c3");
    await expect(page.locator("h1")).toHaveText("Coastal Chemicals Pvt Ltd");
    await expect(page.locator(".kpis")).toContainText("₹47,790");
    await expect(page.locator("[data-history]")).toContainText("ST-003");
  });

  test("receiving from a client splits across their invoices, oldest first", async ({ page }) => {
    const s = sampleV2();
    const before = accountBalances(s).b1;
    await open(page, "clients/c1", s);
    await page.getByRole("button", { name: "Receive payment" }).click();
    const dialog = page.locator("dialog");
    await expect(dialog).toContainText("₹1,08,560.00 is outstanding");
    const amount = dialog.locator('input[name="amount"]');
    await amount.fill("10000");
    await amount.press("Tab");
    await expect(dialog.locator("[data-alloc]").first()).toHaveValue("10000");
    await dialog.locator(".seg label", { hasText: "Bank" }).click();
    await dialog.getByRole("button", { name: "Receive payment" }).click();
    await expect(page.getByText("Received ₹10,000.00 from Harbour View Hotel")).toBeVisible();
    const saved = await savedData(page);
    expect(accountBalances(saved).b1).toBe(before + 10000);
    expect(docTotals(saved.invoices.find((i) => i.id === "i4")).balance).toBe(98560);
  });
});

test.describe("invoices", () => {
  test("a new invoice validates, numbers itself, and works out GST", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "invoices");
    await page.getByRole("button", { name: "New invoice" }).first().click();
    const dialog = page.locator("dialog");
    await dialog.getByLabel(/^Client/).selectOption("c3");
    await expect(dialog.getByLabel(/^Invoice number/)).toHaveValue("ST-005");
    await dialog.getByRole("button", { name: "Create invoice" }).click();
    await expect(dialog.getByText("Every line needs a description")).toBeHidden();
    await expect(dialog.getByText("Add at least one line")).toBeVisible();
    await fillLine(dialog, { desc: "Packing material", qty: 10, rate: 100, gst: 18 });
    await expect(dialog.locator("[data-total]")).toHaveText("₹1,180.00");
    await dialog.getByRole("button", { name: "Add a line" }).click();
    await dialog.getByLabel("Description").last().fill("Delivery");
    await dialog.getByLabel("Rate", { exact: true }).last().fill("100");
    await dialog.getByLabel("GST percent").last().fill("5");
    await expect(dialog.locator("[data-total]")).toHaveText("₹1,285.00");
    await dialog.getByRole("button", { name: "Create invoice" }).click();
    await expect(page.getByText("Invoice ST-005 created")).toBeVisible();
    const saved = await savedData(page);
    const inv = saved.invoices.find((i) => i.no === "ST-005");
    expect(docTotals(inv).total).toBe(1285);
    expect(inv.payments).toHaveLength(0);
    expect(saved.settings.invoice.nextNo).toBe(6);
    expect(problems).toEqual([]);
  });

  test("editing keeps the existing lines, and a duplicate number is refused", async ({ page }) => {
    await open(page, "invoices");
    await page.locator("tbody tr", { hasText: "ST-003" }).getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const dialog = page.locator("dialog");
    await expect(dialog.getByLabel("Description")).toHaveCount(2);
    await expect(dialog.getByLabel("Description").first()).toHaveValue("Packing material");
    await expect(dialog.locator("[data-total]")).toHaveText("₹47,790.00");
    await dialog.getByLabel(/^Invoice number/).fill("ST-001");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByText("This invoice number is already in use")).toBeVisible();
    await dialog.getByLabel(/^Invoice number/).fill("ST-003");
    await dialog.getByLabel("Description").first().fill("Changed");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    const saved = await savedData(page);
    const inv = saved.invoices.find((i) => i.no === "ST-003");
    expect(inv.lines).toHaveLength(2);
    expect(inv.lines[0].desc).toBe("Changed");
    expect(docTotals(inv).total).toBe(47790);
  });

  test("an inter-state client gets IGST on the form and on paper", async ({ page }) => {
    await page.addInitScript(() => { window.print = () => {}; });
    const s = sampleV2();
    s.profile.stateCode = "32";
    s.clients.push({ id: "far", name: "Far Away Ltd", gstin: "27AAPFU0939F1ZV", stateCode: "27", gst: true, active: true, contact: "", phone: "", email: "", address: "", rate: 0 });
    await open(page, "invoices", s);
    await page.getByRole("button", { name: "New invoice" }).first().click();
    const dialog = page.locator("dialog");
    await dialog.getByLabel(/^Client/).selectOption("far");
    await expect(dialog.getByLabel("Place of supply")).toHaveValue("27");
    await fillLine(dialog, { desc: "Goods", qty: 1, rate: 1000, gst: 18 });
    await expect(dialog.locator("[data-igst]")).toHaveText("₹180.00");
    await dialog.getByRole("button", { name: "Create invoice" }).click();
    await expect(page.getByText(/created/)).toBeVisible();
    const row = page.locator("tbody tr", { hasText: "Far Away Ltd" });
    await row.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Print" }).click();
    const paper = page.locator("#print-root");
    await expect(paper).toContainText("Tax invoice");
    await expect(paper).toContainText("IGST 18%");
    await expect(paper).not.toContainText("CGST");
    await expect(paper).toContainText("Rupees One Thousand One Hundred Eighty only");
  });

  test("a same-state invoice prints CGST and SGST, and a no-GST one says Invoice", async ({ page, isMobile }) => {
    await page.addInitScript(() => { window.print = () => {}; });
    const s = sampleV2();
    s.profile.stateCode = "32";
    await open(page, "invoices", s);
    const print = async (no) => {
      await page.locator("tbody tr", { hasText: no }).getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Print" }).click();
    };
    await print("ST-001");
    const paper = page.locator("#print-root");
    await expect(paper).toContainText("CGST 9%");
    await expect(paper).toContainText("SGST 9%");
    await expect(paper).toContainText("Balance due");
    await print("ST-002");
    await expect(paper.locator(".doc-title")).toHaveText("Invoice");
    if (!isMobile) {
      await page.emulateMedia({ media: "print" });
      const pdf = await page.pdf({ format: "A4" });
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    }
  });

  test("entering a total extracts the tax", async ({ page }) => {
    await open(page, "invoices");
    await page.getByRole("button", { name: "New invoice" }).first().click();
    const dialog = page.locator("dialog");
    await fillLine(dialog, { desc: "All in", qty: 1, rate: 1180, gst: 18 });
    await expect(dialog.locator("[data-total]")).toHaveText("₹1,392.40");
    await dialog.getByLabel(/rates I enter already include GST/).check();
    await expect(dialog.locator("[data-total]")).toHaveText("₹1,180.00");
    await expect(dialog.locator("[data-summary]")).toContainText("₹1,000.00");
    await dialog.getByRole("button", { name: "Create invoice" }).click();
    await expect(page.getByText(/created/)).toBeVisible();
    const inv = (await savedData(page)).invoices.at(-1);
    expect(docTotals(inv).total).toBe(1180);
    expect(docTotals(inv).gst).toBe(180);
  });

  test("paying when invoicing records the payment and moves the bank balance", async ({ page }) => {
    const s = sampleV2();
    const before = accountBalances(s).b2;
    await open(page, "invoices", s);
    await page.getByRole("button", { name: "New invoice" }).first().click();
    const dialog = page.locator("dialog");
    await fillLine(dialog, { desc: "Paid now", qty: 1, rate: 500, gst: 0 });
    await dialog.locator(".seg label", { hasText: "UPI" }).click();
    await dialog.getByLabel("Account").selectOption("b2");
    await dialog.getByRole("button", { name: "Create invoice" }).click();
    await expect(page.getByText(/created/)).toBeVisible();
    const saved = await savedData(page);
    const inv = saved.invoices.at(-1);
    expect(inv.payments).toHaveLength(1);
    expect(inv.payments[0].mode).toBe("upi");
    expect(docTotals(inv).status).toBe("paid");
    expect(accountBalances(saved).b2).toBe(before + 500);
  });

  test("part payments with TDS balance correctly, and overpaying is stopped", async ({ page }) => {
    await open(page, "invoices");
    await page.locator("tbody tr", { hasText: "ST-003" }).getByRole("button", { name: "Receive" }).click();
    const dialog = page.locator("dialog");
    await expect(dialog.getByLabel(/^Amount received/)).toHaveValue("47790");
    await dialog.getByLabel(/^Amount received/).fill("99999");
    await dialog.getByRole("button", { name: "Save payment" }).click();
    await expect(dialog.getByText("That's more than the ₹47,790 owed")).toBeVisible();
    await dialog.getByLabel(/^Amount received/).fill("20000");
    await dialog.getByLabel(/TDS deducted/).fill("500");
    await dialog.getByRole("button", { name: "Save payment" }).click();
    await expect(page.getByText("Part payment saved. ₹27,290 still to come")).toBeVisible();
    await expect(page.locator("tbody tr", { hasText: "ST-003" })).toContainText("Overdue");
    const inv = (await savedData(page)).invoices.find((i) => i.no === "ST-003");
    expect(docTotals(inv).balance).toBe(27290);
    expect(docTotals(inv).tds).toBe(500);
  });

  test("deleting warns about its payments, and Undo restores them and the money", async ({ page }) => {
    const s = sampleV2();
    await open(page, "invoices", s);
    await page.locator("tbody tr", { hasText: "ST-002" }).getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const dialog = page.locator("dialog");
    await expect(dialog).toContainText("1 payment totalling ₹15,000");
    await expect(dialog).toContainText("Savings balance goes down by ₹15,000");
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.locator("tbody tr", { hasText: "ST-002" })).toHaveCount(0);
    expect(accountBalances(await savedData(page)).b2).toBe(accountBalances(s).b2 - 15000);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("tbody tr", { hasText: "ST-002" })).toBeVisible();
    expect(accountBalances(await savedData(page)).b2).toBe(accountBalances(s).b2);
  });

  test("the detail page lists payments, and one can be deleted on its own", async ({ page }) => {
    await open(page, "invoices/i2");
    await expect(page.locator("h1")).toHaveText("Invoice ST-002");
    await expect(page.locator("[data-payments]")).toContainText("₹15,000.00");
    await page.locator("[data-payments]").getByRole("button", { name: "Delete payment" }).click();
    const dialog = page.locator("dialog");
    await expect(dialog).toContainText("Invoice ST-002 will show ₹28,800 outstanding");
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("No payments yet")).toBeVisible();
    expect(docTotals((await savedData(page)).invoices.find((i) => i.id === "i2")).status).toBe("unpaid");
  });

  test("filters, the register and CSV export", async ({ page }) => {
    await page.addInitScript(() => { window.print = () => {}; });
    await open(page, "invoices");
    await page.getByLabel("All statuses").selectOption("paid");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody tr")).toContainText("ST-001");
    await page.getByRole("button", { name: "Print register" }).click();
    await expect(page.locator("#print-root")).toContainText("Invoice register");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "CSV" }).click();
    const text = readFileSync(await (await download).path(), "utf8");
    expect(text).toContain("ST-001");
    expect(text).not.toContain("ST-003");
  });

  test("with no clients, it asks for one first and then carries on", async ({ page }) => {
    const s = sampleV2();
    s.clients = []; s.invoices = [];
    await open(page, "invoices", s);
    await page.getByRole("button", { name: "New invoice" }).first().click();
    const dialog = page.locator("dialog");
    await dialog.getByLabel(/^Client name/).fill("First Client");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("dialog").getByRole("button", { name: "Create invoice" })).toBeVisible();
    await expect(page.locator("dialog").getByLabel(/^Client/)).toHaveValue((await savedData(page)).clients[0].id);
  });

  test("Quick add opens a new invoice from any page", async ({ page }) => {
    await open(page, "dashboard");
    await page.getByRole("button", { name: "Quick add" }).click();
    await page.getByRole("menuitem", { name: "Invoice" }).click();
    await expect(page.locator("dialog")).toContainText("New invoice");
  });
});

test.describe("cash book", () => {
  test("every payment mode moves the right balance, or none", async ({ page }) => {
    const s = sampleV2();
    const before = accountBalances(s);
    await open(page, "cashbook", s);
    const add = async (how, amount, account) => {
      await page.getByRole("button", { name: "Add expense" }).first().click();
      const d = page.locator("dialog");
      await d.getByLabel(/^Amount/).fill(String(amount));
      await d.getByLabel(/^Category/).fill("Rent");
      await d.getByLabel(/^Date/).fill("2026-10-15");
      await d.locator(".seg label", { hasText: how }).click();
      if (account) await d.getByLabel("Account").selectOption(account);
      if (how === "Credit") await d.getByLabel(/^Supplier/).selectOption({ index: 0 });
      await d.getByRole("button", { name: "Save", exact: true }).click();
      await expect(d).toBeHidden();
    };
    await add("Cash", 100, "b3");
    await add("Bank", 200, "b1");
    await add("UPI", 300, "b2");
    const b = accountBalances(await savedData(page));
    expect(b.b3).toBe(before.b3 - 100);
    expect(b.b1).toBe(before.b1 - 200);
    expect(b.b2).toBe(before.b2 - 300);
    await expect(page.locator("tbody")).toContainText("UPI · Savings");
  });

  test("credit needs a client or supplier", async ({ page }) => {
    await open(page, "cashbook");
    await page.getByRole("button", { name: "Add income" }).first().click();
    const d = page.locator("dialog");
    await d.getByLabel(/^Amount/).fill("500");
    await d.getByLabel(/^Category/).fill("Sales");
    await d.locator(".seg label", { hasText: "Credit" }).click();
    await d.getByRole("button", { name: "Save", exact: true }).click();
    await expect(d.getByText("Choose who this is on credit with")).toBeVisible();
    await d.getByLabel(/^Client/).selectOption("c2");
    await d.getByLabel("Due date").fill("2026-12-01");
    await d.getByRole("button", { name: "Save", exact: true }).click();
    await expect(d).toBeHidden();
    const saved = await savedData(page);
    const t = saved.transactions.at(-1);
    expect(t.mode).toBe("credit");
    expect(t.accountId).toBeNull();
    expect(t.due).toBe("2026-12-01");
    expect(accountBalances(saved)).toEqual(accountBalances(sampleV2()));
  });

  test("editing an old unlinked entry doesn't touch any balance", async ({ page }) => {
    const s = migrate(fixture("v1-edge"), { today: TODAY }).state;
    s.profile.onboarded = true;
    const before = accountBalances(s);
    await open(page, "cashbook", s);
    await page.locator("tbody tr", { hasText: "Formula looking" }).getByRole("button", { name: "Edit" }).click();
    const d = page.locator("dialog");
    await expect(d.getByLabel("Account")).toHaveValue("__not-linked");
    await d.getByLabel("Note").fill("Changed only the note");
    await d.getByRole("button", { name: "Save", exact: true }).click();
    await expect(d).toBeHidden();
    const saved = await savedData(page);
    const t = saved.transactions.find((x) => x.id === "k6");
    expect(t.note).toBe("Changed only the note");
    expect(t.untracked).toBe(true);
    expect(accountBalances(saved)).toEqual(before);
    // Choosing an account on purpose does link it.
    await page.locator("tbody tr", { hasText: "Changed only the note" }).getByRole("button", { name: "Edit" }).click();
    await page.locator("dialog").getByLabel("Account").selectOption("bank2");
    await page.locator("dialog").getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("dialog")).toBeHidden();
    const linked = await savedData(page);
    expect(linked.transactions.find((x) => x.id === "k6").untracked).toBe(false);
    expect(accountBalances(linked).bank2).toBe(before.bank2 + 10);
  });

  test("personal spending leaves the account but not the profit", async ({ page }) => {
    const s = sampleV2();
    const before = profitLoss(s, OCT).netProfit;
    await open(page, "cashbook", s);
    await page.getByRole("button", { name: "Add expense" }).first().click();
    const d = page.locator("dialog");
    await d.getByLabel(/^Amount/).fill("700");
    await d.getByLabel(/^Date/).fill("2026-10-20");
    await d.getByLabel(/^Category/).fill("Other");
    await d.getByLabel(/This is personal/).check();
    await d.getByRole("button", { name: "Save", exact: true }).click();
    await expect(d).toBeHidden();
    await expect(page.locator("tbody tr", { hasText: "Personal" })).toBeVisible();
    const saved = await savedData(page);
    expect(profitLoss(saved, OCT).netProfit).toBe(before);
    expect(accountBalances(saved).b3).toBe(accountBalances(s).b3 - 700);
  });

  test("GST included comes out of profit and a new category is remembered", async ({ page }) => {
    const s = sampleV2();
    const before = profitLoss(s, OCT).netProfit;
    await open(page, "cashbook", s);
    await page.getByRole("button", { name: "Add expense" }).first().click();
    const d = page.locator("dialog");
    await d.getByLabel(/^Date/).fill("2026-10-20");
    await d.getByLabel(/^Amount/).fill("1180");
    await d.getByLabel("GST included").fill("180");
    await d.getByLabel(/^Category/).fill("Brand New Category");
    await d.getByRole("button", { name: "Save", exact: true }).click();
    await expect(d).toBeHidden();
    const saved = await savedData(page);
    expect(profitLoss(saved, OCT).netProfit).toBe(before - 1000);
    expect(saved.categories.expense).toContain("Brand New Category");
  });

  test("Save and add another keeps the date and category", async ({ page }) => {
    await open(page, "cashbook");
    await page.getByRole("button", { name: "Add expense" }).first().click();
    const d = page.locator("dialog");
    await d.getByLabel(/^Date/).fill("2026-10-12");
    await d.getByLabel(/^Amount/).fill("50");
    await d.getByLabel(/^Category/).fill("Rent");
    await d.getByRole("button", { name: "Save and add another" }).click();
    await expect(page.locator("dialog").getByLabel(/^Amount/)).toHaveValue("");
    await expect(page.locator("dialog").getByLabel(/^Date/)).toHaveValue("2026-10-12");
    await expect(page.locator("dialog").getByLabel(/^Category/)).toHaveValue("Rent");
  });

  test("an entry from a recurring payment warns it goes back to unpaid", async ({ page }) => {
    await open(page, "cashbook");
    await page.locator("tbody tr", { hasText: "Godown rent" }).getByRole("button", { name: "Delete" }).click();
    const d = page.locator("dialog");
    await expect(d).toContainText("Godown rent for October 2026 goes back to unpaid");
    await d.getByRole("button", { name: "Delete", exact: true }).click();
    const r = (await savedData(page)).recurring.find((x) => x.name === "Godown rent");
    expect(r.paid["2026-10"]).toBeUndefined();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await savedData(page)).recurring.find((x) => x.name === "Godown rent").paid["2026-10"]).toBe("rc1");
  });

  test("CSV export uses the month and protects against formulas", async ({ page }) => {
    const s = sampleV2();
    s.transactions[0].note = "=SUM(A1:A9)";
    await open(page, "cashbook", s);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "CSV" }).click();
    const d = await download;
    expect(d.suggestedFilename()).toBe("cash-book-2026-10.csv");
    expect(readFileSync(await d.path(), "utf8")).toContain("'=SUM(A1:A9)");
  });
});

test.describe("recurring payments", () => {
  test("adding a quarterly one and paying it records it in the cash book", async ({ page }) => {
    await open(page, "recurring");
    await page.getByRole("button", { name: "Add recurring payment" }).first().click();
    const d = page.locator("dialog");
    await d.getByLabel(/^Name/).fill("Water bill");
    await d.getByLabel(/^Category/).fill("Utilities");
    await d.getByLabel(/^Amount/).fill("900");
    await d.getByLabel("How often").selectOption("quarterly");
    await d.getByLabel(/^Due day/).fill("31");
    await d.getByLabel(/It's|varies|changes each time/).check();
    await d.getByRole("button", { name: "Save" }).click();
    const row = page.locator("tbody tr", { hasText: "Water bill" });
    await expect(row).toContainText("Every 3 months");
    await row.getByRole("button", { name: "Pay" }).click();
    const pay = page.locator("dialog");
    await expect(pay).toContainText("This amount varies");
    await pay.getByLabel(/^Amount/).fill("950");
    await pay.getByRole("button", { name: "Mark paid" }).click();
    await expect(page.getByText("Water bill paid and added to the cash book")).toBeVisible();
    const saved = await savedData(page);
    const r = saved.recurring.find((x) => x.name === "Water bill");
    const tx = saved.transactions.find((t) => t.recurringId === r.id);
    expect(tx.amount).toBe(950);
    expect(cycleStatus(r, TODAY).month).toBe("2027-02");
  });

  test("overdue items are flagged, and paying one moves to the next", async ({ page }) => {
    await open(page, "recurring");
    await expect(page.locator("tbody tr", { hasText: "Shop rent" })).toContainText("Overdue 2 days");
    await page.locator("tbody tr", { hasText: "Shop rent" }).getByRole("button", { name: "Pay" }).click();
    await page.locator("dialog").getByRole("button", { name: "Mark paid" }).click();
    await expect(page.locator("tbody tr", { hasText: "Shop rent" })).not.toContainText("Overdue");
    await expect(page.locator("tbody tr", { hasText: "Shop rent" })).toContainText("05 Dec 2026");
  });

  test("pausing hides it from what's due, and it can be resumed", async ({ page }) => {
    await open(page, "recurring");
    const row = () => page.locator("tbody tr", { hasText: "Internet & phone" });
    await row().getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Pause" }).click();
    await expect(row().getByText("Paused")).toBeVisible();
    await expect(row().getByRole("button", { name: "Pay" })).toHaveCount(0);
    await row().getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Resume" }).click();
    await expect(row().getByRole("button", { name: "Pay" })).toBeVisible();
  });

  test("payment history lists what's been paid, and deleting keeps past payments", async ({ page }) => {
    await open(page, "recurring");
    const row = page.locator("tbody tr", { hasText: "Godown rent" });
    await row.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Payment history" }).click();
    await expect(page.locator("dialog")).toContainText("₹12,000");
    await page.locator("dialog").getByRole("button", { name: "Done" }).click();
    await row.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.locator("dialog")).toContainText("Past payments stay in the cash book");
    await page.locator("dialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.locator("tbody tr", { hasText: "Godown rent" })).toHaveCount(0);
    expect((await savedData(page)).transactions.some((t) => t.note === "Godown rent")).toBe(true);
  });

  test("the due-day limits are checked", async ({ page }) => {
    await open(page, "recurring");
    await page.getByRole("button", { name: "Add recurring payment" }).first().click();
    const d = page.locator("dialog");
    await d.getByLabel(/^Due day/).fill("32");
    await d.getByRole("button", { name: "Save" }).click();
    await expect(d.getByText(/can't be more than 31/)).toBeVisible();
  });
});

test.describe("banks and loans", () => {
  test("adding an account and transferring between accounts", async ({ page }) => {
    const s = sampleV2();
    await open(page, "banks", s);
    await page.getByRole("button", { name: "Add account" }).click();
    const d = page.locator("dialog");
    await d.getByLabel(/^Account name/).fill("New Bank");
    await d.getByLabel("Opening balance").fill("1000");
    await d.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("link", { name: "New Bank" })).toBeVisible();
    await page.getByRole("button", { name: "Transfer" }).click();
    const t = page.locator("dialog");
    await t.getByLabel("From").selectOption("b1");
    await t.getByLabel("To", { exact: true }).selectOption("b1");
    await t.getByLabel(/^Amount/).fill("500");
    await t.getByRole("button", { name: "Transfer" }).click();
    await expect(t.getByText("Choose two different accounts")).toBeVisible();
    await t.getByLabel("To", { exact: true }).selectOption("b2");
    await t.getByRole("button", { name: "Transfer" }).click();
    await expect(page.getByText("Transfer saved")).toBeVisible();
    const b = accountBalances(await savedData(page));
    expect(b.b1).toBe(accountBalances(s).b1 - 500);
    expect(b.b2).toBe(accountBalances(s).b2 + 500);
  });

  test("Match balance records an adjustment that doesn't touch profit", async ({ page }) => {
    const s = sampleV2();
    const before = profitLoss(s, { from: TODAY, to: TODAY }).netProfit;
    await open(page, "banks", s);
    await page.getByRole("button", { name: "Match balance" }).first().click();
    const d = page.locator("dialog");
    await d.getByLabel(/^Actual balance/).fill("100");
    await d.getByRole("button", { name: "Adjust" }).click();
    await expect(page.getByText(/Adjusted by/)).toBeVisible();
    const saved = await savedData(page);
    expect(accountBalances(saved).b1).toBe(100);
    expect(saved.transactions.at(-1).category).toBe("Balance adjustment");
    expect(profitLoss(saved, { from: TODAY, to: TODAY }).netProfit).toBe(before);
  });

  test("an account with transactions can't be deleted, only closed, and closed ones leave the form", async ({ page }) => {
    await open(page, "banks");
    await page.getByRole("button", { name: "Delete Savings" }).click();
    const d = page.locator("dialog");
    await expect(d).toContainText("has transactions");
    await expect(d.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
    await d.getByRole("button", { name: "Close account instead" }).click();
    await expect(page.locator(".account-card", { hasText: "Savings" })).toContainText("Closed");
    await page.goto("/index.html#/cashbook");
    await page.getByRole("button", { name: "Add expense" }).first().click();
    await page.locator("dialog").locator(".seg label", { hasText: "Bank" }).click();
    await expect(page.locator("dialog").getByLabel("Account").locator("option")).toHaveText(["Current account"]);
  });

  test("the statement shows a running balance", async ({ page }) => {
    const s = sampleV2();
    await open(page, "banks/b2", s);
    await expect(page.locator("h1")).toHaveText("Savings");
    const balance = accountBalances(s).b2;
    await expect(page.locator(".kpis")).toContainText("₹85,000");
    await expect(page.locator(".kpis")).toContainText(formatMoney(balance));
    await expect(page.locator("tbody tr").last()).toContainText(formatMoney(balance, "INR", { decimals: 2 }));
  });

  test("activity lists movements, filters by account, and a transfer can be deleted", async ({ page }) => {
    await open(page, "banks/activity");
    await expect(page.locator("tbody")).toContainText("Invoice ST-001");
    await page.getByLabel("All accounts").selectOption("b2");
    await expect(page.locator("tbody")).not.toContainText("Invoice ST-001");
    await page.getByLabel("All accounts").selectOption("b3");
    await page.locator("tbody tr", { hasText: "Transfer to" }).getByRole("button", { name: "Delete transfer" }).click();
    const d = page.locator("dialog");
    await expect(d).toContainText("Cash in hand balance goes up by ₹1,50,000");
    await expect(d).toContainText("Current account balance goes down by ₹1,50,000");
  });

  test("older unlinked entries are explained", async ({ page }) => {
    const s = migrate(fixture("v1-edge"), { today: TODAY }).state;
    s.profile.onboarded = true;
    await open(page, "banks", s);
    await expect(page.getByText(/older entries aren't linked to any account/)).toBeVisible();
  });

  test("a loan payment splits interest from principal, and only interest counts against profit", async ({ page }) => {
    const s = sampleV2();
    const before = profitLoss(s, { from: TODAY, to: TODAY }).netProfit;
    await open(page, "banks/loans", s);
    const row = page.locator("tbody tr", { hasText: "Delivery van loan" });
    await row.getByRole("button", { name: "Pay" }).click();
    const d = page.locator("dialog");
    await expect(d.getByLabel(/^Amount paid/)).toHaveValue("18500");
    await d.getByLabel("Of which interest").fill("99999");
    await d.getByRole("button", { name: "Save payment" }).click();
    await expect(d.getByText("Interest can't be more than the amount paid")).toBeVisible();
    await d.getByLabel("Of which interest").fill("3500");
    await d.getByRole("button", { name: "Save payment" }).click();
    await expect(page.getByText("Payment saved")).toBeVisible();
    const saved = await savedData(page);
    const loan = saved.loans[0];
    expect(loanOutstanding(loan)).toBe(loanOutstanding(s.loans[0]) - 15000);
    expect(profitLoss(saved, { from: TODAY, to: TODAY }).loanInterest).toBe(3500);
    expect(profitLoss(saved, { from: TODAY, to: TODAY }).netProfit).toBe(before - 3500);
  });

  test("a new loan saves, and paying it off closes it", async ({ page }) => {
    await open(page, "banks/loans");
    await page.getByRole("button", { name: "Add loan" }).first().click();
    const d = page.locator("dialog");
    await d.getByLabel(/^Loan name/).fill("Small loan");
    await d.getByLabel(/^Left to repay/).fill("1000");
    await d.getByLabel(/^Interest rate/).fill("12");
    await d.getByLabel(/^EMI$/).fill("1000");
    await d.getByRole("button", { name: "Save" }).click();
    const row = () => page.locator("tbody tr", { hasText: "Small loan" });
    await row().getByRole("button", { name: "Pay" }).click();
    const pay = page.locator("dialog");
    await expect(pay.getByLabel("Of which interest")).toHaveValue("10");
    await pay.getByLabel("Of which interest").fill("0");
    await pay.getByRole("button", { name: "Save payment" }).click();
    await expect(page.getByText("Small loan is fully repaid")).toBeVisible();
    await expect(row().getByText("Closed")).toBeVisible();
    await expect(row().getByRole("button", { name: "Pay" })).toHaveCount(0);
  });
});

test.describe("regressions the review caught", () => {
  test("a saved logo survives saving Settings", async ({ page }) => {
    const s = sampleV2();
    s.profile.logo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/AAAMBAQAY3Y2wAAAAAElFTkSuQmCC";
    await open(page, "settings", s);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Business details saved")).toBeVisible();
    expect((await savedData(page)).profile.logo).toBe(s.profile.logo);
  });

  test("one click opens one form, however many times a page has re-rendered", async ({ page }) => {
    await open(page, "cashbook");
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: "Previous month" }).click();
      await page.getByRole("button", { name: "Next month" }).click();
    }
    await page.getByRole("button", { name: "Add expense" }).first().click();
    await expect(page.locator("dialog")).toHaveCount(1);
  });
});
