# Accounts Manager 2.0: Implementation Plan

**Status:** draft, waiting for approval. No app code has changed.

**Goal:** turn Accounts Manager into a polished, trustworthy daily tool for accounting managers at small businesses, with no sign-up, no server and no data leaving the device.

**Architecture:** plain HTML, CSS and native JavaScript modules with no build step, hosted on GitHub Pages. All business logic moves into pure, unit-tested functions. Balances, stock levels and report figures are calculated from the saved records every time, so they can't drift out of step with them.

**Stack:** no runtime dependencies. Development only: Playwright and axe-core for browser and accessibility tests.

**Global constraints**
- Existing saved data must survive the upgrade with every figure unchanged.
- Generic for any business. No security-industry wording, branding or data from the reference app.
- No `confirm()`, `alert()` or `prompt()`. SVG icons only, no emojis in the UI.
- WCAG AA contrast, full keyboard use, and working layouts at 375, 768, 1024 and 1440px.
- A page isn't done until it has been tested in a headless browser on desktop and mobile with no console errors.

---

## 1. Decisions for you

Approving the plan as written accepts the recommendation on each line. Reply with a number to change one.

| # | Decision | Recommendation | Why |
|---|---|---|---|
| 1 | **How profit is calculated** | Count sales when invoiced and costs when incurred ("accrual"), with a one-click switch to cash basis on the report | Today's figure has real errors (section 2.2). Fixing them **changes the profit users see**, so the app will explain the change once after upgrading |
| 2 | **What UPI means for balances** | Every UPI entry names a bank account, pre-filled with a default set in Settings | UPI money lands in a bank, so balances keep matching bank statements |
| 3 | **Old "Cash / not linked" entries** | They stay out of every balance, exactly as today. A new Cash in hand account starts at ₹0 until you match it to your real cash | Guarantees no existing balance moves during the upgrade |
| 4 | **Deleting a client, supplier or staff member who has history** | The modal offers "Mark inactive" as the main action. "Delete everything" moves the person and all linked records to the bin as one restorable group | Keeps old reports intact, and a mistake is one click to undo |
| 5 | **Deleting a bank account that has transactions** | Not allowed. Offer "Close account" instead | Removing it would silently rewrite history |
| 6 | **How releases go live** | Build on a `v2` branch. The live site stays on the current version until you approve the final merge | GitHub Pages publishes `main` immediately, and half-finished work must not reach users |
| 7 | **Stock costing method** | Moving weighted average | Simple, widely used, and needs no batch tracking |
| 8 | **Selling more than is in stock** | Warn and allow, then flag the item | Real shops often sell before entering the purchase. Blocking would stop the sale being recorded |
| 9 | **Fonts** | Self-host Inter and remove Google Fonts | Google Fonts contradicts the privacy promise, and monospace money looks like code and takes up too much room at 375px |
| 10 | **Working offline** | Add a small service worker (about 30 lines) that always fetches fresh code when online | The README says the app works offline, but today it won't reload without a connection. The alternative is removing that claim |
| 11 | **Extra features from the reference app** | The "Include" list in section 2.3 | You named these areas, but some go beyond the numbered requirements |

**One thing only you can do, at the end of M0:** this PC has no GitHub sign-in and `gh` isn't installed, so I can't push yet. I'll ask you to sign in once at that point. Until then, work stays in local commits. Commits will use your existing identity (`Aldrin Ann Thomas`, your GitHub noreply address), set for this repo only.

---

## 2. What I found

**Read:** every file in this repo, and the reference app's dashboard, staff, attendance, salary, payments, clients, invoices, expenses, banks, subscriptions, recycle bin, reports, taxes and uniform pages. I reached the reference through Lovable, because the private GitHub copy isn't accessible from here. **Not read:** its food, notes, approvals and login pages, which are outside this brief. **Checked:** the live app with its sample data, and the current test suite (14 of 14 pass) and GitHub Actions runs (passing).

### 2.1 Current app

One 631-line `js/app.js`, a 207-line `js/calc.js`, one stylesheet and no framework. The calculation code is clean and tested. The problems are mostly in the UI layer, in how money is classified, and in having no schema version.

### 2.2 Problems this plan fixes

