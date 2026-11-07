// Banks, cash and loans. Balances are worked out from every payment you record.
import { toCSV } from "../core/csv.js";
import { formatDate } from "../core/dates.js";
import { uid } from "../core/ids.js";
import { accountBalances, loanOutstanding, loanPaid, postings, statement, suggestedInterest } from "../core/ledger.js";
import { num, round2, sumMoney } from "../core/money.js";
import { $, downloadFile, html, on, raw, setHTML } from "../ui/dom.js";
import { confirmDelete } from "../ui/confirm-delete.js";
import { openForm } from "../ui/form.js";
import { icon } from "../ui/icons.js";
import { createTable, emptyState } from "../ui/table.js";
import { toast } from "../ui/toast.js";
import { kpi, pageHead } from "./_common.js";
import { applyPayment, paymentField } from "./_money.js";

function accountForm(ctx, account = null) {
  openForm({
    ctx,
    title: account ? `Edit ${account.name}` : "Add account",
    values: account ? { ...account } : { kind: "bank", opening: 0 },
    fields: [
      { k: "name", label: "Account name", required: true, full: true, placeholder: "e.g. SBI current" },
      { k: "kind", label: "Type", type: "select", options: [["bank", "Bank account"], ["cash", "Cash"]] },
      { k: "accountNo", label: "Account number", hint: "Optional." },
      { k: "opening", label: "Opening balance", type: "money", allowZero: true, allowNegative: true, hint: "What it held when you started using this app." },
      ...(account ? [{ k: "active", label: "Active (shown when recording payments)", type: "checkbox", full: true }] : []),
    ],
    onSubmit(v) {
      ctx.store.update((s) => {
        const data = { name: v.name.trim(), kind: v.kind, accountNo: v.accountNo || "", opening: num(v.opening) };
        if (account) Object.assign(s.accounts.find((a) => a.id === account.id), data, { active: v.active !== false });
        else {
          const id = uid();
          s.accounts.push({ id, ...data, active: true });
          if (data.kind === "bank" && !s.settings.defaults.upiAccountId) s.settings.defaults.upiAccountId = id;
        }
      });
      toast(account ? "Saved" : `${v.name} added`);
    },
  });
}

function transferForm(ctx) {
  const open = ctx.state().accounts.filter((a) => a.active !== false);
  if (open.length < 2) { toast("Add at least two accounts first", { kind: "info" }); return; }
  const options = open.map((a) => [a.id, a.name]);
  openForm({
    ctx,
    title: "Transfer between accounts",
    values: { from: options[0][0], to: options[1][0], date: ctx.today() },
    submitLabel: "Transfer",
    fields: [
      { k: "from", label: "From", type: "select", options },
      { k: "to", label: "To", type: "select", options, validate: (v, all) => (v === all.from ? "Choose two different accounts" : "") },
      { k: "amount", label: "Amount", type: "money", required: true },
      { k: "date", label: "Date", type: "date", required: true },
      { k: "note", label: "Note", full: true },
    ],
    onSubmit(v) {
      ctx.store.update((s) => { s.transfers.push({ id: uid(), date: v.date, from: v.from, to: v.to, amount: num(v.amount), note: v.note || "" }); });
      toast("Transfer saved");
    },
  });
}

function matchForm(ctx, accountId = null) {
  const state = ctx.state();
  const open = state.accounts.filter((a) => a.active !== false);
  if (!open.length) { toast("Add an account first", { kind: "info" }); return; }
  const balances = accountBalances(state);
  openForm({
    ctx,
    title: "Match to your real balance",
    intro: "Enter what the account actually holds. The difference is recorded as an adjustment, and isn't counted in profit.",
    values: { accountId: accountId || open[0].id },
    submitLabel: "Adjust",
    fields: [
      { k: "accountId", label: "Account", type: "select", full: true, options: open.map((a) => [a.id, `${a.name}: ${ctx.money(balances[a.id] ?? 0)} here`]) },
      { k: "actual", label: "Actual balance", type: "money", required: true, allowZero: true, allowNegative: true },
    ],
    onSubmit(v) {
      const current = accountBalances(ctx.state())[v.accountId] ?? 0;
      const diff = round2(num(v.actual) - current);
      if (!diff) { toast("It already matches", { kind: "info" }); return; }
      const account = ctx.state().accounts.find((a) => a.id === v.accountId);
      ctx.store.update((s) => {
        s.transactions.push({
          id: uid(), type: diff > 0 ? "income" : "expense", date: ctx.today(), category: "Balance adjustment", note: "Matched to the real balance", amount: Math.abs(diff), gstAmount: 0, scope: "business",
          partyType: null, partyId: null, due: "", recurringId: null, stockLine: null, payments: [], mode: account.kind === "cash" ? "cash" : "bank", accountId: v.accountId, untracked: false,
        });
      });
      toast(`Adjusted by ${diff > 0 ? "+" : "-"}${ctx.money(Math.abs(diff))}`);
    },
  });
}

