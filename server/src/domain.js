const ALLOWED_KINDS = new Set(["income", "expense", "withdrawal"]);
const ALLOWED_FIELDS = new Set(["date", "kind", "title", "amount", "counterparty", "category"]);
const ALLOWED_SUMMARY_FIELDS = new Set(["incomeTotal", "expenseTotal", "availableBalance"]);

function toCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error("Amount must be a finite number");
  return Math.round(amount * 100);
}

function fromCents(cents) {
  return (cents / 100).toFixed(2);
}

function isBalanceAllowed(balance, allowOverdraft) {
  return allowOverdraft || toCents(balance) >= 0;
}

function totalsFor(transactions, openingBalance = 0) {
  const totals = { income: 0, expense: 0, withdrawal: 0 };
  for (const transaction of transactions) {
    if (transaction.status !== "posted" || !ALLOWED_KINDS.has(transaction.kind)) continue;
    totals[transaction.kind] += toCents(transaction.amount);
  }
  const opening = toCents(openingBalance);
  const current = opening + totals.income - totals.expense - totals.withdrawal;
  return {
    opening: fromCents(opening),
    income: fromCents(totals.income),
    expense: fromCents(totals.expense),
    withdrawal: fromCents(totals.withdrawal),
    current: fromCents(current),
  };
}

function dateWindow(from, to) {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T23:59:59.999Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    throw new Error("A valid date range is required");
  }
  return { gte: start, lte: end };
}

function publicRecord(transaction, fields) {
  const record = {};
  for (const field of fields) {
    if (ALLOWED_FIELDS.has(field)) {
      const value = field === "date" ? transaction.happenedAt : transaction[field];
      record[field] = value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "");
    }
  }
  return record;
}

module.exports = { ALLOWED_FIELDS, ALLOWED_SUMMARY_FIELDS, toCents, fromCents, isBalanceAllowed, totalsFor, dateWindow, publicRecord };
