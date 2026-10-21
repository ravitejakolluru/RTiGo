const test = require("node:test");
const assert = require("node:assert/strict");
const { toCents, isBalanceAllowed, totalsFor, dateWindow, publicRecord } = require("./domain");

test("balance arithmetic uses integer cents and excludes unpaid transactions", () => {
  const result = totalsFor([
    { kind: "income", amount: "1250.10", status: "posted" },
    { kind: "expense", amount: "50.25", status: "posted" },
    { kind: "withdrawal", amount: "10.05", status: "posted" },
    { kind: "expense", amount: "70.00", status: "scheduled" },
  ], "100.00");
  assert.deepEqual(result, {
    opening: "100.00", income: "1250.10", expense: "50.25", withdrawal: "10.05", current: "1289.80",
  });
});

test("amount conversion rejects non-finite values", () => {
  assert.equal(toCents("0.1"), 10);
  assert.throws(() => toCents("NaN"), /finite/);
});

test("overdrafts are rejected unless explicitly enabled", () => {
  assert.equal(isBalanceAllowed("0.00", false), true);
  assert.equal(isBalanceAllowed("-0.01", false), false);
  assert.equal(isBalanceAllowed("-10.00", true), true);
});

test("date windows reject reversed ranges", () => {
  assert.throws(() => dateWindow("2026-02-02", "2026-02-01"), /date range/);
});

test("public records include only explicitly permitted fields", () => {
  const output = publicRecord({
    happenedAt: new Date("2026-01-02T00:00:00Z"),
    kind: "income",
    title: "Salary",
    amount: "10.00",
    notes: "private",
    counterparty: "Employer",
  }, ["date", "amount", "notes", "counterparty"]);
  assert.deepEqual(output, { date: "2026-01-02", amount: "10.00", counterparty: "Employer" });
});
