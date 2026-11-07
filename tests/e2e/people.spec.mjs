// Staff, attendance, the pay sheet, the salary sheet, payslips and advances.
import { readFileSync } from "node:fs";
import { test, expect, fixture, sampleV2, savedData, seed, watchPage } from "./helpers.mjs";
import { accountBalances } from "../../js/core/ledger.js";
import { payFor } from "../../js/core/payroll.js";

const open = async (page, path, data = sampleV2()) => {
  await seed(page, { data });
  await page.goto(`/index.html#/${path}`);
  await expect(page.locator("#page-title")).toBeVisible();
};

test.describe("staff", () => {
  test("adding someone validates first, then saves them", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "staff");
    await page.getByRole("button", { name: "Add staff" }).first().click();
    const dialog = page.locator("dialog");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByText("Full name is required")).toBeVisible();
    await dialog.getByLabel(/^Monthly salary/).fill("");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByText("Monthly salary is required")).toBeVisible();
    await dialog.getByLabel(/^Full name/).fill("New Person");
    await dialog.getByLabel(/^Monthly salary/).fill("18,000");
    await dialog.getByLabel("IFSC").fill("bad");
    await expect(dialog.getByText("An IFSC is 11 characters")).toBeVisible();
    await dialog.getByLabel("IFSC").fill("SBIN0001234");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("link", { name: "New Person" })).toBeVisible();
    const person = (await savedData(page)).staff.find((s) => s.name === "New Person");
    expect(person.salary).toBe(18000);
    expect(person.active).toBe(true);
    expect(problems).toEqual([]);
  });

  test("a duplicate staff code is refused", async ({ page }) => {
    const s = sampleV2();
    s.staff[0].code = "E001";
    await open(page, "staff", s);
    await page.getByRole("button", { name: "Add staff" }).first().click();
    const dialog = page.locator("dialog");
    await dialog.getByLabel("Staff code").fill("e001");
    await dialog.getByLabel(/^Full name/).fill("X");
    await dialog.getByLabel(/^Monthly salary/).fill("1");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByText("This code is already in use")).toBeVisible();
  });

  test("deleting warns what goes with them, and Undo brings everything back", async ({ page }) => {
    await open(page, "staff");
    const before = await page.evaluate(() => localStorage.getItem("accounts-manager:data"));
    await page.locator("tbody tr", { hasText: "Suresh P" }).getByRole("button", { name: "Delete" }).click();
    const dialog = page.locator("dialog");
    await expect(dialog).toContainText("Delete Suresh P?");
    await expect(dialog).toContainText("1 month of pay records");
    await expect(dialog).toContainText("1 salary payment");
    await expect(dialog).toContainText("Current account balance goes up");
    await expect(dialog.getByRole("button", { name: "Mark inactive instead" })).toBeVisible();
    await dialog.getByRole("button", { name: "Delete everything" }).click();
    await expect(page.getByRole("link", { name: "Suresh P" })).toHaveCount(0);
    expect((await savedData(page)).bin).toHaveLength(1);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("link", { name: "Suresh P" })).toBeVisible();
    const after = await savedData(page);
    expect(after).toEqual(JSON.parse(before));
  });

  test("marking someone inactive keeps their history and takes them off new sheets", async ({ page }) => {
    const s = sampleV2();
    await open(page, "staff", s);
    await page.locator("tbody tr", { hasText: "Biju Thomas" }).getByRole("button", { name: "Delete" }).click();
    await page.locator("dialog").getByRole("button", { name: "Mark inactive instead" }).click();
    await expect(page.locator("tbody tr", { hasText: "Biju Thomas" }).getByText("Inactive")).toBeVisible();
    const saved = await savedData(page);
    expect(saved.staff.find((x) => x.name === "Biju Thomas").active).toBe(false);
    expect(saved.bin).toHaveLength(0);
    expect(saved.advances.some((a) => a.staffId === "g3")).toBe(true);
  });

  test("a CSV import shows a preview first, and can be undone", async ({ page }) => {
    await open(page, "staff");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import CSV" }).click();
    await (await chooser).setFiles({ name: "staff.csv", mimeType: "text/csv", buffer: readFileSync("sample/staff.csv") });
    const dialog = page.locator("dialog");
    await expect(dialog).toContainText("Import 4 people?");
    await expect(dialog).toContainText("4 names are already on your staff list");
    await expect(dialog.locator("tbody tr", { hasText: "Anitha M" })).toHaveCount(1);
    await dialog.getByRole("button", { name: "Import 4" }).click();
    await expect(page.getByText("Imported 4 people")).toBeVisible();
    expect((await savedData(page)).staff).toHaveLength(12);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await savedData(page)).staff.length).toBe(8);
  });

  test("the CSV template downloads", async ({ page }) => {
    await open(page, "staff");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "CSV template" }).click();
    expect((await download).suggestedFilename()).toBe("staff-template.csv");
  });

  test("the detail page shows history, and handles someone who doesn't exist", async ({ page }) => {
    await open(page, "staff/g0");
    await expect(page.locator("h1")).toHaveText("Rajesh K");
    await expect(page.locator("[data-pay-table]")).toContainText("October 2026");
    await expect(page.locator("[data-advance-table]")).toContainText("₹2,000");
    await page.goto("/index.html#/staff/nobody");
    await expect(page.locator("h1")).toHaveText("Staff member not found");
  });

  test("a name with markup stays plain text everywhere", async ({ page }) => {
    const s = sampleV2();
    s.staff[0].name = '<img src=x onerror="window.hacked=1">Evil';
    await open(page, "staff", s);
    await expect(page.getByRole("link", { name: /Evil/ })).toBeVisible();
    await page.goto("/index.html#/salary");
    await expect(page.locator("#page-title")).toBeVisible();
    await page.goto("/index.html#/attendance");
    await expect(page.locator("#page-title")).toBeVisible();
    expect(await page.evaluate(() => window.hacked)).toBeUndefined();
    expect(await page.locator('img[src="x"]').count()).toBe(0);
  });
});