| Problem | Where | Effect |
|---|---|---|
| **Profit is misstated** | `js/app.js:438` | GST collected counts as income, the whole loan EMI counts as an expense, and unpaid invoices are ignored (example below) |
| **Date can be wrong in India** | `js/app.js:9` | The date uses UTC, so entries made between midnight and 5:30am IST default to yesterday |
| **Restore overwrites without warning** | `js/app.js:587` | Picking a backup file replaces all data immediately |
| **Deleting staff leaves their money behind** | `js/app.js:166` | Their salary payments and advances keep affecting balances, labelled "(removed)" |
| **Inter-state invoices are wrong** | `js/app.js:415` | Invoices always print CGST + SGST, and IGST isn't possible |
| **A crafted backup can run code** | `js/app.js:38`, `:150` | IDs go into the HTML unescaped, so a malicious backup file could read all stored data |
| **CSV exports can run formulas** | `js/calc.js:141` | A name starting with `=` executes when opened in Excel |
| **Month picker fails on some browsers** | `index.html:22` | `<input type="month">` has historically been unsupported on desktop Firefox and Safari |
| **10 blocking browser popups** | `js/app.js` | 9 `confirm()` and 1 `prompt()`, with permanent deletes and no undo |
| **Phone layout** | Measured at 375px | 257px of controls sit above the content, most pages are hidden in a sideways strip, and all 18 visible buttons are under 44px |
| **No back button or links to pages** | `js/app.js:106` | Browser Back leaves the app, and no page has its own URL |
| **Two open tabs overwrite each other** | `js/app.js:30` | The last save silently wins |
| **Privacy and offline claims aren't fully true** | `README.md:5`, `:38` | Google Fonts sees each visitor's IP address, and the app won't reload offline |
| **Stale public description** | GitHub repo settings | It still says "security agencies", and topics are empty |
| **Oldest saved data is orphaned** | Commit `ef24dce` | Data under the old `dutypay:v1` key was never carried over. The migration will rescue it |

**The profit problem, using the app's own October sample data:**

| | Today | Cash basis, corrected | Accrual, corrected (default) |
|---|---|---:|---:|
| Counter sales | ₹7,09,000 | ₹7,09,000 | ₹7,09,000 |
| Invoice income | ₹1,16,480 (includes ₹15,480 GST) | ₹1,01,000 | ₹2,47,300 |
| Expenses | ₹2,64,499 | ₹2,64,499 | ₹2,64,499 |
| Loan EMI | ₹18,500 | Only the interest counts | Only the interest counts |
| Staff cost | ₹94,771 | ₹94,771 | ₹94,771 |
| **Profit** | **₹4,47,710** | **₹4,50,730** | **₹5,97,030** |

Old EMI entries don't record how much was interest, so that share counts as ₹0 until you edit them. Bank balances are not affected by any of this.

### 2.3 What to take from the reference app

**Include**
- Daily attendance grid (present, half day, leave, absent) that fills in days worked. A manual figure still overrides it.
- Staff: code, position, joining date, active or inactive, and a detail page with pay, advance and attendance history.
- Salary "on hold" status.
- Recurring payments: monthly, every 2 months, quarterly or yearly, plus variable amounts, pausing, payment history and overdue or due-soon filters.
- Expenses: business or personal (personal stays out of profit).
- Invoices: enter a total and extract the tax, plus an invoice register print.
- GST: record GST paid to the government.
- Loans: principal, interest rate, closed status, and an interest and principal split on each payment.
- Clients: active or inactive. WhatsApp links for staff and clients, which only open a chat and send nothing automatically.
- Dashboard: 6-month trend. Reports: period picker and print layout with totals.

**Later (added to the README roadmap)**
- Recovering an advance over several months
- Uniform or kit issue linked to pay deductions
- Team transfer history
- Credit notes and returns
- Financial-year invoice numbering
- Double-entry journal and trial balance
- Optional passcode

**Not suitable for a browser-only public tool**
- Logins and approvals, Supabase, Google Sheets sync and email reminders, because each needs a server
- Aadhaar numbers and staff photos, because they are too sensitive to keep unencrypted in browser storage

---

## 3. Features

### 3.1 Onboarding
- **First visit:** a welcome screen asks for business name and type (the 9 listed types, or Other with custom text). Address, GSTIN, phone, logo, financial-year start (default April) and currency (default INR) are optional. It also offers "Explore with sample data" so visitors can try the app first.
- **Saved once:** it never asks again, and everything is editable in Settings.
- **Existing users:** instead of the welcome flow, they get one skippable "Complete your profile" step, pre-filled from their current data. Their categories are only ever added to.
- **Logo:** shrunk in the browser to at most 256px and about 100 KB, because browser storage is limited to around 5 MB.
- **Sample data runs separately:** it uses its own storage, so it can never overwrite real records. A banner shows it's active, with a one-click exit.

**Presets:** every type also gets a common set. Expense: Rent, Electricity, Internet & phone, Transport, Repairs, Bank charges, Taxes & fees, Office supplies, Professional fees, Other. Income: Sales, Service income, Other income.

