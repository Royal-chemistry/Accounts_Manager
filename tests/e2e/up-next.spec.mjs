// The new design's moving parts: Up Next, the shrinking tab bar, search, and the glass slider.
import { test, expect, savedData, seed, TODAY, watchPage } from "./helpers.mjs";
import { upNext } from "../../js/core/reports.js";
import { sample } from "../../js/core/sample.js";
import { blank } from "../../js/core/schema.js";

const open = async (page, path = "dashboard", data = sample(TODAY)) => {
  await seed(page, { data });
  await page.goto(`/index.html#/${path}`);
  await expect(page.locator("#page-title")).toBeVisible();
};
const player = (page) => page.getByRole("region", { name: "Up next" });
const queue = upNext(sample(TODAY), TODAY);

test.describe("the player", () => {
  test("shows the most urgent item on every page, and skip moves on", async ({ page }) => {
    const problems = watchPage(page);
    await open(page);
    await expect(player(page)).toContainText(queue[0].name);
    await expect(player(page)).toContainText("late");
    await page.goto("/index.html#/settings");
    await expect(player(page)).toContainText(queue[0].name);
    await player(page).getByRole("button", { name: "Skip to the next one" }).click();
    await expect(player(page)).toContainText(queue[1].name);
    expect(problems).toEqual([]);
  });

  test("skipping changes nothing in the records, and everything comes back round", async ({ page }) => {
    await open(page);
    const before = await savedData(page);
    for (let i = 0; i < queue.length; i++) await player(page).getByRole("button", { name: "Skip to the next one" }).click();
    await expect(player(page)).toContainText(queue[0].name);
    expect(await savedData(page)).toEqual(before);
  });

  test("its action opens the right form, and a payment moves on to the next item", async ({ page }) => {
    await open(page);
    expect(queue[0].kind).toBe("purchase");
    await player(page).getByRole("button", { name: `Pay: ${queue[0].name}` }).click();
    const d = page.locator("dialog");
    await expect(d).toContainText(queue[0].detail.replace("Bill ", ""));
    await d.locator(".seg label", { hasText: "Cash" }).click();
    await d.getByRole("button", { name: /^(Save payment|Pay|Record payment)/ }).click();
    await expect(d).toBeHidden();
    await expect(player(page)).toContainText(queue[1].name);
  });

  test("isn't there when there's nothing to do, and Today says so", async ({ page }) => {
    const s = blank(TODAY);
    s.profile = { ...s.profile, onboarded: true, name: "Calm Co" };
    await open(page, "dashboard", s);
    await expect(player(page)).toHaveCount(0);
    await expect(page.locator(".story")).toContainText("You're all caught up");
    await expect(page.getByRole("button", { name: "Start Up Next" })).toHaveCount(0);
  });
});

test.describe("the full sheet", () => {
  test("lists the queue, moves through it, and closes", async ({ page }) => {
    const problems = watchPage(page);
    await open(page);
    await page.getByRole("button", { name: "Start Up Next" }).click();
    const sheet = page.locator("dialog.modal-now");
    await expect(sheet).toContainText(queue[0].name);
    await expect(sheet.locator(".now-row")).toHaveCount(queue.length - 1);

    await sheet.getByRole("button", { name: "Skip to the next one" }).click();
    await expect(sheet.locator(".now-name")).toHaveText(queue[1].name);

    // Picking one from further down jumps straight to it.
    await sheet.locator(".now-row", { hasText: queue[3].name }).first().click();
    await expect(sheet.locator(".now-name")).toHaveText(queue[3].name);
    await expect(player(page)).toContainText(queue[3].name);

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    expect(problems).toEqual([]);
  });

  test("paying from the sheet moves straight on, ending with all caught up", async ({ page }) => {
    const s = blank(TODAY);
    s.profile = { ...s.profile, onboarded: true, name: "Small Co" };
    s.clients = [{ id: "c1", name: "Only Client", active: true }];
    s.invoices = [{ id: "i1", clientId: "c1", no: "A-1", date: "2026-10-01", due: "2026-10-15", lines: [{ desc: "x", qty: 1, rate: 500, gstRate: 0 }], payments: [] }];
    await open(page, "dashboard", s);
    await player(page).getByRole("button", { name: /^Open Up Next/ }).click();
    const sheet = page.locator("dialog.modal-now");
    await sheet.getByRole("button", { name: "Receive" }).click();
    const form = page.locator("dialog").last();
    await expect(form).toContainText("Payment for A-1");
    await form.getByRole("button", { name: "Save payment" }).click();
    await expect(sheet).toContainText("You're all caught up");
    await expect(player(page)).toHaveCount(0);
    expect((await savedData(page)).invoices[0].payments).toHaveLength(1);
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(sheet).toBeHidden();
  });

  test("works from the keyboard, and focus comes back", async ({ page, isMobile }) => {
    test.skip(isMobile, "Phones have no keyboard");
    await open(page);
    const opener = player(page).getByRole("button", { name: /^Open Up Next/ });
    await opener.focus();
    await page.keyboard.press("Enter");
    const sheet = page.locator("dialog.modal-now");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Pay", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(player(page).getByRole("button", { name: /^Open Up Next/ })).toBeFocused();
  });
});