test.describe("attendance", () => {
  test("marks cycle on click, and days worked feed into pay", async ({ page, isMobile }) => {
    test.skip(isMobile, "the phone view has its own test");
    const s = sampleV2();
    s.entries["2026-10"].g2.daysWorked = "";
    await open(page, "attendance", s);
    const row = page.locator('tr[data-staff="g2"]');
    const day1 = row.locator('[data-day="1"]');
    await day1.click();
    await expect(day1).toHaveText("P");
    await expect(day1).toHaveAttribute("aria-label", /Anitha M, Thursday 1: Present/);
    await day1.click();
    await expect(day1).toHaveText("H");
    await expect(row.locator("[data-total]")).toHaveText("0.5");
    await row.locator('[data-day="2"]').click();
    await expect(row.locator("[data-total]")).toHaveText("1.5");
    const saved = await savedData(page);
    expect(saved.attendance["2026-10"].g2).toEqual({ "01": "H", "02": "P" });
    expect(payFor(saved, saved.staff[2], "2026-10").days).toBe(1.5);
  });

  test("a whole month fits at 1440px without sideways scrolling", async ({ page, isMobile }) => {
    test.skip(isMobile, "the desktop grid");
    await open(page, "attendance");
    const fits = await page.evaluate(() => { const w = document.querySelector(".att-desktop"); return w.scrollWidth <= w.clientWidth; });
    expect(fits).toBe(true);
    await expect(page.locator('tr[data-staff="g0"] [data-total]')).toBeInViewport();
  });

  test("the keyboard marks and moves around the grid", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard use is for desktop");
    const s = sampleV2();
    await open(page, "attendance", s);
    const first = page.locator('tr[data-staff="g0"] [data-day="1"]');
    await first.focus();
    await page.keyboard.press("p");
    await expect(first).toHaveText("P");
    await expect(page.locator('tr[data-staff="g0"] [data-day="2"]')).toBeFocused();
    await page.keyboard.press("a");
    await expect(page.locator('tr[data-staff="g0"] [data-day="2"]')).toHaveText("A");
    await page.keyboard.press("ArrowDown");
    await expect(page.locator('tr[data-staff="g1"] [data-day="3"]')).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Delete");
    await expect(page.locator('tr[data-staff="g0"] [data-day="2"]')).toHaveText("");
  });

  test("a typed figure wins over marks, and the grid says so", async ({ page, isMobile }) => {
    test.skip(isMobile, "the desktop grid");
    await open(page, "attendance");
    const row = page.locator('tr[data-staff="g0"]');
    await row.locator('[data-day="1"]').click();
    await expect(row.locator("[data-total]")).toContainText("31");
    await expect(row.locator("[data-total]")).toContainText("typed");
  });

  test("filling the month only touches unmarked days, and can be undone", async ({ page, isMobile }) => {
    test.skip(isMobile, "the desktop grid");
    const s = sampleV2();
    s.attendance["2026-10"] = { g0: { "03": "A" } };
    await open(page, "attendance", s);
    await page.getByRole("button", { name: "Mark unmarked days present" }).click();
    await expect(page.getByText(/days marked/)).toBeVisible();
    const saved = await savedData(page);
    expect(saved.attendance["2026-10"].g0["03"]).toBe("A");
    expect(saved.attendance["2026-10"].g0["04"]).toBe("P");
    expect(Object.keys(saved.attendance["2026-10"].g1)).toHaveLength(31);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await savedData(page)).attendance["2026-10"]).toEqual({ g0: { "03": "A" } });
  });

  test("the team filter narrows the grid and is remembered", async ({ page, isMobile }) => {
    test.skip(isMobile, "the desktop grid");
    await open(page, "attendance");
    await page.getByLabel("Team").selectOption("Delivery");
    await expect(page.locator("tr[data-staff]")).toHaveCount(2);
    await page.goto("/index.html#/attendance/pay");
    await expect(page.locator("tr[data-staff]")).toHaveCount(2);
  });

  test("phones show one person at a time as a calendar", async ({ page, isMobile }) => {
    test.skip(!isMobile, "phone layout");
    const s = sampleV2();
    s.entries["2026-10"].g0.daysWorked = "";
    await open(page, "attendance", s);
    await expect(page.locator(".att-desktop")).toBeHidden();
    const cal = page.locator(".att-phone");
    await expect(cal).toContainText("Rajesh K");
    await cal.locator('[data-cal-day="5"]').click();
    await expect(cal.locator('[data-cal-day="5"]')).toContainText("P");
    await expect(cal).toContainText("Present 1");
    await cal.getByRole("button", { name: "Next person" }).click();
    await expect(cal).toContainText("Suresh P");
    await expect(cal.getByRole("button", { name: "Previous person" })).toBeEnabled();
    expect((await savedData(page)).attendance["2026-10"].g0["05"]).toBe("P");
  });
});

