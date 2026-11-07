// After one visit, the app opens and works with no connection.
import { test, expect, savedData, seed, TODAY, watchPage } from "./helpers.mjs";
import { sample } from "../../js/core/sample.js";

test.use({ serviceWorkers: "allow" });

const waitUntilReadyOffline = (page) => page.evaluate(async () => {
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
  }
});

test("the app opens, moves around and saves with no connection", async ({ page, context }) => {
  const problems = watchPage(page);
  const state = sample(TODAY);
  await seed(page, { data: state });
  await page.goto("/index.html#/dashboard");
  await expect(page.locator("h1")).toHaveText("Today");
  await waitUntilReadyOffline(page);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("h1")).toHaveText("Today");
  await expect(page.locator(".chart")).toBeVisible();

  for (const [route, title] of [["invoices", "Invoices"], ["reports/gst", "Reports"], ["stock", "Stock"], ["settings/data", "Settings"]]) {
    await page.goto(`/index.html#/${route}`);
    await expect(page.locator("h1")).toHaveText(title);
  }

  // The bare address opens too, which is what a bookmark or Home Screen icon uses.
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText("Today");

  await page.goto("/index.html#/clients");
  await page.locator("[data-add]").first().click();
  const d = page.locator("dialog");
  await d.getByLabel(/^Client name/).fill("Added while offline");
  await d.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("tbody tr", { hasText: "Added while offline" })).toBeVisible();
  expect((await savedData(page)).clients.some((c) => c.name === "Added while offline")).toBe(true);

  // Fonts came from the saved copy, so nothing falls back to a system font.
  expect(await page.evaluate(() => document.fonts.check('16px "Inter"', "₹"))).toBe(true);
  await context.setOffline(false);
  expect(problems).toEqual([]);
});

test("everything works from a sub-folder, the way GitHub Pages serves the live site", async ({ page, context }) => {
  const problems = watchPage(page);
  const outside = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (url.hostname === "localhost" && !url.pathname.startsWith("/Accounts_Manager/")) outside.push(url.pathname);
  });
  await seed(page, { data: sample(TODAY) });
  await page.goto("/Accounts_Manager/");
  await expect(page.locator("h1")).toHaveText("Today");
  await expect(page.locator(".chart")).toBeVisible();
  await waitUntilReadyOffline(page);
  expect(await page.evaluate(async () => new URL((await navigator.serviceWorker.ready).scope).pathname)).toBe("/Accounts_Manager/");
  await context.setOffline(true);
  await page.goto("/Accounts_Manager/");
  await expect(page.locator(".chart")).toBeVisible();
  await page.goto("/Accounts_Manager/index.html#/reports/gst");
  await expect(page.locator("h1")).toHaveText("Reports");
  await context.setOffline(false);
  expect(outside).toEqual([]);
  expect(problems).toEqual([]);
});

test("other sites sharing this address keep their saved files, and only our old copies are cleared", async ({ page }) => {
  await page.goto("/sw.js"); // anywhere on this address that doesn't start the app
  await page.evaluate(async () => {
    await caches.open("another-project-cache");
    await caches.open("accounts-manager-v1");
  });
  await seed(page, { data: sample(TODAY) });
  await page.goto("/index.html");
  await expect(page.locator("h1")).toHaveText("Today");
  await waitUntilReadyOffline(page);
  const names = await page.evaluate(() => caches.keys());
  expect(names).toContain("another-project-cache");
  expect(names).toContain("accounts-manager-v2");
  expect(names).not.toContain("accounts-manager-v1");
});

test("a link with extra details on the end still opens the app with no connection", async ({ page, context }) => {
  await seed(page, { data: sample(TODAY) });
  await page.goto("/index.html");
  await expect(page.locator("h1")).toHaveText("Today");
  await waitUntilReadyOffline(page);
  await context.setOffline(true);
  await page.goto("/index.html?from=bookmark");
  await expect(page.locator("h1")).toHaveText("Today");
  await context.setOffline(false);
});
