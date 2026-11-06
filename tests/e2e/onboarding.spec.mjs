// First visits, upgrades, Settings, backup and sample mode.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fixture, sampleV2, savedData, seed, TODAY, watchPage } from "./helpers.mjs";

test.describe("a new visitor", () => {
  test("sees the welcome screen, gets categories for their business, and is never asked again", async ({ page }) => {
    const problems = watchPage(page);
    await page.goto("/index.html");
    await expect(page.locator("h1")).toHaveText("Welcome to Accounts Manager");
    await page.getByRole("button", { name: "Get started" }).click();
    await expect(page.getByText("Business name is required")).toBeVisible();
    await expect(page.getByText("Type of business is required")).toBeVisible();
    await expect(page.getByLabel(/^Business name/)).toBeFocused();
    await page.getByLabel(/^Business name/).fill("Hilltop Clinic");
    await page.getByLabel(/^Type of business/).selectOption("clinic");
    await page.getByRole("button", { name: "Get started" }).click();
    await expect(page.locator("h1")).toHaveText("Dashboard");
    const s = await savedData(page);
    expect(s.profile.name).toBe("Hilltop Clinic");
    expect(s.profile.onboarded).toBe(true);
    expect(s.categories.expense).toContain("Medicines");
    expect(s.categories.income).toContain("Consultation");
    expect(s.categories.units).toContain("vial");
    expect(s.settings.modules.stock).toBe(true);
    await page.reload();
    await expect(page.locator("h1")).toHaveText("Dashboard");
    expect(problems).toEqual([]);
  });

  test("choosing Other asks for a description, and a bad GSTIN warns without blocking", async ({ page }) => {
    await page.goto("/index.html");
    const other = page.getByLabel("Describe your business");
    await expect(other).toBeHidden();
    await page.getByLabel(/^Business name/).fill("Photo Studio");
    await page.getByLabel(/^Type of business/).selectOption("other");
    await expect(other).toBeVisible();
    await other.fill("Wedding photography");
    await page.getByLabel("GSTIN").fill("27AAPFU0939F1ZA");
    await expect(page.getByText("doesn't match")).toBeVisible();
    await page.getByLabel("Financial year starts in").selectOption("1");
    await page.getByLabel("Currency").selectOption("USD");
    await page.getByRole("button", { name: "Get started" }).click();
    await expect(page.locator("h1")).toHaveText("Dashboard");
    await expect(page.locator(".kpis")).toContainText("$0");
    const s = await savedData(page);
    expect(s.profile.typeOther).toBe("Wedding photography");
    expect(s.profile.gstin).toBe("27AAPFU0939F1ZA");
    expect(s.profile.stateCode).toBe("27");
    expect(s.profile.fyStartMonth).toBe(1);
    expect(s.settings.modules.stock).toBe(false);
  });

  test("a logo is shrunk before it's saved, and shows in the app", async ({ page }) => {
    await page.goto("/index.html");
    await page.getByLabel(/^Business name/).fill("Logo Test");
    await page.getByLabel(/^Type of business/).selectOption("retail");
    const png = await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 1200; c.height = 800;
      const g = c.getContext("2d");
      for (let i = 0; i < 4000; i++) { g.fillStyle = `hsl(${i % 360} 80% 50%)`; g.fillRect(Math.random() * 1200, Math.random() * 800, 9, 9); }
      return c.toDataURL("image/png").split(",")[1];
    });
    await page.locator("[data-logo-input]").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
    await expect(page.getByRole("img", { name: "Your logo" })).toBeVisible();
    await page.getByRole("button", { name: "Get started" }).click();
    await expect(page.locator("h1")).toHaveText("Dashboard");
    const logo = (await savedData(page)).profile.logo;
    expect(logo.startsWith("data:image/")).toBe(true);
    expect(logo.length).toBeLessThan(140_000);
    const size = await page.evaluate((src) => new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(Math.max(i.naturalWidth, i.naturalHeight)); i.src = src; }), logo);
    expect(size).toBeLessThanOrEqual(256);
    await expect(page.locator(".brand-mark, .topbar-brand img").first()).toHaveAttribute("src", logo);
  });

  test("a file that isn't an image gets a clear message", async ({ page }) => {
    await page.goto("/index.html");
    await page.locator("[data-logo-input]").setInputFiles({ name: "evil.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg></svg>") });
    await expect(page.getByText("Please choose a PNG, JPEG or WebP image")).toBeVisible();
  });
});