test.describe("pay sheet", () => {
  test("net pay updates as you type, and saves", async ({ page }) => {
    await open(page, "attendance/pay");
    const row = page.locator('tr[data-staff="g1"]');
    const days = row.getByLabel("Days worked for Suresh P");
    await expect(row.locator("[data-net]")).toContainText("₹12,000");
    await days.fill("15");
    await expect(row.locator("[data-net]")).toContainText("₹4,500");
    await expect(days).toHaveValue("15");
    await expect(days).toBeFocused();
    await row.getByLabel("Bonus for Suresh P").fill("500");
    await expect(row.locator("[data-net]")).toContainText("₹5,000");
    const saved = await savedData(page);
    expect(saved.entries["2026-10"].g1.daysWorked).toBe(15);
    expect(saved.entries["2026-10"].g1.bonus).toBe(500);
  });

  test("logged advances show under the box and come off pay", async ({ page }) => {
    await open(page, "attendance/pay");
    const row = page.locator('tr[data-staff="g0"]');
    await expect(row).toContainText("+₹4,000 logged");
    await row.getByLabel("Advance for Rajesh K").fill("1000");
    const saved = await savedData(page);
    expect(payFor(saved, saved.staff[0], "2026-10").advance).toBe(5000);
  });

  test("a bad figure is flagged and isn't saved", async ({ page }) => {
    await open(page, "attendance/pay");
    const input = page.getByLabel("Bonus for Rajesh K");
    await input.fill("abc");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    expect((await savedData(page) ?? sampleV2()).entries["2026-10"].g0.bonus).toBe("");
    await input.fill("10");
    await expect(input).not.toHaveAttribute("aria-invalid");
  });

  test("Fill full month skips people with days or attendance", async ({ page }) => {
    const s = sampleV2();
    s.settings.pay.basis = "26";
    s.entries["2026-10"].g2.daysWorked = "";
    s.entries["2026-10"].g3.daysWorked = "";
    s.attendance["2026-10"] = { g3: { "01": "P" } };
    await open(page, "attendance/pay", s);
    await page.getByRole("button", { name: "Fill full month" }).click();
    await expect(page.getByText("Filled 26 days for 1 person")).toBeVisible();
    const saved = await savedData(page);
    expect(saved.entries["2026-10"].g2.daysWorked).toBe(26);
    expect(saved.entries["2026-10"].g3.daysWorked).toBe("");
    expect(saved.entries["2026-10"].g0.daysWorked).toBe(31);
  });

  test("the arrow keys and Enter move between rows", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard use is for desktop");
    await open(page, "attendance/pay");
    await page.getByLabel("Bonus for Rajesh K").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Bonus for Suresh P")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByLabel("Bonus for Rajesh K")).toBeFocused();
  });
});

