// Every page, at every width, in both themes. Fails on console errors, crashes, failed or third-party
// requests, sideways scrolling, or anything axe finds. Saves a screenshot of each for review.
import { mkdirSync } from "node:fs";
import { test, expect, ALL_PAGES, expectAccessible, expectNoHorizontalScroll, sampleV2, seed, watchPage } from "./helpers.mjs";

const WIDTHS = [375, 768, 1024, 1440];
const THEMES = ["light", "dark"];
const SHOTS = "screenshots/current";
mkdirSync(SHOTS, { recursive: true });

for (const width of WIDTHS) {
  for (const theme of THEMES) {
    test.describe(`${width}px ${theme}`, () => {
      test.use({ viewport: { width, height: 900 }, ...(width === 375 ? { hasTouch: true, isMobile: true } : {}) });

      test(`every page passes at ${width}px in ${theme}`, async ({ page }) => {
        test.setTimeout(180_000);
        const problems = watchPage(page);
        const state = sampleV2();
        state.settings.modules.stock = true;
        await seed(page, { data: state, theme });
        for (const name of ALL_PAGES) {
          await page.goto(`/index.html#/${name}`);
          await expect(page.locator("#page-title")).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          await page.screenshot({ path: `${SHOTS}/${width}-${theme}-${name}.png`, fullPage: true });
          await expectNoHorizontalScroll(page, `${name} at ${width}px`);
          await expectAccessible(page, `${name} at ${width}px in ${theme}`);
        }
        expect(problems).toEqual([]);
      });
    });
  }
}
