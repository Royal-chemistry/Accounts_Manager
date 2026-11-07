# Changelog

Notable changes to Accounts Manager. Versions follow [semantic versioning](https://semver.org), and the format follows [Keep a Changelog](https://keepachangelog.com).

## [2.1.0] - Unreleased

A new look, inspired by the glass design in Apple's latest apps, and a few new ways of working built around it. Your records and figures aren't touched by this update.

### Added

- **Up Next:** everything that's late or due within a week, as a queue. A small player floats above every page with what's next, and Pay or Receive goes straight to the right form. Paying moves on to the next item by itself. Open it for the full queue.
- **Today:** the dashboard now leads with a plain-language headline written from your records, what's up next, and shelves of who owes you and who you owe.
- **Search:** one place to find any client, supplier, invoice, bill, staff member, stock item or cash book entry. Press `/` to get there.
- **Artwork:** every client, supplier, staff member and stock item gets a colourful tile made from their name, and their page takes on its colour.
- **A glass slider** in Settings, Appearance, from Most transparent to Most tinted.

### Changed

- The sidebar and top controls now float above the page as glass. On phones, a floating tab bar shrinks as you scroll down.
- Forms slide up as sheets on phones, buttons are pills, and pages fade softly into each other.
- Text is larger on phones.
- Apple devices now use their own system font, and everything else still uses Inter.

### Accessibility

- Glass goes solid when your device asks for reduced transparency or more contrast, and motion stops when it asks for reduced motion.
- Figures and tables always stay on solid backgrounds, and new tests check text on glass against the worst thing that could scroll beneath it.

## [2.0.0] - 2026-11-07

A rebuild of the whole app. Everything from 1.x is still here, your saved data upgrades automatically, and your old copy is kept untouched as a fallback.

### Added

- **Welcome flow** for your business name, type, GSTIN, logo, financial year and currency. Your business type sets up suitable categories and stock units.
- **Safe deletes everywhere:** a warning that says what else is affected, a Recycle Bin with restore and permanent delete, and an 8-second Undo.
- **Stock module**, switchable in Settings: items, stock in and out, moving average cost, valuation, history, low-stock alerts and an optional link from invoices.
- **Payment mode on every money entry:** Cash, Bank, UPI or Credit.
- **Suppliers and purchases**, with what you owe, what you're owed, opening balances and a Settle action.
- **Reports:** Profit & Loss, cash flow, receivables and payables ageing, GST summary, stock and staff pay, each with date ranges, CSV export and print or PDF.
- **Daily attendance grid**, staff detail pages, staff codes, positions and active status, and salary on hold.
- **IGST for inter-state invoices**, mixed tax rates, entering a tax-inclusive total, an invoice register print, and recording GST paid.
- **Recurring payments** that repeat every 1, 2, 3 or 12 months, with variable amounts, pausing and history.
- **Loans** with principal, interest rate, closed status and an interest split on each payment.
- **Light and dark themes** that follow your system, with a toggle.
- **Sorting, search, filters and sticky headers** on every table.
- **Dashboard** with a 6-month trend, what needs attention, low stock, recent activity and a backup reminder.
- **Sample mode**, kept apart from your real data, so you can explore without risk.
- **Offline support** after your first visit.

### Changed

- Profit is now counted when invoiced or incurred by default, with a switch to count it when paid. The first time you see this, the app explains how your figure moved and why.
- Account balances now come from linked entries only. Older cash book entries that never named an account stay out of balances, so your Cash in hand starts at ₹0 rather than from a guess. You can link them at any time.
- A party with history is marked inactive by default rather than deleted. Accounts with transactions can be closed but not deleted.
- The design is new from top to bottom, using self-hosted Inter and SVG icons, and it meets WCAG AA at every screen size.

### Fixed

- Dates near midnight could fall on the wrong day in time zones ahead of UTC.
- Spreadsheet formulas in exported CSV files are now neutralised.
- Every page now has a Content Security Policy, and all user text is escaped by default.

## [1.0.0] - 2026

The first public release: payroll, advances, invoices, recurring payments, banks and loans, a cash book, backup and restore, and sample data.

[2.0.0]: https://github.com/Royal-chemistry/Accounts_Manager/releases/tag/v2.0.0
