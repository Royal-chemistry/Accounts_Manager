# Contributing to Accounts Manager

Thanks for helping. Accounts Manager is a free tool that small businesses trust with their records, so the bar for changes is that they keep figures right and data safe.

## Run it locally

There's no build step. You need [Node](https://nodejs.org) 22 or newer, but only for the tests and the small local server.

```bash
git clone https://github.com/Royal-chemistry/Accounts_Manager
cd Accounts_Manager
npm install
npm start
```

Then open <http://localhost:4173>. To try it with data, choose **Explore with sample data** on the welcome screen.

A style guide showing every component lives at <http://localhost:4173/#/styleguide>.

## Run the tests

```bash
npm test
```

```bash
npx playwright install chromium
```

```bash
npm run test:e2e
```

`npm test` runs the unit tests, which take about a second and need no dependencies. `npm run test:e2e` runs the browser tests. They open every page at four widths in both themes, and fail on console errors, third-party requests, sideways scrolling or accessibility problems. Locally they use the Chrome you already have, so the install step above is only needed if you don't have Chrome.

The pictures in the README come from `node tests/tools/make-readme-media.mjs`, which needs [ffmpeg](https://ffmpeg.org) for the GIF.

## How the code is organised

```
js/core/    Business logic. Pure functions with no access to the page or storage.
js/state/   Loading, saving, upgrades and backups.
js/ui/      Reusable components: tables, forms, modals, toasts, charts.
js/pages/   One file per page.
css/        tokens.css holds every colour and size. Nothing else may use a raw colour.
tests/      unit/ for js/core and js/state, e2e/ for the browser, fixtures/ for old data.
```

Some rules the tests enforce:

- **Calculations live in `js/core`** and get unit tests. Pages only display what core works out.
- **Balances, stock and report figures are never stored.** They're worked out from the records each time, so they can't drift out of step.
- **No `confirm()`, `alert()` or `prompt()`.** Deletes go through `confirmDelete`, so they get the warning, the Recycle Bin and Undo.
- **No emojis in the UI, no inline styles, and nothing loaded from other servers.** The Content Security Policy in `index.html` is a promise to users that their data can't leave the browser. Please don't weaken it.
- **Markup goes through `html` from `js/ui/dom.js`.** It escapes everything by default. Use `raw` only for markup written in this codebase, never for anything a user typed.

## Changing the saved data

This is the part that can really hurt someone, so please be careful:

1. Bump `SCHEMA_VERSION` in `js/core/schema.js`.
2. Add a step to `migrate` in `js/core/migrate.js`. It must be pure and must never change the input.
3. Add a fixture and tests proving every figure stays the same.
4. Never edit `tests/fixtures/*.golden.json` to make a test pass. They record what the old version really calculated. If a change disagrees with them, the change is wrong.

## Sending a change

1. Open an issue first for anything large, so we can agree on the approach.
2. Keep each pull request to one change, with small, clear commits.
3. Make sure `npm test` and `npm run test:e2e` pass.
4. If the UI changed, add before and after screenshots at phone and desktop widths, in light and dark.
5. If behaviour changed, update `CHANGELOG.md`.

## Reporting a security problem

Please don't open a public issue. Use [private vulnerability reporting](https://github.com/Royal-chemistry/Accounts_Manager/security/advisories/new) instead.

## Licence

By contributing, you agree that your work is released under the [MIT licence](LICENSE).