test.describe("an upgrading user", () => {
  test("is told what changed, can skip the profile, and isn't asked again", async ({ page }) => {
    const problems = watchPage(page);
    await seed(page, { v1: fixture("v1-sample") });
    await page.goto("/index.html");
    await expect(page.locator("h1")).toHaveText("Your accounts have been upgraded");
    await expect(page.getByText("Your profit figure may look different")).toBeVisible();
    await expect(page.getByLabel(/^Business name/)).toHaveValue("Sample Traders");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download a copy of your old data" }).click();
    expect((await download).suggestedFilename()).toBe("accounts-manager-old-data.json");
    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page.locator("h1")).toHaveText("Dashboard");
    await expect(page.locator(".kpis")).toContainText("₹8,34,481");
    await page.reload();
    await expect(page.locator("h1")).toHaveText("Dashboard");
    expect(problems).toEqual([]);
  });

  test("completing the profile only adds categories, never removes any", async ({ page }) => {
    await seed(page, { v1: fixture("v1-sample") });
    await page.goto("/index.html");
    await page.getByLabel(/^Type of business/).selectOption("restaurant");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page.locator("h1")).toHaveText("Dashboard");
    const s = await savedData(page);
    expect(s.categories.expense).toContain("Stock purchase");
    expect(s.categories.expense).toContain("Raw materials");
    expect(s.settings.modules.stock).toBe(false);
    expect(s.staff).toHaveLength(8);
    expect(s.profile.gstin).toBe("32ABCDE1234F1Z5");
  });

  test("a failed upgrade check leaves their data alone and offers a download", async ({ page }) => {
    const bad = fixture("v1-sample");
    bad.settings.basis = "nonsense";
    await seed(page, { v1: bad });
    await page.goto("/index.html");
    await expect(page.locator("h1")).toHaveText("Your data is safe");
    expect(await page.evaluate(() => localStorage.getItem("accounts-manager:data"))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem("accounts-manager:v1"))).toBe(JSON.stringify(bad));
  });
});

test.describe("sample mode", () => {
  test("starts from the welcome screen, shows a banner, and leaves no trace", async ({ page }) => {
    await page.goto("/index.html");
    await page.getByRole("button", { name: "Explore with sample data" }).click();
    await expect(page.locator("h1")).toHaveText("Dashboard");
    await expect(page.getByText("You're exploring sample data")).toBeVisible();
    await expect(page.locator(".kpis")).toContainText("₹");
    await page.reload();
    await expect(page.getByText("You're exploring sample data")).toBeVisible();
    await page.getByRole("button", { name: "Exit sample data" }).click();
    await expect(page.locator("h1")).toHaveText("Welcome to Accounts Manager");
    expect(await page.evaluate(() => localStorage.getItem("accounts-manager:sample"))).toBeNull();
  });

  test("real data is untouched by entering and leaving", async ({ page }) => {
    const real = sampleV2();
    real.profile.name = "My Real Shop";
    await seed(page, { data: real });
    await page.goto("/index.html#/settings/data");
    const before = await page.evaluate(() => localStorage.getItem("accounts-manager:data"));
    await page.getByRole("button", { name: "Explore sample data" }).click();
    await expect(page.getByText("You're exploring sample data")).toBeVisible();
    await expect(page.locator("[data-brand]")).toContainText("Sunrise Traders");
    expect(await page.evaluate(() => localStorage.getItem("accounts-manager:data"))).toBe(before);
    await page.getByRole("button", { name: "Exit sample data" }).first().click();
    await expect(page.locator("[data-brand]")).toContainText("My Real Shop");
    expect(await page.evaluate(() => localStorage.getItem("accounts-manager:data"))).toBe(before);
  });
});

