// One-off: captures the live v1 app's sample data and "before" screenshots.
// Run with: node tests/tools/capture-v1.mjs
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const LIVE = "https://royal-chemistry.github.io/Accounts_Manager/";
const TABS = ["dashboard", "guards", "register", "sheet", "advances", "clients", "invoices", "cash", "recurring", "banks", "settings"];
const SIZES = { desktop: { width: 1440, height: 900 }, phone: { width: 375, height: 812 } };
const SHOTS = "screenshots/before";

await mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
let saved = false;
for (const [label, viewport] of Object.entries(SIZES)) {
  const ctx = await browser.newContext({ viewport, timezoneId: "Asia/Kolkata", locale: "en-IN" });
  const page = await ctx.newPage();
  await page.goto(LIVE);
  await page.getByRole("button", { name: "Sample data" }).click();
  for (const tab of TABS) {
    await page.locator(`#nav button[data-tab="${tab}"]`).click();
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${SHOTS}/${label}-${tab}.png`, fullPage: true });
  }
  if (!saved) {
    const raw = await page.evaluate(() => localStorage.getItem("accounts-manager:v1"));
    await writeFile("tests/fixtures/v1-sample.json", JSON.stringify(JSON.parse(raw), null, 1) + "\n");
    saved = true;
  }
  await ctx.close();
}
await browser.close();
console.log(`Captured fixture and ${TABS.length * 2} screenshots`);