function loanForm(ctx, loan = null) {
  openForm({
    ctx,
    title: loan ? `Edit ${loan.name}` : "Add loan",
    values: loan ? { ...loan, closed: loan.status === "closed" } : {},
    fields: [
      { k: "name", label: "Loan name", required: true, full: true, placeholder: "e.g. Delivery van loan" },
      { k: "lender", label: "Lender" },
      { k: "principal", label: "Amount borrowed", type: "money", allowZero: true },
      { k: "outstanding", label: "Left to repay today", type: "money", required: true, allowZero: true },
      { k: "rate", label: "Interest rate (% a year)", type: "number", allowZero: true, hint: "Used to suggest the interest part of each payment." },
      { k: "emi", label: "EMI", type: "money", allowZero: true },
      { k: "dueDay", label: "EMI day of the month", type: "number", allowZero: true, max: 31 },
      ...(loan ? [{ k: "closed", label: "This loan is closed", type: "checkbox", full: true }] : []),
    ],
    onSubmit(v) {
      ctx.store.update((s) => {
        const data = {
          name: v.name.trim(), lender: v.lender || "", principal: v.principal === "" ? "" : num(v.principal), rate: v.rate === "" ? "" : num(v.rate), emi: num(v.emi), dueDay: v.dueDay === "" ? "" : num(v.dueDay),
          outstanding: num(v.outstanding), since: ctx.today(), status: v.closed ? "closed" : "active",
        };
        if (loan) Object.assign(s.loans.find((l) => l.id === loan.id), data);
        else s.loans.push({ id: uid(), ...data, payments: [] });
      });
      toast(loan ? "Saved" : `${v.name} added`);
    },
  });
}

function loanPayForm(ctx, loan) {
  openForm({
    ctx,
    title: `Pay ${loan.name}`,
    intro: `${ctx.money(loanOutstanding(loan))} left to repay. Only the interest part counts as a cost in your profit.`,
    values: { date: ctx.today(), amount: loan.emi || "", interest: suggestedInterest(loan) || "" },
    submitLabel: "Save payment",
    fields: [
      { k: "date", label: "Paid on", type: "date", required: true },
      { k: "amount", label: "Amount paid", type: "money", required: true },
      { k: "interest", label: "Of which interest", type: "money", allowZero: true, hint: "Check your loan statement. The rest reduces what you owe.", validate: (v, all) => (num(v) > num(all.amount) ? "Interest can't be more than the amount paid" : "") },
      paymentField("loan", { label: "How was it paid?" }),
    ],
    onSubmit(v) {
      ctx.store.update((s) => {
        const doc = s.loans.find((l) => l.id === loan.id);
        doc.payments ??= [];
        doc.payments.push(applyPayment({ id: uid(), date: v.date, amount: num(v.amount), interest: v.interest === "" ? null : num(v.interest) }, v.payment));
        if (loanOutstanding(doc) <= 0) doc.status = "closed";
      });
      const after = ctx.state().loans.find((l) => l.id === loan.id);
      toast(after.status === "closed" ? `${loan.name} is fully repaid` : "Payment saved");
    },
  });
}