test.describe("Settings", () => {
  test("business details save, and a new type offers extra categories without removing any", async ({ page }) => {
    await seed(page, { data: sampleV2() });
    await page.goto("/index.html#/settings");
    await page.getByLabel(/^Business name/).fill("Renamed Traders");
    await page.getByLabel(/^Type of business/).selectOption("clinic");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Business details saved")).toBeVisible();
    await expect(page.locator("[data-brand]")).toContainText("Renamed Traders");
    const s = await savedData(page);
    expect(s.categories.expense).toContain("Medicines");
    expect(s.categories.expense).toContain("Stock purchase");
  });

  test("payroll settings save and the example updates", async ({ page }) => {
    await seed(page, { data: sampleV2() });
    await page.goto("/index.html#/settings/payroll");
    await expect(page.getByText("₹483.87 a day")).toBeVisible();
    await page.getByLabel("Pay basis").selectOption("30");
    await expect(page.getByText("₹500.00 a day")).toBeVisible();
    await page.getByLabel(/Deduct PF/).check();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Payroll settings saved")).toBeVisible();
    const s = await savedData(page);
    expect(s.settings.pay.basis).toBe("30");
    expect(s.settings.pay.pf).toBe(true);
  });

  test("invoice settings save, including where UPI money goes", async ({ page }) => {
    await seed(page, { data: sampleV2() });
    await page.goto("/index.html#/settings/invoices");
    await page.getByLabel("Invoice number prefix").fill("NEW-");
    await page.getByLabel("UPI money goes to").selectOption("b2");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Invoice settings saved")).toBeVisible();
    const s = await savedData(page);
    expect(s.settings.invoice.prefix).toBe("NEW-");
    expect(s.settings.defaults.upiAccountId).toBe("b2");
  });

  test("categories can be added and removed, and duplicates are refused", async ({ page }) => {
    await seed(page, { data: sampleV2() });
    await page.goto("/index.html#/settings/categories");
    const input = page.getByLabel("Add to Expense categories");
    await input.fill("Bakery supplies");
    await input.press("Enter");
    await expect(page.getByRole("listitem").filter({ hasText: "Bakery supplies" })).toBeVisible();
    await page.getByLabel("Add to Expense categories").fill("bakery SUPPLIES");
    await page.getByLabel("Add to Expense categories").press("Enter");
    await expect(page.getByText("is already there")).toBeVisible();
    await page.getByRole("button", { name: "Remove Bakery supplies" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Bakery supplies" })).toHaveCount(0);
    expect((await savedData(page)).categories.expense).not.toContain("Bakery supplies");
  });

  test("switching stock off hides it from the menu, keeps the data, and it comes back", async ({ page, isMobile }) => {
    test.skip(isMobile, "the sidebar is a desktop feature");
    const s = sampleV2();
    s.settings.modules.stock = true;
    s.items = [{ id: "keep", name: "Keep me", unit: "pcs", openingQty: 1, active: true }];
    await seed(page, { data: s });
    await page.goto("/index.html#/settings/modules");
    const nav = page.getByRole("navigation", { name: "Pages" });
    await expect(nav.getByRole("link", { name: "Stock" })).toBeVisible();
    await page.getByLabel("Stock and inventory").uncheck();
    await expect(nav.getByRole("link", { name: "Stock" })).toHaveCount(0);
    expect((await savedData(page)).items).toHaveLength(1);
    await page.getByLabel("Stock and inventory").check();
    await expect(nav.getByRole("link", { name: "Stock" })).toBeVisible();
  });
});

test.describe("your data", () => {
  test("backup then restore gives back identical data, with a warning and Undo", async ({ page }) => {
    await seed(page, { data: sampleV2() });
    await page.goto("/index.html#/settings/data");
    await expect(page.getByText("You haven't made a backup yet")).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download backup" }).click();
    const file = await (await download).path();
    expect((await download).suggestedFilename()).toMatch(/^accounts-manager-backup-\d{4}-\d{2}-\d{2}\.json$/);
    await expect(page.getByText("Backup downloaded")).toBeVisible();
    const backup = readFileSync(file, "utf8");
    const original = await savedData(page);
    expect(original.settings.lastBackupAt).toBeTruthy();

    await page.getByRole("link", { name: "Business" }).click();
    await page.getByLabel(/^Business name/).fill("Changed after backup");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Business details saved")).toBeVisible();
    await page.getByRole("link", { name: "Your data" }).click();

    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Restore from a backup" }).click();
    await (await chooser).setFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(backup) });
    const dialog = page.locator("dialog");
    await expect(dialog).toContainText("8 staff");
    const go = dialog.getByRole("button", { name: "Restore backup" });
    await expect(go).toBeDisabled();
    await dialog.getByLabel("Type RESTORE to confirm").fill("RESTORE");
    await go.click();
    await expect(page.getByText("Backup restored")).toBeVisible();
    const restored = await savedData(page);
    expect(restored.staff).toEqual(original.staff);
    expect(restored.invoices).toEqual(original.invoices);
    expect(restored.profile.name).toBe(original.profile.name);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("Previous data brought back")).toBeVisible();
    expect((await savedData(page)).profile.name).toBe("Changed after backup");
  });

  test("an old v1 backup restores with all its figures", async ({ page }) => {
    await seed(page, { data: sampleV2() });
    await page.goto("/index.html#/settings/data");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Restore from a backup" }).click();
    await (await chooser).setFiles({ name: "old.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture("v1-edge"))) });
    const dialog = page.locator("dialog");
    await expect(dialog).toContainText("Edge Case");
    await dialog.getByLabel("Type RESTORE to confirm").fill("restore");
    await dialog.getByRole("button", { name: "Restore backup" }).click();
    await expect(page.getByText("Backup restored")).toBeVisible();
    expect((await savedData(page)).staff).toHaveLength(5);
  });

  test("a file that isn't a backup is refused and changes nothing", async ({ page }) => {
    await seed(page, { data: sampleV2() });
    await page.goto("/index.html#/settings/data");
    const before = await page.evaluate(() => localStorage.getItem("accounts-manager:data"));
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Restore from a backup" }).click();
    await (await chooser).setFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from('{"hello":"world"}') });
    await expect(page.getByText("isn't an Accounts Manager backup")).toBeVisible();
    await expect(page.locator("dialog")).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("accounts-manager:data"))).toBe(before);
  });

  test("clearing everything needs a typed word, and the data can be brought back", async ({ page }) => {
    await seed(page, { data: sampleV2() });
    await page.goto("/index.html#/settings/data");
    await page.getByRole("button", { name: "Clear all data" }).click();
    const dialog = page.locator("dialog");
    const go = dialog.getByRole("button", { name: "Clear all data" });
    await expect(go).toBeDisabled();
    await dialog.getByLabel("Type DELETE to confirm").fill("DELETE");
    await go.click();
    await expect(page.locator("h1")).toHaveText("Welcome to Accounts Manager");
    expect((await savedData(page)).staff).toHaveLength(0);
    await page.getByRole("button", { name: "Explore with sample data" }).click();
    await page.getByRole("button", { name: "Exit sample data" }).click();
    await page.getByLabel(/^Business name/).fill("Back again");
    await page.getByLabel(/^Type of business/).selectOption("retail");
    await page.getByRole("button", { name: "Get started" }).click();
    await page.goto("/index.html#/settings/data");
    await page.getByRole("button", { name: "Bring it back" }).click();
    await page.locator("dialog").getByRole("button", { name: "Bring it back" }).click();
    await expect(page.getByText("Previous data brought back")).toBeVisible();
    expect((await savedData(page)).staff).toHaveLength(8);
  });
});

test("today in the test clock is what the sample expects", () => {
  expect(TODAY).toBe("2026-11-07");
});