test.describe("salary sheet", () => {
  test("figures match what v1 calculated", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "salary");
    const kpis = page.locator(".kpis");
    await expect(kpis).toContainText("₹1,04,871");
    await expect(kpis).toContainText("₹49,771");
    await expect(page.locator("tfoot")).toContainText("₹71,771");
    await expect(page.locator("tbody tr", { hasText: "Suresh P" })).toContainText("Paid 02 Nov 2026");
    expect(problems).toEqual([]);
  });

  test("marking one person paid moves money, and undoing it moves it back", async ({ page }) => {
    const s = sampleV2();
    const before = accountBalances(s).b2;
    await open(page, "salary", s);
    const row = page.locator("tbody tr", { hasText: "Anitha M" });
    await row.getByRole("button", { name: "Pay" }).click();
    const dialog = page.locator("dialog");
    await dialog.locator(".seg label", { hasText: "Bank" }).click();
    await dialog.getByLabel("Account").selectOption("b2");
    await dialog.getByRole("button", { name: "Mark paid" }).click();
    await expect(page.getByText("Anitha M marked paid")).toBeVisible();
    await expect(page.locator("tbody tr", { hasText: "Anitha M" }).getByText(/^Paid/)).toBeVisible();
    let saved = await savedData(page);
    const paid = saved.salaryPayments.find((p) => p.staffId === "g2");
    expect(paid.mode).toBe("bank");
    expect(accountBalances(saved).b2).toBe(before - paid.amount);
    await page.locator("tbody tr", { hasText: "Anitha M" }).getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Undo payment" }).click();
    const warn = page.locator("dialog");
    await expect(warn).toContainText("goes back to unpaid");
    await warn.getByRole("button", { name: "Undo payment" }).click();
    await expect(page.locator("tbody tr", { hasText: "Anitha M" }).getByRole("button", { name: "Pay" })).toBeVisible();
    saved = await savedData(page);
    expect(accountBalances(saved).b2).toBe(before);
  });

  test("salary can't be recorded on credit", async ({ page }) => {
    await open(page, "salary");
    await page.locator("tbody tr", { hasText: "Anitha M" }).getByRole("button", { name: "Pay" }).click();
    const dialog = page.locator("dialog");
    await expect(dialog.locator(".seg label")).toHaveText(["Cash", "Bank", "UPI"]);
  });

  test("holding pay leaves it out of what's due, and releasing brings it back", async ({ page }) => {
    await open(page, "salary");
    const row = () => page.locator("tbody tr", { hasText: "Anitha M" });
    await row().getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Put on hold" }).click();
    await expect(row().getByText("On hold")).toBeVisible();
    await expect(page.locator(".kpis")).toContainText("on hold");
    await row().getByRole("button", { name: "Release" }).click();
    await expect(row().getByRole("button", { name: "Pay" })).toBeVisible();
  });

  test("Mark all paid pays only those waiting", async ({ page }) => {
    await open(page, "salary");
    await page.getByRole("button", { name: "Mark all paid" }).click();
    const dialog = page.locator("dialog");
    await expect(dialog).toContainText("Mark 6 salaries paid");
    await expect(dialog).toContainText("₹49,771");
    await dialog.getByRole("button", { name: "Mark paid" }).click();
    await expect(page.getByText("6 salaries marked paid")).toBeVisible();
    expect((await savedData(page)).salaryPayments).toHaveLength(8);
    await page.getByRole("button", { name: "Mark all paid" }).click();
    await expect(page.getByText("Nobody is waiting to be paid")).toBeVisible();
  });

  test("exports download with the right content", async ({ page }) => {
    await open(page, "salary");
    const grab = async (name) => {
      await page.getByRole("button", { name: "Export" }).click();
      const download = page.waitForEvent("download");
      await page.getByRole("menuitem", { name }).click();
      const d = await download;
      return { file: d.suggestedFilename(), text: readFileSync(await d.path(), "utf8") };
    };
    const sheet = await grab("Salary sheet (CSV)");
    expect(sheet.file).toBe("salary-sheet-2026-10.csv");
    expect(sheet.text).toContain("TOTAL");
    expect(sheet.text).toContain("71771");
    const payout = await grab("Bank payout list (CSV)");
    expect(payout.file).toBe("payout-list-2026-10.csv");
    expect(payout.text).toContain("Rajesh K");
    expect(payout.text).not.toContain("Suresh P");
  });

  test("the WhatsApp summary is copied, or offered to copy by hand", async ({ page, context, browserName }) => {
    await open(page, "salary");
    await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("blocked")) }, configurable: true }); });
    await page.getByRole("button", { name: "Export" }).click();
    await page.getByRole("menuitem", { name: "Copy WhatsApp summary" }).click();
    const box = page.locator("dialog textarea");
    await expect(box).toBeVisible();
    await expect(box).toHaveValue(/Total net: \*₹71,771\* for 8 staff/);
  });

  test("payslips print on a clean white page, one per person", async ({ page, isMobile }) => {
    await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
    await open(page, "salary");
    await page.getByRole("button", { name: "Print payslips" }).click();
    expect(await page.evaluate(() => window.__printed)).toBe(1);
    await expect(page.locator("#print-root .doc")).toHaveCount(8);
    await expect(page.locator("#print-root .doc").first()).toContainText("Rajesh K");
    await expect(page.locator("#print-root .doc").first()).toContainText("Rupees");
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".app")).toBeHidden();
    await expect(page.locator("#print-root")).toBeVisible();
    if (!isMobile) {
      const pdf = await page.pdf({ format: "A4" });
      expect(pdf.length).toBeGreaterThan(5000);
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    }
  });

  test("columns that are zero for everyone are left out, and return when they have figures", async ({ page, isMobile }) => {
    test.skip(isMobile, "phones show cards instead of columns");
    await open(page, "salary");
    const headers = page.locator("thead th");
    await expect(headers.filter({ hasText: "Extra" })).toHaveCount(1);
    await expect(headers.filter({ hasText: "Bonus" })).toHaveCount(0);
    await expect(headers.filter({ hasText: "ESI" })).toHaveCount(0);
    const fits = await page.evaluate(() => { const w = document.querySelector(".table-wrap"); return w.scrollWidth <= w.clientWidth; });
    expect(fits, "the sheet should fit without sideways scrolling").toBe(true);
  });

  test("phone cards hide lines that are zero", async ({ page, isMobile }) => {
    test.skip(!isMobile, "phone layout");
    await open(page, "salary");
    const card = page.locator("tbody tr", { hasText: "Sreeja R" });
    await expect(card.locator('td[data-label="Earned"]')).toBeVisible();
    await expect(card.locator('td[data-label="Advance"]')).toBeHidden();
    await expect(card.locator('td[data-label="Food"]')).toBeHidden();
  });

  test("someone whose deductions exceed their pay is flagged and not paid", async ({ page }) => {
    const s = sampleV2();
    s.entries["2026-10"].g2.advance = 100000;
    await open(page, "salary", s);
    await expect(page.getByText("Anitha M owes you money")).toBeVisible();
    await expect(page.locator("tbody tr", { hasText: "Anitha M" }).getByText("Nothing to pay")).toBeVisible();
  });
});

