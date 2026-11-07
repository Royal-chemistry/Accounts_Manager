// Everything important without a mouse.
import { test, expect, sampleV2, savedData, seed } from "./helpers.mjs";

test.skip(({ isMobile }) => isMobile, "Phones have no keyboard");

const open = async (page, path) => {
  await seed(page, { data: sampleV2() });
  await page.goto(`/index.html#/${path}`);
  await expect(page.locator("#page-title")).toBeVisible();
};
const focusName = (page) => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return "";
  return (el.getAttribute("aria-label") || el.labels?.[0]?.textContent || el.textContent || "").replace(/\s*\*\s*$/, "").trim();
});
/** Presses Tab until the wanted control has focus. */
const tabTo = async (page, wanted, { limit = 90, back = false } = {}) => {
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press(back ? "Shift+Tab" : "Tab");
    if (wanted.test(await focusName(page))) return;
  }
  throw new Error(`Never reached ${wanted} with the Tab key, last on "${await focusName(page)}"`);
};
const inDialog = (page) => page.evaluate(() => !!document.activeElement?.closest("dialog"));

test("the first Tab offers a way past the menu", async ({ page }) => {
  await open(page, "invoices");
  await page.keyboard.press("Tab");
  expect(await focusName(page)).toBe("Skip to content");
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
  // It jumps down the page without changing page, even though this app uses the address bar for its pages.
  await expect(page.locator("h1")).toHaveText("Invoices");
  expect(new URL(page.url()).hash).toBe("#/invoices");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement.closest("#main"))).toBe(true);
});

test("moving to another page puts focus on its heading", async ({ page }) => {
  await open(page, "invoices");
  await tabTo(page, /^Clients$/);
  await page.keyboard.press("Enter");
  await expect(page.locator("h1")).toHaveText("Clients");
  await expect(page.locator("#page-title")).toBeFocused();
});

test("an invoice from start to finish", async ({ page }) => {
  await open(page, "invoices");
  const before = await page.locator("tbody tr").count();
  await page.keyboard.press("n");
  await expect(page.locator("dialog")).toBeVisible();
  expect(await inDialog(page)).toBe(true);
  await tabTo(page, /^Description$/);
  await page.keyboard.type("Made with the keyboard");
  await tabTo(page, /^Rate$/);
  await page.keyboard.type("500");
  await tabTo(page, /^Create invoice$/);
  await page.keyboard.press("Enter");
  await expect(page.locator("dialog")).toBeHidden();
  await expect(page.getByText(/created/)).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(before + 1);
  expect((await savedData(page)).invoices.some((i) => i.lines.some((l) => l.desc === "Made with the keyboard"))).toBe(true);
  // Focus lands somewhere sensible, so the next Tab doesn't start from the top of nothing.
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
});

test("after saving from the New button, focus isn't lost", async ({ page }) => {
  await open(page, "clients");
  await tabTo(page, /^Add client$/);
  await page.keyboard.press("Enter");
  await expect(page.locator("dialog")).toBeVisible();
  await page.keyboard.type("Keyboard Client");
  await tabTo(page, /^Save$/);
  await page.keyboard.press("Enter");
  await expect(page.locator("tbody tr", { hasText: "Keyboard Client" })).toBeVisible();
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
});

test("focus stays inside a window, Esc closes it, and focus returns to the button that opened it", async ({ page }) => {
  await open(page, "invoices");
  await tabTo(page, /^New invoice$/);
  await page.keyboard.press("Enter");
  await expect(page.locator("dialog")).toBeVisible();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const stillInside = await page.evaluate(() => document.activeElement === document.body || !!document.activeElement?.closest("dialog"));
    expect(stillInside).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).toBeHidden();
  expect(await focusName(page)).toBe("New invoice");
});

test("Esc on a changed form asks first, and Keep editing keeps it", async ({ page }) => {
  await open(page, "invoices");
  await page.keyboard.press("n");
  await tabTo(page, /^Description$/);
  await page.keyboard.type("Don't lose me");
  await page.keyboard.press("Escape");
  await expect(page.getByText("You have unsaved changes.")).toBeVisible();
  expect(await focusName(page)).toBe("Keep editing");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Description")).toHaveValue("Don't lose me");
});

test("a delete can be done, and undone, without a mouse", async ({ page }) => {
  await open(page, "invoices");
  const row = page.locator("tbody tr", { hasText: "ST-001" });
  await expect(row).toBeVisible();
  await tabTo(page, /^More actions$/);
  const opened = await page.evaluate(() => document.activeElement.closest("tr")?.textContent ?? "");
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  for (let i = 0; i < 8 && (await focusName(page)) !== "Delete"; i++) await page.keyboard.press("ArrowDown");
  expect(await focusName(page)).toBe("Delete");
  await page.keyboard.press("Enter");
  await expect(page.locator("dialog")).toBeVisible();
  expect(await inDialog(page)).toBe(true);
  await tabTo(page, /^Delete$/, { limit: 6 });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  const number = opened.match(/ST-\d+/)[0];
  await expect(page.locator("tbody tr", { hasText: number })).toHaveCount(0);
  await page.keyboard.press("u");
  await expect(page.locator("tbody tr", { hasText: number })).toBeVisible();
});

test("shortcuts: search, the list of shortcuts, and going home", async ({ page }) => {
  await open(page, "invoices");
  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox").or(page.getByPlaceholder(/Search/)).first()).toBeFocused();
  // Typing in a box isn't mistaken for a shortcut.
  await page.keyboard.type("nu");
  await expect(page.locator("dialog")).toHaveCount(0);
  await page.locator("#page-title").focus();
  await page.keyboard.press("?");
  await expect(page.locator("dialog")).toContainText("Keyboard shortcuts");
  await expect(page.locator("dialog")).toContainText("Undo");
  await page.keyboard.press("Escape");
  await page.keyboard.press("g");
  await page.keyboard.press("d");
  await expect(page.locator("h1")).toHaveText("Dashboard");
});

test("a table sorts from the keyboard, and says how it's sorted", async ({ page }) => {
  await open(page, "invoices");
  await tabTo(page, /^Total/);
  await page.keyboard.press("Enter");
  await expect(page.locator('th[aria-sort="ascending"]')).toContainText("Total");
  await page.locator('th[aria-sort="ascending"] button').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('th[aria-sort="descending"]')).toContainText("Total");
});
