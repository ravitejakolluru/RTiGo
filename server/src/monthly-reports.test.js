const test = require("node:test");
const assert = require("node:assert/strict");
const { deliverMonthlyReports, getPreviousMonthPeriod } = require("./monthly-reports");

test("monthly report windows cover the previous full month and next month bills", () => {
  const period = getPreviousMonthPeriod(new Date("2026-11-01T02:30:00.000Z"), "Asia/Kolkata");
  assert.equal(period.monthKey, "2026-10");
  assert.equal(period.fromText, "2026-10-01");
  assert.equal(period.toText, "2026-10-31");
  assert.equal(period.monthLabel, "October 2026");
  assert.equal(period.from.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(period.nextMonthFrom.toISOString(), "2026-11-01T00:00:00.000Z");
});

test("a late startup does not create a new report delivery mid-month", async () => {
  let userLookup = false;
  const prisma = {
    user: { findMany: async () => { userLookup = true; return []; } },
    monthlyReportDelivery: { findMany: async () => [] },
  };
  const result = await deliverMonthlyReports(prisma, { MONTHLY_REPORT_TIMEZONE: "Asia/Kolkata" }, {
    now: new Date("2026-11-02T02:30:00.000Z"),
    sendMail: async () => assert.fail("No new report should be sent after the first day"),
  });
  assert.equal(result.eligible, 0);
  assert.equal(userLookup, false);
});

test("monthly report email contains reconciled totals and an encrypted PDF", async () => {
  const user = {
    id: "user-1",
    name: "Raviteja Kolluru",
    email: "raviteja@example.test",
    account: { name: "Personal funds", openingBalance: "100.00" },
  };
  const before = [{ kind: "income", amount: "500.00", status: "posted" }];
  const transactions = [
    { kind: "income", status: "posted", amount: "100.00", title: "Salary", happenedAt: new Date("2026-10-02T00:00:00.000Z"), counterparty: "Employer", category: "Bank", method: "Transfer" },
    { kind: "expense", status: "posted", amount: "25.00", title: "Groceries", happenedAt: new Date("2026-10-03T00:00:00.000Z"), counterparty: null, category: "Store", method: null },
    { kind: "withdrawal", status: "posted", amount: "5.00", title: "Cash", happenedAt: new Date("2026-10-04T00:00:00.000Z"), counterparty: null, category: null, method: null },
  ];
  const schedules = [{
    name: "Electricity bill",
    amount: "50.00",
    dueDate: new Date("2026-11-12T00:00:00.000Z"),
    recipient: "Power company",
  }];
  let deliveryStatus = "pending";
  let sentMessage;
  const prisma = {
    user: { findMany: async () => [user] },
    transaction: {
      findMany: async ({ where }) => where.happenedAt.gte ? transactions : before,
    },
    paymentSchedule: { findMany: async () => schedules },
    monthlyReportDelivery: {
      upsert: async () => ({ id: "delivery-1", status: deliveryStatus, attemptedAt: null }),
      updateMany: async ({ where, data }) => {
        assert.equal(where.id, "delivery-1");
        assert.equal(data.status, "sending");
        deliveryStatus = "sending";
        return { count: 1 };
      },
      update: async ({ data }) => { deliveryStatus = data.status; },
    },
  };

  const result = await deliverMonthlyReports(prisma, { MONTHLY_REPORT_TIMEZONE: "Asia/Kolkata" }, {
    now: new Date("2026-11-01T02:30:00.000Z"),
    sendMail: async (message) => { sentMessage = message; },
  });
  assert.deepEqual(result, { period: "2026-10", eligible: 1, sent: 1 });
  assert.equal(deliveryStatus, "sent");
  assert.equal(sentMessage.to, user.email);
  assert.equal(sentMessage.subject, "Monthly Spend Report - October 2026");
  assert.match(sentMessage.text, /01\/10\/26 to 31\/10\/26/);
  assert.match(sentMessage.text, /Total credited: INR 100\.00/);
  assert.match(sentMessage.text, /Total debited: INR 30\.00/);
  assert.match(sentMessage.text, /Closing balance: INR 670\.00/);
  assert.match(sentMessage.text, /Upcoming bills in November 2026: INR 50\.00/);
  const password = sentMessage.text.match(/PDF password: ([a-f0-9]{32})/);
  assert.ok(password);
  assert.equal(sentMessage.attachments[0].filename, "monthly-spend-report-2026-10.pdf");
  assert.ok(sentMessage.attachments[0].content.subarray(0, 4).equals(Buffer.from("%PDF")));
  assert.match(sentMessage.attachments[0].content.toString("latin1"), /\/Encrypt/);

  deliveryStatus = "sent";
  const duplicateResult = await deliverMonthlyReports(prisma, { MONTHLY_REPORT_TIMEZONE: "Asia/Kolkata" }, {
    now: new Date("2026-11-01T03:00:00.000Z"),
    sendMail: async () => assert.fail("A sent report must not be emailed twice"),
  });
  assert.equal(duplicateResult.sent, 0);
});