| Type | Extra expense categories | Extra income categories | Stock units | Stock module |
|---|---|---|---|---|
| Retail shop | Stock purchase, Packaging, Shop maintenance | Counter sales, Online sales | pcs, box, kg, g, L, pack, dozen | On |
| Restaurant / café | Raw materials, Gas, Kitchen supplies, Delivery commission, Cleaning | Dine-in, Takeaway, Delivery | kg, g, L, ml, pcs, plate, crate | On |
| Services | Software, Travel, Subcontractors, Marketing | Service fees, Retainers, Consulting | hrs, job, pcs | Off |
| Manufacturing | Raw materials, Machinery maintenance, Power & fuel, Job work, Freight | Product sales, Job work, Scrap sales | kg, ton, pcs, L, m, roll, box | On |
| Construction | Cement & materials, Labour contractors, Equipment hire, Site expenses, Fuel | Contract billing, Retention received | bag, ton, cft, sqft, m, load, pcs | On |
| Agency / manpower | Uniforms & kit, Staff accommodation, Recruitment, Site expenses, Insurance | Manpower billing, Service charges | pcs, set, pair | Off |
| Clinic | Medicines, Consumables, Lab charges, Equipment maintenance, Biomedical waste | Consultation, Procedures, Pharmacy, Lab | strip, bottle, box, pcs, ml, vial | On |
| Trading / wholesale | Stock purchase, Freight, Loading & unloading, Godown rent, Commission | Wholesale sales, Commission income | pcs, box, carton, kg, quintal, ton, bag | On |
| Other | None | None | pcs, box, kg, L | Off |

Changing the business type later only offers to add categories, and never removes any.

### 3.2 Safe deletes
Every delete opens one shared modal listing what will be removed and what else changes. Confirming moves the record to the Recycle Bin and shows an 8-second Undo toast. The timer pauses on hover or keyboard focus. The bin page has search, a type filter, restore and permanent delete.

| Deleting | The modal explains | Moved to the bin together |
|---|---|---|
| Invoice or purchase | Payment count and total, which account balances change, stock effect, and a warning if stock would go negative | Document and its payments |
| A single payment | New balance and status of the document | That payment |
| Cash-book entry | Account effect, and "this marks Rent for October unpaid" if it came from a recurring item | Entry |
| Client or supplier | Document count and amount outstanding. Main action: Mark inactive | Party, documents and payments |
| Staff member | Months of pay, advances, salary payments and balance effect. Main action: Mark inactive | Staff, pay entries, attendance, advances and salary payments |
| Advance | Which month's pay goes up | Advance |
| Salary payment | Balance effect | Payment |
| Bank or cash account | Blocked if it has transactions, with Close account offered | Account, only if unused |
| Transfer | Both accounts affected | Transfer |
| Loan | Payment total and balance effect | Loan and its payments |
| Recurring item | Past payments stay in the cash book | Schedule only |
| Stock item | Movements and invoice lines. Lines keep their text and lose the link. Main action: Mark inactive | Item and its manual movements |
| Stock movement | New quantity, and a warning if negative | Movement |

**Actions the bin can't hold:** Clear all data, Restore backup and Empty bin use the same modal and require typing a word to confirm. The current data is first saved to a safety slot in the browser, and the modal offers a backup download.

**Restoring when the parent is gone:** if the client or account was permanently deleted, the restored record keeps its saved name and is flagged for re-linking. It never crashes or adds to a balance silently.

### 3.3 Stock (switchable in Settings)
- **Items:** name, SKU (must be unique), category, unit, purchase price, sale price, GST %, HSN code (optional), opening quantity and reorder level.
- **Movements:** stock in (purchase) and stock out (sale, usage, damage, or adjustment).
- **Screens:** current stock, low-stock alerts on the dashboard, valuation, and full history per item.
- **Stock is always calculated, never stored:** opening quantity + purchase lines − invoice lines − sale entries ± manual movements. Editing or deleting an invoice therefore corrects stock automatically, with no reversal logic to get wrong.
- **Invoice link:** choosing a catalogue item on an invoice line fills in description, rate, GST and HSN. A per-invoice "Reduce stock" option defaults to on.
- **Cost of sales:** stock purchases go into inventory, and their cost reaches profit only when sold. Old "Stock purchase" entries with no item link stay as plain expenses, so past months don't change for that reason.

### 3.4 Payment modes, credit and suppliers
One shared control appears on every money form: **Cash · Bank · UPI · Credit**. Bank and UPI show an account picker. Credit requires a party and offers a due date. Each form remembers the last choice.

| Entry | Cash, Bank or UPI | Credit |
|---|---|---|
| Invoice or sale | Money received now | Creates a **receivable** |
| Purchase, expense or stock-in | Money paid now | Creates a **payable** |
| Salary, advance, EMI or recurring payment | Money paid now | Not offered (these are actual payments) |

- **Suppliers** sit alongside Clients, with the same screens and outstanding balances. Both can carry an opening balance from before they started using the app.
- **Settle:** enter an amount, mode, account and date. The app applies it to the oldest bills first and shows the split, which you can edit before saving. Paying more than is owed is stopped with a clear message.
- **Undo:** a settlement across several bills undoes as one action.

### 3.5 Reports
Each report has a date range (this month, last month, this quarter, this financial year, custom), CSV export and a print or PDF layout with your name, logo, period and page numbers. PDF uses the browser's Save as PDF, so no heavy library is needed.