function accountsTab(host, ctx) {
  const state = ctx.state();
  const balances = accountBalances(state);
  const accounts = state.accounts;
  setHTML(host, accounts.length ? html`
    <div class="grid grid-3">
      ${accounts.map((a) => html`
        <section class="card account-card ${a.active === false ? "account-closed" : ""}">
          <div class="row-between">
            <div class="grow">
              <h2 class="wrap-anywhere"><a class="plain-link" href="#/banks/${a.id}">${a.name}</a></h2>
              <p class="small muted">${a.kind === "cash" ? "Cash" : "Bank"}${a.accountNo ? ` · ${a.accountNo}` : ""}${a.active === false ? " · Closed" : ""}</p>
            </div>
            <span class="row-actions">
              <button type="button" class="icon-btn" data-edit-account="${a.id}" aria-label="Edit ${a.name}" title="Edit">${icon("edit")}</button>
              <button type="button" class="icon-btn icon-btn-danger" data-delete-account="${a.id}" aria-label="Delete ${a.name}" title="Delete">${icon("trash")}</button>
            </span>
          </div>
          <p class="account-balance num ${balances[a.id] < 0 ? "text-danger" : ""}">${ctx.money(balances[a.id] ?? 0)}</p>
          <div class="row-between">
            <span class="small muted">Opening ${ctx.money(a.opening || 0)}</span>
            <button type="button" class="btn btn-sm" data-match="${a.id}">Match balance</button>
          </div>
        </section>`)}
    </div>` : html`<section class="card">${emptyState({ icon: "bank", title: "No accounts yet", hint: "Add your bank accounts, and payments will update their balances." })}</section>`);
  on(host, "click", "[data-edit-account]", (e, b) => accountForm(ctx, ctx.state().accounts.find((a) => a.id === b.dataset.editAccount)));
  on(host, "click", "[data-delete-account]", (e, b) => confirmDelete(ctx, "account", b.dataset.deleteAccount));
  on(host, "click", "[data-match]", (e, b) => matchForm(ctx, b.dataset.match));
}

function loansTab(host, ctx) {
  setHTML(host, html`<section class="card card-flush" data-table></section>`);
  const rows = () => ctx.state().loans;
  createTable($("[data-table]", host), {
    id: "loans", label: "Loans",
    rows,
    defaultSort: { key: "name", dir: "asc" },
    rowClass: (l) => (l.status === "closed" ? "row-inactive" : ""),
    columns: [
      { key: "name", label: "Loan", sortable: true, mobile: "title", render: (l) => html`<span class="cell-title">${l.name}</span><span class="cell-sub">${l.lender}${l.rate ? ` · ${l.rate}% a year` : ""}</span>` },
      { key: "dueDay", label: "EMI day", align: "num", mobile: "meta", render: (l) => l.dueDay || "—" },
      { key: "emi", label: "EMI", align: "num", sortable: true, mobile: "detail", render: (l) => ctx.money(l.emi || 0) },
      { key: "paid", label: "Paid so far", align: "num", sortable: true, mobile: "detail", value: (l) => loanPaid(l), render: (l) => ctx.money(loanPaid(l)) },
      { key: "left", label: "Left to repay", align: "num", sortable: true, mobile: "amount", value: (l) => loanOutstanding(l), render: (l) => html`<span class="strong">${ctx.money(loanOutstanding(l))}</span>` },
      { key: "status", label: "Status", mobile: "status", render: (l) => (l.status === "closed" ? html`<span class="badge">Closed</span>` : html`<span class="badge badge-success">Active</span>`) },
    ],
    actions: (l) => [
      ...(l.status !== "closed" ? [{ label: "Pay", icon: "check", primary: true, onClick: () => loanPayForm(ctx, l) }] : []),
      { label: "Edit", icon: "edit", onClick: () => loanForm(ctx, l) },
      { label: "Delete", icon: "trash", danger: true, onClick: () => confirmDelete(ctx, "loan", l.id) },
    ],
    empty: { icon: "bank", title: "No loans", hint: "Add a loan to track EMIs and what's left to repay.", action: html`<button type="button" class="btn btn-primary" data-add-loan>${icon("plus")}Add loan</button>` },
  });
}

const accountName = (state, id) => state.accounts.find((a) => a.id === id)?.name || "Unknown account";