test.describe("advances", () => {
  test("recording one takes it off that month's pay, and moves money", async ({ page }) => {
    const s = sampleV2();
    const netBefore = payFor(s, s.staff[1], "2026-10").net;
    await open(page, "advances", s);
    await page.getByRole("button", { name: "Record advance" }).first().click();
    const dialog = page.locator("dialog");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByText("Staff is required")).toBeVisible();
    await dialog.getByLabel(/^Staff/).selectOption("g1");
    await dialog.getByLabel(/^Date/).fill("2026-10-20");
    await dialog.getByLabel(/^Amount/).fill("1500");
    await dialog.locator(".seg label", { hasText: "Cash" }).click();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("It comes off October 2026 pay")).toBeVisible();
    await expect(page.locator("tbody tr", { hasText: "Suresh P" })).toContainText("₹1,500");
    const saved = await savedData(page);
    expect(payFor(saved, saved.staff[1], "2026-10").net).toBe(netBefore - 1500);
    expect(saved.advances.at(-1).mode).toBe("cash");
    expect(saved.advances.at(-1).accountId).toBe("b3");
  });

  test("an older unlinked advance can be edited without losing anything else", async ({ page }) => {
    await open(page, "advances");
    await page.locator("tbody tr", { hasText: "Biju Thomas" }).getByRole("button", { name: "Edit" }).click();
    const dialog = page.locator("dialog");
    await expect(dialog.getByLabel(/^Amount/)).toHaveValue("3000");
    await dialog.getByLabel(/^Amount/).fill("3500");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("tbody tr", { hasText: "Biju Thomas" })).toContainText("₹3,500");
  });

  test("deleting says whose pay goes up, and Undo reverses it", async ({ page }) => {
    await open(page, "advances");
    await page.locator("tbody tr", { hasText: "Biju Thomas" }).getByRole("button", { name: "Delete" }).click();
    const dialog = page.locator("dialog");
    await expect(dialog).toContainText("Biju Thomas's pay for October 2026 goes up by ₹3,000");
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.locator("tbody tr", { hasText: "Biju Thomas" })).toHaveCount(0);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("tbody tr", { hasText: "Biju Thomas" })).toBeVisible();
  });

  test("the N key opens the add form, and the page explains an empty month", async ({ page, isMobile }) => {
    await open(page, "advances");
    await page.getByRole("button", { name: "Next month" }).click();
    await expect(page.getByText("No advances in November 2026")).toBeVisible();
    if (isMobile) return;
    await page.locator("#page-title").click();
    await page.keyboard.press("n");
    await expect(page.locator("dialog")).toContainText("Record advance");
  });
});

test("a person's whole history survives a delete and restore from the bin page", async ({ page }) => {
  const original = sampleV2();
  await open(page, "staff", original);
  await page.locator("tbody tr", { hasText: "Rajesh K" }).getByRole("button", { name: "Delete" }).click();
  await page.locator("dialog").getByRole("button", { name: "Delete everything" }).click();
  await page.goto("/index.html#/recycle-bin");
  await page.locator("tbody tr", { hasText: "Rajesh K" }).getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("Restored")).toBeVisible();
  const saved = await savedData(page);
  expect(saved.staff.find((s) => s.id === "g0")).toEqual(original.staff[0]);
  expect(saved.entries["2026-10"].g0).toEqual(original.entries["2026-10"].g0);
  expect(saved.advances.filter((a) => a.staffId === "g0")).toHaveLength(2);
  expect(fixture("v1-sample").guards[0].name).toBe("Rajesh K");
});