| Report | Contents | Built-in check |
|---|---|---|
| **Profit & Loss** | Revenue − cost of sales = gross profit − expenses − staff cost − loan interest = net profit. Monthly columns and a basis switch. GST, personal spending and loan principal are excluded | Total equals the sum of its monthly columns |
| **Cash flow** | Opening balance, money in by source, money out by source, closing balance. Transfers are excluded. Old unlinked entries show on their own line | Closing equals actual account balances |
| **Ageing** | Receivables and payables by party: not due, 1–30, 31–60, 61–90, 90+ days overdue | Total equals outstanding on the party pages |
| **GST summary** | Output GST vs input GST by rate, with CGST, SGST and IGST, GST paid, and net payable. TDS deducted by clients is shown separately. Labelled "check with your accountant" | Output equals the sum of its documents |
| **Stock** | Opening, in, out and closing per item, average cost, value, low-stock list | Value equals quantity × average cost |
| **Staff pay** | Per person and team: days, gross, deductions, advances, net, paid, pending, PF and ESI to remit | Net equals the salary sheet |

**Staff cost** is gross pay minus food, kit and other recoveries. This matches today's figure and doesn't reduce cost for PF or ESI, which are owed to the government.

**GST rules:** IGST applies when the business and client state codes differ, read from their GSTINs or chosen manually. GSTIN format and checksum are validated with a warning only, never a block.

### 3.6 Everything kept from today
Payroll with all three pay bases, PF and ESI, extra shifts, bonus, deductions, salary-cap option, payslips, payout CSV, WhatsApp summary, staff CSV import and template, advances, clients, GST and non-GST invoices, part payments, TDS, overdue tracking, cash book, categories, recurring payments, accounts, transfers, match-to-bank, loans, backup and restore, and sample data. The parity tests in section 8 check this list one feature at a time.

### 3.7 Small additions that protect a browser-only tool
- **Backup reminder** on the dashboard ("last backup 23 days ago"), and a request for persistent browser storage.
- **Storage meter** in Settings, and a clear message if storage fills up.
- **Crash screen** that says the data is safe and offers a backup download.
- **Content Security Policy** that makes the browser itself block the app from sending data to any other server. This turns the privacy promise into something anyone can verify in View Source.

---

## 4. Data model and migration

### 4.1 Schema v2

```js
{
  schemaVersion: 2,
  profile:  { onboarded, name, type, typeOther, address, gstin, stateCode, phone, email, logo, fyStartMonth, currency },
  settings: { month, theme, lastBackupAt,
              modules: { stock, payroll, gst },
              pay: { basis, capAtFull, pf, esi, extraRate, foodRate, paidLeave },
              invoice: { prefix, nextNo, gstRate, dueDays, bankLine, terms },
              defaults: { cashAccountId, upiAccountId } },
  categories: { expense: [], income: [], units: [], stock: [] },

  // People
  staff:          [{ id, name, code, team, position, joinedOn, active, salary, bank, account, ifsc, upi, phone }],
  entries:        { "YYYY-MM": { staffId: { daysWorked, extraShifts, extraRate, bonus, advance, foodDays, foodRate, kit, other, hold } } },
  attendance:     { "YYYY-MM": { staffId: { "07": "P" } } },        // P, H, L or A
  advances:       [{ id, staffId, date, amount, note, ...payment }],
  salaryPayments: [{ id, staffId, month, date, amount, ...payment }],

  // Parties
  clients:   [{ id, name, contact, phone, email, gstin, stateCode, address, rate, gst, active }],
  suppliers: [{ id, name, contact, phone, email, gstin, stateCode, address, active }],

  // Documents. Both share one totals function.
  invoices:  [{ id, no, clientId, date, due, placeOfSupply, taxInclusive, reducesStock, lines: [line], payments: [pay] }],
  purchases: [{ id, billNo, supplierId, date, due, taxInclusive, lines: [line], payments: [pay] }],
  // line = { desc, hsn, qty, rate, gstRate, itemId }
  // pay  = { id, date, amount, tds, note, settlementId, ...payment }

  // Simple income and expense (renamed from `cash`)
  transactions: [{ id, type, date, category, note, amount, gstAmount, scope, partyType, partyId, due,
                   recurringId, stockLine, payments: [pay], ...payment }],

  // Money
  accounts:  [{ id, name, kind: "bank" | "cash", accountNo, opening, active }],
  transfers: [{ id, date, from, to, amount, note }],
  loans:     [{ id, name, lender, principal, rate, emi, dueDay, outstanding, since, status,
                payments: [{ id, date, amount, interest, ...payment }] }],
  recurring: [{ id, name, category, amount, frequency, dueDay, startMonth, variable, active, note, paid: {}, ...payment }],

  // Stock
  items:      [{ id, name, sku, category, unit, purchasePrice, salePrice, gstRate, hsn, openingQty, openingCost, reorderLevel, active }],
  stockMoves: [{ id, itemId, date, reason, qty, unitCost, note }],   // manual movements only

  bin: [{ id, type, label, amount, deletedAt, payload }]
}
// ...payment = { mode: "cash" | "bank" | "upi" | "credit", accountId, untracked }
```