test.describe("Today", () => {
  test("rows and shelves open the right forms", async ({ page }) => {
    const problems = watchPage(page);
    await open(page);
    const list = page.getByTestId("up-next-list");
    await expect(list.locator(".app-row").first()).toContainText(queue[0].name);
    await list.getByRole("button", { name: `Pay: ${queue[0].name}` }).click();
    const d = page.locator("dialog");
    await expect(d).toBeVisible();
    await d.getByRole("button", { name: "Cancel" }).click();
    await page.locator(".shelf", { hasText: "Who owes you" }).getByRole("button", { name: /^Receive: / }).first().click();
    await expect(d).toContainText("outstanding");
    expect(problems).toEqual([]);
  });

  test("shelf names link to their pages, which lead with their artwork", async ({ page }) => {
    await open(page);
    await page.locator(".shelf", { hasText: "Who owes you" }).getByRole("link", { name: "Harbour View Hotel" }).click();
    await expect(page.locator("h1")).toHaveText("Harbour View Hotel");
    await expect(page.locator(".page-head-art .art-xl")).toHaveText("HV");
  });
});

test.describe("with motion on", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  test("moving between pages quickly doesn't count as a crash, and lands in the right place", async ({ page }) => {
    const problems = watchPage(page);
    await open(page);
    for (const route of ["invoices", "clients", "banks", "stock", "reports", "staff"]) {
      await page.evaluate((r) => { location.hash = `#/${r}`; }, route);
    }
    await expect(page.locator("h1")).toHaveText("Staff");
    await expect(page.locator(".crash")).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test("moving to a page still puts focus on its heading", async ({ page, isMobile }) => {
    test.skip(isMobile, "Phones have no keyboard");
    await open(page);
    await page.locator(".nav-item", { hasText: "Clients" }).click();
    await expect(page.locator("h1")).toHaveText("Clients");
    await expect(page.locator("#page-title")).toBeFocused();
  });
});

test.describe("the phone tab bar", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  test("shrinks when scrolling down and comes back when scrolling up", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Only phones have a tab bar");
    await open(page);
    const app = page.locator("[data-app]");
    await expect(app).not.toHaveAttribute("data-dock-min");
    await page.evaluate(() => window.scrollTo(0, 500));
    await expect(app).toHaveAttribute("data-dock-min");
    const bar = page.getByRole("navigation", { name: "Quick links" });
    await expect(bar.getByRole("link", { name: "Invoices" })).toBeHidden();
    await expect(player(page)).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 300));
    await expect(app).not.toHaveAttribute("data-dock-min");
    await expect(bar.getByRole("link", { name: "Invoices" })).toBeVisible();

    // Tapping the shrunk bar opens it out again rather than doing anything else.
    await page.evaluate(() => window.scrollTo(0, 700));
    await expect(app).toHaveAttribute("data-dock-min");
    await bar.locator('.bottom-item[aria-current="page"]').click();
    await expect(app).not.toHaveAttribute("data-dock-min");
    await expect(page.locator("h1")).toHaveText("Today");
  });

  test("stays still for anyone who has asked for less motion", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, reducedMotion: "reduce", baseURL: "http://localhost:4173", serviceWorkers: "block" });
    const page = await context.newPage();
    await open(page);
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(200);
    await expect(page.locator("[data-app]")).not.toHaveAttribute("data-dock-min");
    await context.close();
  });
});

