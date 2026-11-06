// A made-up business for exploring the app. Dates are relative to today so it always looks current.
// Names, account numbers and tax IDs here are fictional.
import { addMonths, dayInMonth, daysInMonth, monthOf } from "./dates.js";
import { round2 } from "./money.js";
import { payFor } from "./payroll.js";
import { presetFor } from "./presets.js";
import { blank } from "./schema.js";
import { gstinCheckChar } from "./validate.js";

const gstin = (first14) => first14 + gstinCheckChar(first14);

export function sample(today) {
  const s = blank(today);
  const now = monthOf(today);
  const last = addMonths(now, -1);
  const prior = addMonths(now, -2);
  const on = (month, day) => dayInMonth(month, day);
  const bank = (id) => ({ mode: "bank", accountId: id, untracked: false });
  const upi = { mode: "upi", accountId: "acct-current", untracked: false };
  const cash = { mode: "cash", accountId: "acct-cash", untracked: false };
  const credit = { mode: "credit", accountId: null, untracked: false };
  const current = bank("acct-current");
  let n = 0;
  const pid = () => `sample-${++n}`;
  const pay = (date, amount, how, extra = {}) => ({ id: pid(), date, amount, tds: 0, note: "", settlementId: null, ...how, ...extra });

  const preset = presetFor("trading");
  s.profile = {
    ...s.profile, onboarded: true, name: "Sunrise Traders", type: "trading", address: "14 Market Road, Kochi, Kerala 682011",
    gstin: gstin("32ABCDE1234F1Z"), stateCode: "32", phone: "+91 98000 00000", email: "accounts@sunrise.example", fyStartMonth: 4, currency: "INR",
  };
  s.settings.month = last;
  s.settings.modules = { stock: true, payroll: true, gst: true };
  s.settings.pay = { ...s.settings.pay, extraRate: 500, foodRate: 100 };
  s.settings.invoice = { ...s.settings.invoice, prefix: "ST-", nextNo: 7, bankLine: "Federal Bank A/c XXXXXX4521, IFSC FDRL000XXXX, UPI sunrise@upi", terms: "Payment due within 15 days. Thank you for your business." };
  s.settings.defaults = { cashAccountId: "acct-cash", upiAccountId: "acct-current" };
  s.categories = { expense: preset.expense, income: preset.income, units: preset.units, stock: ["Packaging", "Stationery", "Cleaning"] };

  s.accounts = [
    { id: "acct-current", name: "Current account", kind: "bank", accountNo: "XXXXXX4521", opening: 240000, active: true },
    { id: "acct-savings", name: "Savings", kind: "bank", accountNo: "XXXXXX8890", opening: 85000, active: true },
    { id: "acct-cash", name: "Cash in hand", kind: "cash", accountNo: "", opening: 12000, active: true },
  ];

  const people = [
    ["Rajesh K", "Main shop", 15500, "Store manager", 31, 2, 26], ["Suresh P", "Main shop", 15500, "Sales", 30, 0, 30], ["Anitha M", "Billing", 14000, "Billing", 26, 0, 0],
    ["Biju Thomas", "Billing", 14000, "Billing", 30, 1, 0], ["Manoj V", "Warehouse", 15500, "Storekeeper", 27, 0, 0], ["Sreeja R", "Warehouse", 15500, "Packing", 20, 0, 0],
    ["Vinod Kumar", "Delivery", 20000, "Driver", 23, 3, 23], ["Joseph Mathew", "Delivery", 20000, "Driver", 12, 0, 12],
  ];
  s.staff = people.map(([name, team, salary, position], i) => ({
    id: `staff-${i}`, name, code: `E${String(i + 1).padStart(3, "0")}`, team, position, joinedOn: `20${19 + i % 5}-0${(i % 8) + 1}-01`, active: true, salary,
    bank: i % 2 ? "Federal Bank" : "State Bank of India", account: `XXXXXXXX${1200 + i * 37}`, ifsc: i % 2 ? "FDRL0001234" : "SBIN0001234", upi: i === 5 ? "sreeja@upi" : "", phone: "",
  }));
  const monthDays = daysInMonth(last);
  s.entries[last] = Object.fromEntries(people.map(([, , , , days, extra, food], i) => [`staff-${i}`, {
    daysWorked: i === 1 ? "" : Math.min(days, monthDays), extraShifts: extra || "", extraRate: 500, bonus: "", advance: "", foodDays: Math.min(food, monthDays) || "", foodRate: 100, kit: i === 6 ? 1000 : "", other: "", hold: i === 7,
  }]));
  // One person's month comes from the attendance grid, to show how it feeds pay.
  s.attendance[last] = { "staff-1": Object.fromEntries(Array.from({ length: monthDays }, (_, d) => [String(d + 1).padStart(2, "0"), d === 12 ? "A" : d === 20 ? "H" : "P"])) };
  s.advances = [["staff-0", 8, 2000, cash], ["staff-0", 22, 2000, current], ["staff-2", 15, 2000, cash], ["staff-3", 22, 3000, current], ["staff-4", 10, 5000, current], ["staff-6", 18, 3000, upi], ["staff-7", 5, 6000, current]]
    .map(([staffId, day, amount, how], i) => ({ id: `advance-${i}`, staffId, date: on(last, day), amount, note: "", ...how }));
  const salary = (id, staffIndex, how) => ({ id, staffId: `staff-${staffIndex}`, month: last, date: on(now, 2), amount: payFor(s, s.staff[staffIndex], last).net, ...how });
  s.salaryPayments = [salary("salary-1", 1, current), salary("salary-2", 5, upi)];

  s.clients = [
    { id: "client-1", name: "Harbour View Hotel", contact: "Anil (Purchase)", phone: "+91 98000 11111", email: "", gstin: gstin("32AAACH1234A1Z"), stateCode: "32", address: "Marine Drive, Kochi", rate: 0, gst: true, active: true },
    { id: "client-2", name: "St. Mary's School", contact: "Principal", phone: "", email: "", gstin: "", stateCode: "", address: "Ernakulam", rate: 0, gst: false, active: true },
    { id: "client-3", name: "Coastal Chemicals Pvt Ltd", contact: "Accounts", phone: "", email: "", gstin: gstin("32AAECC1234B1Z"), stateCode: "32", address: "Eloor, Kochi", rate: 0, gst: true, active: true },
    { id: "client-4", name: "Bengaluru Retail Co", contact: "Priya", phone: "", email: "", gstin: gstin("29AAFCB1234C1Z"), stateCode: "29", address: "Indiranagar, Bengaluru", rate: 0, gst: true, active: true },
  ];
  s.suppliers = [
    { id: "supplier-1", name: "Malabar Packaging", contact: "Sales desk", phone: "+91 98000 22222", email: "", gstin: gstin("32AABCM1234D1Z"), stateCode: "32", address: "Aluva", active: true },
    { id: "supplier-2", name: "Deccan Paper Mills", contact: "Ravi", phone: "", email: "", gstin: gstin("36AABCD1234E1Z"), stateCode: "36", address: "Hyderabad", active: true },
    { id: "supplier-3", name: "City Cleaning Supplies", contact: "", phone: "", email: "", gstin: "", stateCode: "", address: "Kochi", active: true },
  ];

  s.items = [
    { id: "item-1", name: "Corrugated box (medium)", sku: "BOX-M", category: "Packaging", unit: "pcs", purchasePrice: 22, salePrice: 35, gstRate: 18, hsn: "4819", openingQty: 400, openingCost: 20, reorderLevel: 150, active: true },
    { id: "item-2", name: "Packing tape", sku: "TAPE-48", category: "Packaging", unit: "pcs", purchasePrice: 28, salePrice: 45, gstRate: 18, hsn: "3919", openingQty: 120, openingCost: 28, reorderLevel: 100, active: true },
    { id: "item-3", name: "A4 paper ream", sku: "A4-75", category: "Stationery", unit: "pack", purchasePrice: 240, salePrice: 310, gstRate: 12, hsn: "4802", openingQty: 60, openingCost: 235, reorderLevel: 40, active: true },
    { id: "item-4", name: "Floor cleaner 5L", sku: "CLN-5L", category: "Cleaning", unit: "pcs", purchasePrice: 310, salePrice: 420, gstRate: 18, hsn: "3402", openingQty: 18, openingCost: 300, reorderLevel: 10, active: true },
    { id: "item-5", name: "Delivery bags (bundle)", sku: "BAG-100", category: "Packaging", unit: "pack", purchasePrice: 180, salePrice: 260, gstRate: 5, hsn: "3923", openingQty: 25, openingCost: 180, reorderLevel: 12, active: true },
  ];

  const line = (item, qty, rate, gstRate) => ({ desc: item.name, hsn: item.hsn, qty, rate, gstRate, itemId: item.id });
  const [box, tape, paper, cleaner, bags] = s.items;
  s.invoices = [
    { id: "inv-1", no: "ST-001", clientId: "client-1", date: on(prior, 12), due: on(prior, 27), placeOfSupply: "", taxInclusive: false, reducesStock: true, lines: [line(box, 200, 35, 18), line(tape, 40, 45, 18)], payments: [pay(on(prior, 26), round2((7000 + 1800) * 1.18), current)] },
    { id: "inv-2", no: "ST-002", clientId: "client-2", date: on(last, 3), due: on(last, 18), placeOfSupply: "", taxInclusive: false, reducesStock: true, lines: [{ ...line(paper, 80, 310, 0) }], payments: [pay(on(last, 16), 15000, bank("acct-savings"))] },
    { id: "inv-3", no: "ST-003", clientId: "client-3", date: on(last, 8), due: on(last, 23), placeOfSupply: "", taxInclusive: false, reducesStock: true, lines: [line(cleaner, 12, 420, 18), { desc: "Delivery charges", hsn: "9965", qty: 1, rate: 2500, gstRate: 18, itemId: null }], payments: [] },
    { id: "inv-4", no: "ST-004", clientId: "client-1", date: on(last, 14), due: on(last, 29), placeOfSupply: "", taxInclusive: false, reducesStock: true, lines: [line(box, 150, 35, 18), line(bags, 18, 260, 5)], payments: [pay(on(last, 28), 4000, upi, { tds: 100 })] },
    { id: "inv-5", no: "ST-005", clientId: "client-4", date: on(last, 20), due: on(now, 4), placeOfSupply: "", taxInclusive: false, reducesStock: false, lines: [{ desc: "Bulk order, shipped directly from supplier", hsn: "4819", qty: 1, rate: 92000, gstRate: 18, itemId: null }], payments: [] },
    { id: "inv-6", no: "ST-006", clientId: "client-3", date: on(now, 1), due: on(now, 16), placeOfSupply: "", taxInclusive: false, reducesStock: true, lines: [line(tape, 30, 45, 18)], payments: [] },
  ];
  s.purchases = [
    { id: "bill-1", billNo: "MP-2201", supplierId: "supplier-1", date: on(prior, 6), due: on(prior, 21), taxInclusive: false, lines: [line(box, 300, 22, 18)], payments: [pay(on(prior, 20), 7788, current)] },
    { id: "bill-2", billNo: "DP-881", supplierId: "supplier-2", date: on(last, 2), due: on(last, 17), taxInclusive: false, lines: [line(paper, 60, 240, 12)], payments: [pay(on(last, 15), 8000, current)] },
    { id: "bill-3", billNo: "MP-2240", supplierId: "supplier-1", date: on(last, 10), due: on(last, 25), taxInclusive: false, lines: [line(tape, 50, 28, 18), line(bags, 10, 180, 5)], payments: [] },
    { id: "bill-4", billNo: "CC-104", supplierId: "supplier-3", date: on(last, 19), due: on(now, 3), taxInclusive: false, lines: [{ desc: "Office cleaning service", hsn: "", qty: 1, rate: 3500, gstRate: 0, itemId: null }], payments: [] },
  ];
  s.stockMoves = [
    { id: "move-1", itemId: "item-1", date: on(last, 11), reason: "damage", qty: 12, unitCost: 0, note: "Water damage in the store room" },
    { id: "move-2", itemId: "item-4", date: on(last, 15), reason: "usage", qty: 2, unitCost: 0, note: "Used in the shop" },
  ];

  const entry = (id, type, date, category, note, amount, how, extra = {}) => ({ id, type, date, category, note, amount, gstAmount: 0, scope: "business", partyType: null, partyId: null, due: "", recurringId: null, stockLine: null, payments: [], ...how, ...extra });
  s.recurring = [
    { id: "rec-1", name: "Shop rent", category: "Rent", amount: 35000, frequency: "monthly", dueDay: 5, startMonth: prior, variable: false, active: true, note: "", paid: {}, ...current },
    { id: "rec-2", name: "Godown rent", category: "Godown rent", amount: 12000, frequency: "monthly", dueDay: 7, startMonth: prior, variable: false, active: true, note: "", paid: {}, ...current },
    { id: "rec-3", name: "Electricity", category: "Electricity", amount: 6800, frequency: "bimonthly", dueDay: 12, startMonth: prior, variable: true, active: true, note: "Varies each bill", paid: {}, ...current },
    { id: "rec-4", name: "Internet and phone", category: "Internet & phone", amount: 1499, frequency: "monthly", dueDay: 15, startMonth: prior, variable: false, active: true, note: "", paid: {}, ...upi },
    { id: "rec-5", name: "Accounting software", category: "Professional fees", amount: 11988, frequency: "yearly", dueDay: 20, startMonth: now, variable: false, active: true, note: "", paid: {}, ...current },
  ];
  s.transactions = [
    entry("tx-1", "income", on(last, 2), "Wholesale sales", "Week 1 counter sales", 182000, cash), entry("tx-2", "income", on(last, 9), "Wholesale sales", "Week 2 counter sales", 171500, upi),
    entry("tx-3", "income", on(last, 16), "Wholesale sales", "Week 3 counter sales", 165200, current), entry("tx-4", "income", on(last, 23), "Wholesale sales", "Week 4 counter sales", 190300, cash),
    entry("tx-5", "expense", on(last, 7), "Stock purchase", "Wholesale order", 96000, current), entry("tx-6", "expense", on(last, 18), "Transport", "Diesel for the van", 9200, cash),
    entry("tx-7", "expense", on(last, 25), "Stock purchase", "Wholesale order", 104000, current),
    entry("tx-8", "expense", on(last, 21), "Repairs", "Van service, on account", 5900, credit, { gstAmount: 900, gstRate: 18, partyType: "supplier", partyId: "supplier-3", due: on(now, 6) }),
    entry("tx-9", "income", on(last, 26), "Commission income", "Referral commission, on account", 8000, credit, { partyType: "client", partyId: "client-2", due: on(now, 10) }),
    entry("tx-10", "expense", on(last, 27), "Other", "Owner's personal phone bill", 1200, upi, { scope: "personal" }),
    entry("tx-11", "income", on(prior, 15), "Wholesale sales", "Monthly counter sales", 640000, current), entry("tx-12", "expense", on(prior, 18), "Stock purchase", "Wholesale order", 310000, current),
    entry("tx-13", "income", on(now, 1), "Wholesale sales", "Counter sales so far", 76000, cash),
    entry("tx-14", "expense", on(last, 28), "GST payment", "GST for the previous month", 18000, current),
  ];
  for (const [rIndex, month, day] of [[0, prior, 5], [0, last, 5], [1, prior, 7], [1, last, 7], [2, prior, 12], [3, prior, 15], [3, last, 15]]) {
    const r = s.recurring[rIndex];
    const id = `rec-entry-${rIndex}-${month}`;
    s.transactions.push(entry(id, "expense", on(month, day), r.category, r.name, r.amount, { mode: r.mode, accountId: r.accountId, untracked: false }, { recurringId: r.id }));
    r.paid[month] = id;
  }
  s.transfers = [{ id: "transfer-1", date: on(last, 24), from: "acct-cash", to: "acct-current", amount: 150000, note: "Cash deposit" }];
  s.loans = [{
    id: "loan-1", name: "Delivery van loan", lender: "HDFC Bank", principal: 600000, rate: 10.5, emi: 18500, dueDay: 10, outstanding: 412000, since: on(prior, 1), status: "active",
    payments: [{ id: "loan-pay-1", date: on(prior, 10), amount: 18500, interest: 3605, ...current }, { id: "loan-pay-2", date: on(last, 10), amount: 18500, interest: 3475, ...current }],
  }];
  return s;
}