**Money is stored in rupees, as it is today.** Totals are rounded to the paisa after adding, which removes any floating-point noise and matches how v1 calculates. Converting all stored values to paise would add risk to the migration without any visible benefit.

### 4.2 Field changes

| v1 | v2 | Note |
|---|---|---|
| `settings.agency`, `settings.address` | `profile.name`, `profile.address`, `profile.gstin` | A GSTIN inside the address text is detected and moved |
| `guards[].site` | `staff[].team` | `active: true` added |
| `duties`, `specialDuties`, `specialRate`, `messDays`, `messRate`, `uniform` | `daysWorked`, `extraShifts`, `extraRate`, `foodDays`, `foodRate`, `kit` | Generic names. Values unchanged, and CSV import still accepts the old headings |
| `salaryPaid[month][staffId]` | `salaryPayments[]` | Each payment gets an ID so it can go to the bin |
| `cash[]` | `transactions[]` | Same IDs, so recurring links survive |
| `banks[]` | `accounts[]` | `kind` is "cash" if the name contains "cash", otherwise "bank" |
| `bankId` on any money record | `mode` + `accountId` | Rules below |
| `invoices[].items` + `gst`, `gstRate` | `lines[]` with a `gstRate` on each line | Rate 0 when GST was off. Totals must match exactly |
| `loans[]` | Adds `principal`, `rate`, `status`; payments add `interest: null` | Principal and rate stay blank until you fill them |
| `recurring[]` | Adds `frequency: "monthly"`, `variable: false`, `active: true` | `paid` map kept |
| Not present | `suppliers`, `purchases`, `items`, `stockMoves`, `attendance`, `bin`, `categories` | Start empty. Categories are seeded from existing entries plus the preset |

**Converting `bankId`:**
- Points to a cash account: `mode: "cash"`.
- Points to any other account: `mode: "bank"`.
- Empty or pointing to an unknown account: `mode: "cash"`, `accountId: null`, `untracked: true`, which leaves balances exactly as they are today.

### 4.3 Migration safety

1. **The old data stays untouched.** `accounts-manager:v1` is read and never changed. v2 saves under `accounts-manager:data`, and a tab still running the old version keeps working.
2. **Pure and chained.** `migrate(raw)` has no side effects and runs one step per version, so later versions just add a step. A backup from a newer version is refused rather than damaged.
3. **Verified before switching.** `verifyMigration(old, new)` compares record counts, every account balance, every invoice total and balance, and every staff member's pay for every month.
4. **If verification fails, nothing switches.** A rescue screen explains what happened and offers a download of the original data. Nothing is lost.
5. **One-time notice after upgrading,** explaining the new profit calculation and that the old data is kept.
6. **Old backups keep working.** v1 and v2 backup files go through the same migration. Restore first shows what's in the file and what will be replaced.
7. **Orphaned rescue.** If only `dutypay:v1` exists, it's treated as v1 data.
8. **IDs are cleaned during migration,** which closes the backup-file code injection route.

---

## 5. File structure

```
index.html                 Small shell. Pages render into <main>.
assets/                    fonts/ (self-hosted Inter), favicon.svg
css/
  tokens.css               Colour, spacing, radius, type and motion, light and dark
  base.css                 Reset, typography, focus styles
  components.css           Button, field, card, table, modal, toast, badge, tabs, empty state
  layout.css               Sidebar, top bar, phone bottom bar, breakpoints
  pages.css                Attendance grid and other page-specific layout
  print.css                Invoice, payslip and report layouts
js/
  main.js                  Start-up: load, migrate, onboarding or app
  core/                    PURE: no DOM, no storage, fully unit tested
    money.js               sumMoney, round2, formatMoney, inr, inWords
    dates.js               localToday, fyRange, monthLabel, daysBetween, periodPresets
    csv.js                 parseCSV, toCSV (with formula guard)
    payroll.js             computePay, totals, daysInMonth, divisorFor, attendanceSummary
    documents.js           docTotals, gstSplit, outstanding, allocatePayment
    ledger.js              postings, accountBalances, statement
    stock.js               stockLedger, onHand, avgCost, valuation, lowStock
    reports.js             profitLoss, cashFlow, ageing, gstSummary, stockReport, staffPaySummary
    recurring.js           dueDates, nextDue, monthlyEquivalent
    bin.js                 impactOf, moveToBin, restoreFromBin, purgeFromBin
    validate.js            required, amount, gstin, ifsc, phone, unique
    presets.js             Business types, categories and units
    schema.js              blank, SCHEMA_VERSION
    migrate.js             migrate, verifyMigration
    sample.js              sample(today), with dates relative to today so it always looks current
  state/store.js           Load, save, subscribe, multi-tab sync, sample mode, storage-full handling
  ui/                      dom, icons, table, form, payment-field, modal, confirm-delete, toast,
                           theme, router, nav, chart, month-picker
  pages/                   dashboard, staff, attendance, salary, advances, clients, suppliers,
                           invoices, purchases, cashbook, recurring, banks, stock, reports,
                           recycle-bin, settings, onboarding
tests/
  unit/*.test.mjs          One per core module
  e2e/*.spec.mjs           Browser flows, plus a tiny static server
  fixtures/                v1 data captured from the live app, plus edge cases
sample/staff.csv           Kept
docs/                      Screenshots and the demo GIF
.github/                   Test workflow, issue forms, PR template
README.md, CONTRIBUTING.md, CHANGELOG.md, LICENSE
```

