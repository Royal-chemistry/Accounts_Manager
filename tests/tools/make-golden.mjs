// One-off: records what the v1 calculations say about each fixture, so the new code can be
// held to exactly the same figures. Uses a frozen copy of v1's calc.js. Each result is written to
// tests/fixtures/<name>.golden.json. Run with: node tests/tools/make-golden.mjs
import { readFile, writeFile } from "node:fs/promises";
import { bankBalances, cashSummary, computePay, invoiceTotals } from "../fixtures/v1-calc.js";

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const blank = () => ({
  settings: { agency: "", address: "", month: "2026-10", basis: "calendar", capAtFull: false, pf: false, esi: false, specialRate: 800, messRate: 140, gstRate: 18, prefix: "INV-", nextInv: 1, bankLine: "" },
  guards: [], entries: {}, cash: [], advances: [], salaryPaid: {}, clients: [], invoices: [], banks: [], transfers: [], loans: [], recurring: [],
});

function golden(raw) {
  const b = blank();
  const s = { ...b, ...raw, settings: { ...b.settings, ...raw.settings } };
  const balances = bankBalances({
    banks: s.banks, cash: s.cash, transfers: s.transfers,
    invoicePayments: s.invoices.flatMap((i) => i.payments || []),
    salaryPayments: Object.values(s.salaryPaid).flatMap((m) => Object.values(m)),
    advances: s.advances, loanPayments: s.loans.flatMap((l) => l.payments || []),
  });
  const invoices = Object.fromEntries(s.invoices.map((i) => [i.id, invoiceTotals(i)]));
  const months = [...new Set([...Object.keys(s.entries), ...s.advances.map((a) => String(a.date).slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m))])].sort();
  const pay = {}, profit = {};
  for (const month of months) {
    const logged = (gid) => s.advances.filter((a) => a.staffId === gid && String(a.date).startsWith(month)).reduce((t, a) => t + num(a.amount), 0);
    const results = Object.fromEntries(s.guards.map((g) => {
      const e = s.entries[month]?.[g.id] || {};
      return [g.id, computePay(g, { ...e, advance: num(e.advance) + logged(g.id) }, { ...s.settings, month })];
    }));
    pay[month] = results;
    const c = cashSummary(s.cash, month);
    const invoiceIn = s.invoices.flatMap((i) => i.payments || []).filter((p) => String(p.date).startsWith(month)).reduce((t, p) => t + num(p.amount), 0);
    const loanOut = s.loans.flatMap((l) => l.payments || []).filter((p) => String(p.date).startsWith(month)).reduce((t, p) => t + num(p.amount), 0);
    const salaries = Object.values(results).reduce((t, r) => t + Math.max(0, r.net) + r.advance, 0);
    profit[month] = { income: c.income + invoiceIn, expense: c.expense + loanOut, salaries, profit: c.income + invoiceIn - c.expense - loanOut - salaries };
  }
  return {
    counts: {
      staff: s.guards.length, clients: s.clients.length, invoices: s.invoices.length, cash: s.cash.length, advances: s.advances.length,
      banks: s.banks.length, transfers: s.transfers.length, loans: s.loans.length, recurring: s.recurring.length,
      salaryPayments: Object.values(s.salaryPaid).reduce((t, m) => t + Object.keys(m).length, 0),
      invoicePayments: s.invoices.reduce((t, i) => t + (i.payments || []).length, 0),
      loanPayments: s.loans.reduce((t, l) => t + (l.payments || []).length, 0),
    },
    balances,
    totalInAccounts: Math.round(Object.values(balances).reduce((t, v) => t + v, 0) * 100) / 100,
    invoices,
    owedByClients: Math.round(Object.values(invoices).reduce((t, v) => t + v.balance, 0) * 100) / 100,
    pay,
    profit,
  };
}

for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ["v1-sample", "v1-edge", "v1-empty", "dutypay-v1"]) {
  const raw = JSON.parse(await readFile(`tests/fixtures/${name}.json`, "utf8"));
  await writeFile(`tests/fixtures/${name}.golden.json`, JSON.stringify(golden(raw), null, 1) + "\n");
  console.log(`Wrote golden figures for ${name}`);
}
