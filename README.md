# 🛡️ DutyPay — payroll for security guards

**Free payroll for small security agencies.** Turn a monthly duty register into a salary sheet, printable payslips and a bank/UPI payout list in a few minutes.

It runs entirely in your browser. There's no sign-up and no server, and your guards' data never leaves your computer.

**[▶ Open the app](https://royal-chemistry.github.io/dutypay/)**, then click **Load sample data** to try it.

![Salary sheet](docs/screenshot.png)

## Why this exists

Most payroll software is built for office staff on fixed salaries. Security agencies work differently:

- Guards are paid **per duty**, not per month. 27 duties in a 31-day month isn't the same as 27 in a 30-day month.
- Every month brings **advances**, **mess and food bills**, **uniform cuts** and **special duties** at other sites.
- Guards are spread across **many client sites**, and owners want totals per site.
- Salaries go out by **bank transfer or UPI**, often from a phone.

Small agencies end up doing all of this in a notebook or a fragile spreadsheet. DutyPay does exactly this job and nothing else.

## Features

- **Guards list:** name, site, monthly salary, bank account, IFSC and UPI. You can import a CSV.
- **Monthly duty register:** duties, special duties, bonus, advance, mess days, uniform and other cuts. Net pay updates as you type.
- **Three pay bases:** salary ÷ days in that month, ÷ 30, or ÷ 26. You can also cap pay at the monthly salary.
- **Optional PF and ESI** employee deductions.
- **Salary sheet** with totals and a **per-site summary**.
- **Printable payslips:** one per guard per page, with the amount in words.
- **Payout list CSV** with name, amount, account, IFSC and UPI, ready for bulk transfer.
- **WhatsApp summary:** one tap copies a text summary of the month.
- **Flags guards who owe money,** where deductions are more than pay, and leaves them out of the payout.
- **Backup and restore** as a single file. Works offline once loaded, and on phones too.

![Duty register](docs/register.png)

## How pay is calculated

```
per-duty rate = monthly salary ÷ divisor         (divisor = days in month, 30 or 26)
duty pay      = round(per-duty rate × duties)
gross         = duty pay + special duties × special rate + bonus
deductions    = advance + mess days × mess rate + uniform + other + PF + ESI
net pay       = gross − deductions
```

- **PF (optional):** 12% of duty pay, on wages up to ₹15,000.
- **ESI (optional):** 0.75% of gross, when gross is ₹21,000 or less.

Check these rates against your own registration and the current rules before relying on them.

## Run it yourself

It's plain HTML, CSS and JavaScript with no build step.

```bash
git clone https://github.com/Royal-chemistry/dutypay
cd dutypay
npx serve .          # or any static server, then open http://localhost:3000
npm test             # runs the calculation tests (Node 20+)
```

To host your own copy for free, fork the repo and turn on **Settings → Pages → Deploy from branch → main**.

## Your data

Everything is stored in your browser's local storage on that device only. Clearing browser data removes it, so use **Backup** regularly. The sample data uses made-up names and account numbers.

## Contributing

Ideas that would help agencies:

- Attendance import from a daily sheet
- Bank-specific bulk-payment formats (SBI, Federal, HDFC…)
- Malayalam, Hindi and Tamil translations
- Client invoices generated from the same duty register

Open an issue or a pull request.

## Licence

MIT © 2026 Aldrin Ann Thomas