**Key function signatures**

```js
docTotals(doc)                 // { subtotal, gstByRate, gst, total, received, tds, balance, status }
gstSplit(gst, bizState, partyState)   // { cgst, sgst, igst }
allocatePayment(openDocs, amount)     // [{ docId, amount }], oldest first, never above each balance
postings(state)                // [{ id, date, accountId, amount, kind, sourceType, sourceId, label, untracked }]
accountBalances(state, asOf?)  // { accountId: balance }
stockLedger(state)             // per item: moves, onHand, avgCost, value, belowReorder, negative
profitLoss(state, { from, to, basis })
cashFlow(state, { from, to })
ageing(state, { side, asOf })  // side: "receivable" | "payable"
gstSummary(state, { from, to })
impactOf(state, type, id)      // { title, removes, affects, warnings, blockers, alternative }
moveToBin(state, type, id)     // new state + bin entry
restoreFromBin(state, binId)   // new state + warnings
migrate(raw)                   // { state, fromVersion, report } or throws MigrationError
```

---

## 6. UI design system

**Direction:** calm, precise and data-first. Quiet neutral surfaces let the numbers stand out. Green and red are reserved for money meaning, so the primary colour is blue, and a primary button never looks like a positive amount.

### Colour tokens

Both themes follow the system setting by default, with a toggle that remembers your choice. I tested 35 text and interface colour pairs per theme with a script and all pass WCAG AA. The tightest are 4.78:1 for text and 3.19:1 for borders. A unit test will keep them passing.

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#F6F7F9` | `#0E1116` |
| `--surface` | `#FFFFFF` | `#161A21` |
| `--surface-2` | `#F0F2F5` | `#1E232C` |
| `--border-strong` (inputs) | `#7F8896` | `#6F7A8A` |
| `--text` | `#14181F` | `#E9ECF1` |
| `--text-muted` | `#525C6B` | `#A3ADBB` |
| `--primary` / `--on-primary` | `#2B4BC4` / `#FFFFFF` | `#8EA6F7` / `#0E1430` |
| `--primary-soft` | `#E9EDFB` | `#1E2748` |
| `--success` / soft | `#0B7A43` / `#E3F5EB` | `#53CF92` / `#12291F` |
| `--danger` / soft | `#C2262E` / `#FCEBEC` | `#FF8F87` / `#331A1C` |
| `--warning` / soft | `#8A5600` / `#FDF1DC` | `#F3B95F` / `#2E2413` |
| `--info` / soft | `#0B6BA8` / `#E3F1FA` | `#6CC0F0` / `#132A38` |

Status is never shown by colour alone. Every badge also has text, and amounts have a sign or column heading.

### Other tokens

| Group | Values |
|---|---|
| Type | Inter (self-hosted, tabular figures for all amounts). 12, 13, 14, 16, 18, 22, 28px. Nothing under 12px. Inputs are 16px on phones so iOS doesn't zoom in. I'll confirm the ₹ glyph renders at the start of M2, with Source Sans 3 as the fallback |
| Spacing | 4, 8, 12, 16, 20, 24, 32, 40, 48px |
| Radius | 4, 6, 8, 12px |
| Elevation | Two soft shadow levels, with borders doing most of the work |
| Motion | 120ms and 180ms, nothing decorative, and off under reduced-motion |
| Targets | 44px on touch screens, at least 36px on desktop |

### Layout

| Width | Layout |
|---|---|
| 1280px and up | 240px sidebar, top bar with month picker and Quick add (sale, expense, invoice, purchase) |
| 1024–1279px | Same, with a collapsible sidebar |
| 768–1023px | Icon rail with tooltips, tables with fewer columns |
| Under 768px | Bottom bar (Home, Cash book, Invoices, Staff, More). Tables become stacked cards. Forms open as full-screen sheets |

**Navigation groups:** Overview · Sales (Clients, Invoices) · Purchases (Suppliers, Purchases) · Money (Cash book, Recurring, Banks & loans) · People (Staff, Attendance, Salary sheet, Advances) · Stock · Reports · System (Recycle bin, Settings). Modules that are switched off disappear. Every page has its own URL, so Back and bookmarks work.