function activityTab(host, ctx) {
  const state = ctx.state();
  setHTML(host, html`<section class="card card-flush" data-table></section>`);
  const rows = () => postings(ctx.state()).filter((p) => !p.untracked && p.date);
  const money = (n) => ctx.money(n);
  const table = createTable($("[data-table]", host), {
    id: "activity", label: "Account activity",
    rows,
    rowId: (p) => p.id,
    defaultSort: { key: "date", dir: "desc" },
    search: { placeholder: "Search activity", text: (p) => `${p.label} ${accountName(ctx.state(), p.accountId)}` },
    filters: [{ key: "account", label: "All accounts", options: state.accounts.map((a) => [a.id, a.name]), test: (p, v) => p.accountId === v }],
    toolbar: html`<button type="button" class="btn" data-activity-csv>${icon("download")}CSV</button>`,
    columns: [
      { key: "date", label: "Date", sortable: true, mobile: "meta", render: (p) => formatDate(p.date) },
      { key: "label", label: "What", sortable: true, mobile: "title", render: (p) => html`<span class="cell-title wrap">${p.label}</span>` },
      { key: "account", label: "Account", sortable: true, mobile: "meta", value: (p) => accountName(ctx.state(), p.accountId), render: (p) => accountName(ctx.state(), p.accountId) },
      { key: "in", label: "In", align: "num", sortable: true, mobile: "amount", value: (p) => (p.amount > 0 ? p.amount : ""), isZero: (p) => p.amount <= 0, render: (p) => (p.amount > 0 ? html`<span class="text-success">${money(p.amount)}</span>` : "") },
      { key: "out", label: "Out", align: "num", sortable: true, mobile: "amount", value: (p) => (p.amount < 0 ? -p.amount : ""), isZero: (p) => p.amount >= 0, render: (p) => (p.amount < 0 ? money(-p.amount) : "") },
    ],
    actions: (p) => (p.kind === "transfer" ? [{ label: "Delete transfer", icon: "trash", danger: true, onClick: () => confirmDelete(ctx, "transfer", p.sourceId) }] : []),
    empty: { icon: "book", title: "No activity yet", hint: "Payments linked to an account show here." },
  });
  on(host, "click", "[data-activity-csv]", () => {
    downloadFile("account-activity.csv", toCSV([["Date", "What", "Account", "Amount"], ...table.visibleRows().map((p) => [p.date, p.label, accountName(ctx.state(), p.accountId), p.amount])]));
  });
}

function renderStatement(root, ctx, id) {
  const state = ctx.state();
  const account = state.accounts.find((a) => a.id === id);
  if (!account) {
    setHTML(root, html`<div class="page">${pageHead({ title: "Account not found", back: { page: "banks", label: "Banks & loans" } })}<section class="card">${emptyState({ icon: "bank", title: "This account doesn't exist", hint: "It may have been deleted. Check the Recycle Bin." })}</section></div>`);
    return;
  }
  const st = statement(state, id);
  const money = (n) => ctx.money(n, { decimals: 2 });
  setHTML(root, html`
    <div class="page">
      ${pageHead({
        title: account.name, art: account.name, back: { page: "banks", label: "Banks & loans" },
        sub: `${account.kind === "cash" ? "Cash" : "Bank"}${account.accountNo ? ` · ${account.accountNo}` : ""}`,
        actions: html`<button type="button" class="btn" data-match-here>Match balance</button>`,
      })}
      <div class="kpis">
        ${kpi({ label: "Opening balance", value: ctx.money(account.opening || 0), ic: "bank" })}
        ${kpi({ label: "Current balance", value: ctx.money(st.closing), ic: "wallet", tone: st.closing < 0 ? "bad" : "" })}
        ${kpi({ label: "Entries", value: st.rows.length, ic: "book" })}
      </div>
      <section class="card card-flush" data-table></section>
    </div>`);
  createTable($("[data-table]", root), {
    id: "statement", label: `Statement for ${account.name}`,
    rows: () => st.rows,
    rowId: (p) => p.id,
    search: { placeholder: "Search this statement", text: (p) => p.label },
    columns: [
      { key: "date", label: "Date", mobile: "meta", render: (p) => formatDate(p.date) },
      { key: "label", label: "What", mobile: "title", render: (p) => html`<span class="cell-title wrap">${p.label}</span>` },
      { key: "in", label: "In", align: "num", mobile: "amount", isZero: (p) => p.amount <= 0, render: (p) => (p.amount > 0 ? html`<span class="text-success">${money(p.amount)}</span>` : "") },
      { key: "out", label: "Out", align: "num", mobile: "amount", isZero: (p) => p.amount >= 0, render: (p) => (p.amount < 0 ? money(-p.amount) : "") },
      { key: "balance", label: "Balance", align: "num", mobile: "detail", render: (p) => money(p.balance) },
    ],
    empty: { icon: "book", title: "No activity yet", hint: "Payments made to or from this account show here." },
  });
  on(root, "click", "[data-match-here]", () => matchForm(ctx, id));
}