test.describe("search", () => {
  test("finds records across the business, and clicking one opens it", async ({ page, isMobile }) => {
    const problems = watchPage(page);
    await open(page);
    if (isMobile) await page.getByRole("link", { name: "Search" }).click();
    else await page.locator(".nav-item", { hasText: "Search" }).click();
    await expect(page.locator("h1")).toHaveText("Search");
    await expect(page.locator(".empty-title")).toHaveText("Search everything");
    const box = page.getByRole("searchbox");
    await box.fill("harbour");
    const clients = page.locator(".search-group", { hasText: "Clients" });
    await clients.getByRole("link", { name: /Harbour View Hotel/ }).click();
    await expect(page.locator("h1")).toHaveText("Harbour View Hotel");
    expect(problems).toEqual([]);
  });

  test("says when nothing matches, and remembers the search on the way back", async ({ page }) => {
    await open(page, "search");
    const box = page.getByRole("searchbox");
    await box.fill("zzzz");
    await expect(page.getByText("No results")).toBeVisible();
    await page.goto("/index.html#/clients");
    await page.goto("/index.html#/search");
    await expect(page.getByRole("searchbox")).toHaveValue("zzzz");
  });

  test("the slash key goes there from a page with no table", async ({ page, isMobile }) => {
    test.skip(isMobile, "Phones have no keyboard");
    await open(page);
    await page.keyboard.press("/");
    await expect(page.locator("h1")).toHaveText("Search");
  });

  test("user text stays text", async ({ page }) => {
    const s = sample(TODAY);
    s.clients[0].name = '<img src=x onerror="window.__hacked=1">';
    const problems = watchPage(page, { ignore: [/x$/] });
    await open(page, "search", s);
    await page.getByRole("searchbox").fill("onerror");
    await expect(page.locator(".search-group").first()).toContainText("<img");
    expect(await page.evaluate(() => window.__hacked)).toBeUndefined();
    expect(problems).toEqual([]);
  });
});

test.describe("the glass", () => {
  const backgroundAlpha = (page) => page.locator(".top-group").first().evaluate((el) => {
    const parts = getComputedStyle(el).backgroundColor.match(/[\d.]+/g).map(Number);
    return parts.length > 3 ? parts[3] : 1;
  });

  test("the slider changes how see-through it is, and is remembered", async ({ page, isMobile }) => {
    test.skip(isMobile, "The controls are checked at one size");
    await open(page, "settings/appearance");
    await expect(page.getByLabel("Glass")).toHaveValue("0.45");
    const middle = await backgroundAlpha(page);
    await page.getByLabel("Glass").fill("0");
    await expect.poll(() => backgroundAlpha(page)).toBeLessThan(middle);
    await page.getByLabel("Glass").fill("1");
    await expect.poll(() => backgroundAlpha(page)).toBe(1);
    await page.getByLabel("Glass").fill("0.1");
    const low = await backgroundAlpha(page);
    await page.reload();
    await expect(page.getByLabel("Glass")).toHaveValue("0.1");
    expect(await backgroundAlpha(page)).toBeCloseTo(low, 2);
  });

  test("goes solid when the device asks for more contrast, and says why", async ({ page, isMobile }) => {
    test.skip(isMobile, "The controls are checked at one size");
    await page.emulateMedia({ contrast: "more" });
    await open(page, "settings/appearance");
    expect(await backgroundAlpha(page)).toBe(1);
    await expect(page.getByLabel("Glass")).toBeDisabled();
    await expect(page.getByText("stays solid")).toBeVisible();
  });
});