### Components

| Component | Behaviour |
|---|---|
| **Table** | Sortable headers, search, filters, sticky header, totals row, a row action menu, and "show more" after 100 rows. Separate empty states for "nothing yet" (with the next step) and "no matches" (with Clear filters) |
| **Form** | Visible labels, inline errors tied to fields for screen readers, focus moves to the first error, and helper text where a field needs explaining |
| **Modal** | Native `<dialog>`, focus trapped and returned to the opener, Esc closes, and a warning if you'd lose unsaved typing |
| **Toast** | Announced to screen readers, reachable by keyboard, up to 3 stacked |
| **Chart** | Small hand-written SVG with the numbers also available as a table |

**Keyboard:** skip link, visible 2px focus ring, `/` to search, `N` for a new record, `?` to list shortcuts, and arrow keys plus P, A, H, L in the attendance grid.

**Print:** always light theme, A4, with repeating table headers and no app chrome.

**Performance budget:** app code, styles and fonts under 350 KB in total before compression, and no third-party requests at all.

---

## 7. Screen highlights

- **Dashboard:** cash and bank, receivables, payables, this month's profit, salaries to pay, low stock, overdue and due soon, 6-month trend, recent activity, backup reminder, and a setup checklist for new users.
- **Attendance:** a spreadsheet-style month grid with a sticky name column on desktop, and one person at a time with next and previous on phones.
- **Staff:** the 9-column inline-edit table is replaced with a searchable list, a form, a detail page, and a CSV import with a preview step.
- **Empty states:** every page says what belongs there and offers the next step.

---

## 8. Test plan

### Unit tests (`node --test`, no dependencies)

| Area | What's proven |
|---|---|
| Existing 14 tests | Same expected numbers. Only imports and renamed fields change |
| `migrate` | v1 sample, empty data, `dutypay:v1`, missing fields, text where numbers belong, orphaned staff, overpaid invoices, unknown accounts, unsafe IDs, newer-version refusal, running twice gives the same result |
| Golden figures | Live sample data still gives bank total ₹8,34,481, owed by clients ₹1,70,150, salaries to pay ₹49,771, gross ₹1,04,871, net ₹71,771 |
| `documents` | Mixed GST rates, tax-inclusive entry, IGST or CGST + SGST, paise rounding on many lines, overpayment, settlement allocation |
| `ledger` | Each account equals opening + all its postings. Untracked entries never change a balance. Transfers net to zero |
| `stock` | Average cost with backdated purchases, selling below zero, edit and delete of linked invoices |
| `reports` | Each "built-in check" in section 3.5, the worked profit example in section 2.2, and financial-year boundaries |
| `bin` | For every record type, delete then restore gives back exactly the same data. Restore after the parent is purged |
| `dates` | The IST midnight bug, month-end due days, February |
| `csv` | Formula guard, while negative numbers stay as numbers |
| Static checks | No `confirm`, `alert` or `prompt`, no emoji characters, no raw colours outside `tokens.css`, contrast of every token pair |

### Browser tests (Playwright + axe-core)

**Every page, on every one of the 4 widths, in both themes.** Each run fails on any console error, uncaught error, failed request, third-party request, horizontal overflow, or axe WCAG AA violation. Screenshots are saved each run.

| Flow | Checks |
|---|---|
| New user | Welcome form with validation, categories seeded, never asked again after reload |
| Upgrading user | Seed real v1 data, load the app, figures match. Old data untouched. Failed verification shows the rescue screen |
| Parity | One test per feature in section 3.6, including payslip print, payout CSV and WhatsApp copy |
| Safe delete | Modal text, Undo within 8 seconds, restore and purge from the bin, for each record type |
| Credit | Credit purchase creates a payable, settle moves the bank balance, and ageing updates |
| Stock | Stock in and out, low-stock alert on the dashboard, invoice reduces stock, switching the module off and on |
| Reports | Downloaded CSV values match the screen. Print output renders as a real PDF in Chromium |
| Backup | Backup then restore gives identical data. Old backups load |
| Keyboard | Complete an invoice using only the keyboard. Focus returns correctly after modals |
| Multi-tab | Changes in one tab appear in the other without being lost |
| Sample mode | Real data is untouched after entering and leaving sample mode |

**Browsers:** Chromium everywhere, using your installed Chrome locally. Firefox and WebKit smoke tests run in CI only.

**Manual checks at M9:** keyboard-only pass, screen reader spot check, and 200% zoom. Automated accessibility tools catch only part of what matters, so this step stays.

### CI

Node moves to 24, because Node 20 is past end of life and Node 22 follows in April 2027. Two jobs run on every push and PR: `unit` and `e2e`, with screenshots attached when something fails.

---

## 9. Milestones

Each milestone is a series of small commits on `v2`. **Each ends with all tests passing, plus screenshots at 375px and 1440px and a short summary from me, then I continue.** I'll stop and ask before anything destructive or anything that changes this plan.