const TABS = [["accounts", "Accounts"], ["loans", "Loans"], ["activity", "Activity"]];

export default {
  id: "banks",
  title: "Banks & loans",
  render(root, ctx, params) {
    const isTab = TABS.some(([id]) => id === params[0]);
    if (params[0] && !isTab) { renderStatement(root, ctx, params[0]); return; }
    const tab = isTab ? params[0] : "accounts";
    const state = ctx.state();
    const balances = accountBalances(state);
    const cash = sumMoney(state.accounts.filter((a) => a.kind === "cash").map((a) => balances[a.id]));
    const bank = sumMoney(state.accounts.filter((a) => a.kind !== "cash").map((a) => balances[a.id]));
    const debt = sumMoney(state.loans.filter((l) => l.status !== "closed").map(loanOutstanding));
    const emis = sumMoney(state.loans.filter((l) => l.status !== "closed").map((l) => l.emi));
    const unlinked = postings(state).filter((p) => p.untracked && p.kind !== "transfer").length;
    setHTML(root, html`
      <div class="page">
        ${pageHead({
          title: "Banks & loans",
          sub: "Balances update from every payment you record.",
          actions: html`
            <button type="button" class="btn" data-transfer>${icon("transfer")}Transfer</button>
            ${tab === "loans"
              ? html`<button type="button" class="btn btn-primary" data-add data-add-loan>${icon("plus")}Add loan</button>`
              : html`<button type="button" class="btn btn-primary" data-add data-add-account>${icon("plus")}Add account</button>`}`,
        })}
        <div class="kpis">
          ${kpi({ label: "In banks", value: ctx.money(bank), ic: "bank", tone: bank < 0 ? "bad" : "" })}
          ${kpi({ label: "Cash in hand", value: ctx.money(cash), ic: "cash", tone: cash < 0 ? "bad" : "" })}
          ${kpi({ label: "Loans left to repay", value: ctx.money(debt, { decimals: 0 }), ic: "wallet", tone: debt ? "warn" : "" })}
          ${kpi({ label: "Monthly EMIs", value: ctx.money(emis, { decimals: 0 }), ic: "repeat" })}
        </div>
        ${unlinked ? html`<div class="banner">${icon("info")}<p>${unlinked} older ${unlinked === 1 ? "entry isn't" : "entries aren't"} linked to any account, so ${unlinked === 1 ? "it isn't" : "they aren't"} counted in these balances. Use Match balance to set your real cash figure.</p></div>` : ""}
        <nav class="tabs" aria-label="Banks and loans sections">
          ${TABS.map(([id, label]) => html`<a class="tab" href="#/banks/${id}" ${id === tab ? raw('aria-current="page"') : ""}>${label}</a>`)}
        </nav>
        <div data-tab></div>
      </div>`);
    const host = $("[data-tab]", root);
    ({ accounts: accountsTab, loans: loansTab, activity: activityTab })[tab](host, ctx);
    on(root, "click", "[data-add-account]", () => accountForm(ctx));
    on(root, "click", "[data-add-loan]", () => loanForm(ctx));
    on(root, "click", "[data-transfer]", () => transferForm(ctx));
  },
};
