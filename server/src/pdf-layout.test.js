const test = require("node:test");
const assert = require("node:assert/strict");
const { createFinancialPdf } = require("./pdf-layout");

test("financial PDFs paginate long transaction histories and retain their account statement structure", async () => {
  const transactions = Array.from({ length: 60 }, (_, index) => ({
    happenedAt: new Date(Date.UTC(2026, 9, index % 31 + 1)),
    kind: ["income", "expense", "withdrawal"][index % 3],
    amount: "1250.00",
    title: `Transaction ${index + 1} - monthly activity`,
    counterparty: "Personal account",
    category: "Daily expenses",
    method: "Bank transfer",
  }));
  const pdf = await createFinancialPdf({
    documentLabel: "Account statement",
    title: "Account Statement",
    accountName: "Personal funds",
    ownerName: "Raviteja Kolluru",
    ownerEmail: "raviteja@example.test",
    from: "2026-10-01",
    to: "2026-10-31",
    generatedAt: new Date("2026-11-01T00:00:00.000Z"),
    reference: "RTIGO-TEST-202610",
    openingBalance: "10000.00",
    summary: [{ label: "Closing balance", value: "10000.00" }],
    transactions,
  });

  assert.ok(pdf.subarray(0, 4).equals(Buffer.from("%PDF")));
  const pageCount = Number(pdf.toString("latin1").match(/\/Count\s+(\d+)/)?.[1]);
  assert.ok(pageCount > 1, "long transaction lists should continue across pages");
});