| # | Milestone | Delivers | Done when |
|---|---|---|---|
| **M0** | Safety net | `v2` branch, v1 fixtures captured from the live app, before screenshots, Playwright and axe set up, CI on Node 24, GitHub sign-in | CI is green on `v2`. Your live site is unchanged |
| **M1** | Core and migration | All `core/` calculation modules, schema v2, `migrate` and `verifyMigration`, `bin`, `store`. Old UI still in place | Golden figures match. All migration cases pass. Date bug fixed |
| **M2** | Design system and shell | Tokens, both themes, components, navigation, router, crash screen, CSP, delete modal, Undo toast, Recycle Bin page | Components pass axe at all widths in both themes |
| **M3** | Onboarding and Settings | Welcome flow, presets, logo, financial year, currency, upgrade flow and notice, module switches, safe backup and restore, sample mode, first dashboard | New and upgrading user flows pass |
| **M4** | People | Staff and detail page, attendance grid, pay sheet, salary sheet, on hold, payslips, payout CSV, WhatsApp summary, advances | Payroll figures match v1 for the same data |
| **M5** | Sales and money | Clients, invoices with IGST, mixed rates, tax-inclusive entry, part payments, TDS and print. Cash book, recurring with frequencies, banks and loans. Cash, Bank and UPI on every form | **Parity checkpoint:** every feature in section 3.6 works on the new UI and v1's code is removed |
| **M6** | Credit and suppliers | Suppliers, purchases, Credit mode, receivables, payables, Settle, opening balances | Credit flow passes. Totals tie to the ledger |
| **M7** | Stock | Items, stock in and out, history, low stock, valuation, invoice link, on/off switch | Stock flow passes. Average cost tests pass |
| **M8** | Reports and dashboard | All 6 reports with date ranges, CSV and print. Final dashboard with trend | Every built-in check passes on sample data |
| **M9** | Hardening | Accessibility, responsive and print review of every screen, cross-browser, performance budget, offline support | All browser tests pass across widths and themes. Manual checks done |
| **M10** | Repo polish | README with screenshots, demo GIF, feature list, quick start, FAQ (including browser storage limits), privacy note and roadmap. CONTRIBUTING, CHANGELOG, issue and PR templates, description and topic suggestions. MIT licence kept | Links and images work. A fresh clone runs by following the README |
| **M11** | Release | Open a PR from `v2` to `main`, final upgrade test on real v1 data, **your approval**, merge, `v2.0.0` tag and release notes | Live site verified after the merge, including an upgrade from v1 data |

M4 and M5 are the largest. Between M2 and M5 the `v2` branch won't have every page working yet, which is fine because it isn't live.

**Suggested GitHub settings for you to set at M10**
- **Description:** Free, private accounts for small businesses: payroll, GST invoices, stock, payables and reports. Runs entirely in your browser.
- **Topics:** `accounting`, `bookkeeping`, `payroll`, `invoicing`, `gst`, `inventory-management`, `small-business`, `india`, `offline-first`, `vanilla-javascript`, `no-backend`, `privacy-first`

---

## 10. Requirement coverage

| Your requirement | Plan section | Milestone |
|---|---|---|
| 1. Onboarding, presets, Settings | 3.1 | M3 |
| 2. Safe deletes, Recycle Bin, Undo | 3.2 | M2, then every page |
| 3. Stock module | 3.3 | M7 |
| 4. Payment modes, credit, suppliers, settle | 3.4 | M5, M6 |
| 5. UI, themes, tables, forms, accessibility, responsive | 6, 7 | M2, then every page, reviewed in M9 |
| 6. Reports, CSV, print | 3.5 | M8 |
| 7. Keep features, migrate data, bump schema | 3.6, 4 | M1, M3, M5 |
| 8. Pure functions, tests, CI, browser testing | 5, 8 | M0, then every milestone |
| 9. Repo polish | 9 | M10 |

---

## 11. Review focus

The cases most likely to hurt a real person if they go wrong. Each has a test in the milestone shown.

1. **Someone with years of real data opens the new version.** Every balance, invoice and pay figure must match, and a failure must leave their data recoverable. (M1, M3)
2. **A delete is restored after its parent is gone,** or a client is deleted with half-settled invoices. No crash, and no money appearing or vanishing. (M2, M6)
3. **Money edge cases:** paying more than is owed, a settlement across many bills, paise rounding on long invoices, a date near midnight, or a financial-year boundary. Totals must still tie. (M1, M6, M8)
4. **Stock edge cases:** selling below zero, a backdated purchase, or editing an old invoice. Quantity, average cost and profit must all stay consistent. (M7)
5. **Data loss outside the app:** full storage, two open tabs, or a browser clearing site data (Safari can remove it after 7 days without a visit). Each needs a clear message, a backup nudge, and no silent overwrite. (M2, M3)
