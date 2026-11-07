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
  await expect(page.locator("h1")).toHaveText("Dashboard");
  await waitUntilReadyOffline(page);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("h1")).toHaveText("Dashboard");
  await expect(page.locator(".chart")).toBeVisible();

  for (const [route, title] of [["invoices", "Invoices"], ["reports/gst", "Reports"], ["stock", "Stock"], ["settings/data", "Settings"]]) {
    await page.goto(`/index.html#/${route}`);
    await expect(page.locator("h1")).toHaveText(title);
  }

  // The bare address opens too, which is what a bookmark or Home Screen icon uses.
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText("Dashboard");

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

test("a link with extra details on the end still opens the app with no connection", async ({ page, context }) => {
  await seed(page, { data: sample(TODAY) });
  await page.goto("/index.html");
  await expect(page.locator("h1")).toHaveText("Dashboard");
  await waitUntilReadyOffline(page);
  await context.setOffline(true);
  await page.goto("/index.html?from=bookmark");
  await expect(page.locator("h1")).toHaveText("Dashboard");
  await context.setOffline(false);
});
