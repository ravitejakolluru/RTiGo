const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { once } = require("node:events");
const crypto = require("node:crypto");
const { createApp } = require("./app");

const SECRET = "test-secret-that-is-at-least-32-characters-long";
const testUser = { id: "owner-1", name: "Test User", email: "test@example.test", verifiedAt: new Date() };

async function withServer(app, callback) {
  const server = app.listen(0);
  await once(server, "listening");
  try {
    return await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function sessionCookie(userId = testUser.id) {
  return `fund_session=${jwt.sign({ sub: userId }, SECRET, { issuer: "fund-manager", expiresIn: "1h" })}`;
}

test("protected transactions require an authenticated session", async (t) => {
  const app = createApp({ user: { findUnique: async () => null } }, { JWT_SECRET: SECRET });
  const server = app.listen(0);
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/transactions`);
  assert.equal(response.status, 401);
});

test("production server serves the frontend and client-side report routes", async () => {
  const app = createApp({}, { NODE_ENV: "production", JWT_SECRET: SECRET, APP_ORIGIN: "https://rtigo.example.test" });
  await withServer(app, async (base) => {
    const health = await fetch(`${base}/api/health`);
    const report = await fetch(`${base}/share/example-token`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });
    assert.equal(report.status, 200);
    assert.match(report.headers.get("content-type"), /text\/html/);
    assert.match(await report.text(), /RTIGO/);
  });
});

test("transaction deletion is always scoped to the authenticated owner", async (t) => {
  let lookup;
  const user = testUser;
  const prisma = {
    user: { findUnique: async () => user },
    transaction: {
      findFirst: async ({ where }) => { lookup = where; return null; },
    },
    $transaction: async (callback) => callback({ transaction: prisma.transaction }),
  };
  const app = createApp(prisma, { JWT_SECRET: SECRET });
  const server = app.listen(0);
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/transactions/another-users-record`, {
    method: "DELETE",
    headers: { Cookie: sessionCookie() },
  });
  assert.equal(response.status, 404);
  assert.deepEqual(lookup, { id: "another-users-record", userId: "owner-1", deletedAt: null });
});

test("email verification activates only the account with a valid, unexpired code", async () => {
  const code = "531204";
  const user = {
    ...testUser,
    verifiedAt: null,
    verifyHash: crypto.createHash("sha256").update(code).digest("hex"),
    verifyExpires: new Date(Date.now() + 60_000),
    verifyAttempts: 0,
  };
  let update;
  const app = createApp({
    user: {
      findUnique: async () => user,
      update: async ({ data }) => { update = data; return { ...user, ...data }; },
    },
  }, { JWT_SECRET: SECRET });
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/auth/verify-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, code }),
    });
    assert.equal(response.status, 200);
    assert.ok(update.verifiedAt instanceof Date);
    assert.equal(update.verifyHash, null);
    assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  });
});

test("verification attempts are capped and incremented atomically", async () => {
  const user = {
    ...testUser,
    verifiedAt: null,
    verifyHash: crypto.createHash("sha256").update("111111").digest("hex"),
    verifyExpires: new Date(Date.now() + 60_000),
    verifyAttempts: 4,
  };
  let attemptUpdate;
  const app = createApp({
    user: {
      findUnique: async () => user,
      updateMany: async (args) => { attemptUpdate = args; return { count: 1 }; },
    },
  }, { JWT_SECRET: SECRET });
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/auth/verify-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, code: "222222" }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(attemptUpdate.where, { id: user.id, verifyAttempts: { lt: 5 } });
    assert.deepEqual(attemptUpdate.data, { verifyAttempts: { increment: 1 } });
  });
});

test("income, expense, and withdrawal API writes preserve owner scope and balance validation", async () => {
  const records = [];
  let nextId = 1;
  const tx = {
    account: { findUniqueOrThrow: async () => ({ openingBalance: "100.00", allowOverdraft: false }) },
    transaction: {
      create: async ({ data }) => {
        const row = { ...data, id: `transaction-${nextId++}`, createdAt: new Date() };
        records.push(row);
        return row;
      },
      findMany: async ({ where }) => records.filter((row) => row.userId === where.userId && !row.deletedAt && row.status === where.status),
    },
    auditLog: { create: async () => ({}) },
  };
  const app = createApp({
    user: { findUnique: async () => testUser },
    $transaction: async (callback) => {
      const previous = records.length;
      try { return await callback(tx); }
      catch (error) { records.splice(previous); throw error; }
    },
  }, { JWT_SECRET: SECRET });
  await withServer(app, async (base) => {
    const add = (entry) => fetch(`${base}/api/transactions`, {
      method: "POST",
      headers: { Cookie: sessionCookie(), "Content-Type": "application/json" },
      body: JSON.stringify({ title: entry.kind, amount: entry.amount, happenedAt: "2026-02-10", ...entry }),
    });
    for (const entry of [
      { kind: "income", amount: "25.00" },
      { kind: "expense", amount: "50.25" },
      { kind: "withdrawal", amount: "10.05" },
    ]) {
      const response = await add(entry);
      assert.equal(response.status, 201);
      const result = await response.json();
      assert.equal(result.transaction.userId, "owner-1");
    }
    assert.deepEqual(records.map((row) => row.kind), ["income", "expense", "withdrawal"]);
    assert.equal(records.every((row) => row.happenedAt.toISOString().slice(0, 10) === "2026-02-10"), true);
    assert.equal(records.length, 3);
  });
});

test("dashboard keeps scheduled payments out of current balance and reports projection separately", async () => {
  const dueDate = (days) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + days);
    date.setUTCHours(0, 0, 0, 0);
    return date;
  };
  const app = createApp({
    user: { findUnique: async () => testUser },
    account: { findUniqueOrThrow: async () => ({ openingBalance: "100.00" }) },
    transaction: {
      findMany: async ({ where }) => where.happenedAt
        ? []
        : [
          { kind: "income", amount: "100.00", status: "posted" },
          { kind: "expense", amount: "20.00", status: "posted" },
        ],
    },
    paymentSchedule: {
      findMany: async () => [
        { amount: "30.00", dueDate: dueDate(10) },
        { amount: "10.00", dueDate: dueDate(-10) },
      ],
    },
  }, { JWT_SECRET: SECRET });
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/dashboard?from=2026-01-01&to=2026-01-31`, {
      headers: { Cookie: sessionCookie() },
    });
    assert.equal(response.status, 200);
    const { summary } = await response.json();
    assert.equal(summary.current, "180.00");
    assert.equal(summary.available, "180.00");
    assert.equal(summary.upcoming, "30.00");
    assert.equal(summary.projected, "140.00");
  });
});

test("account language preferences accept supported languages and reject unknown languages", async () => {
  let updateArgs;
  const account = { id: "account-1", userId: testUser.id, language: "en", openingBalance: "0.00", allowOverdraft: false };
  const tx = {
    account: {
      findUniqueOrThrow: async () => account,
      update: async (args) => { updateArgs = args; return { ...account, ...args.data }; },
    },
    transaction: { findMany: async () => [] },
    auditLog: { create: async () => ({}) },
  };
  const app = createApp({
    user: { findUnique: async () => testUser },
    $transaction: async (callback) => callback(tx),
  }, { JWT_SECRET: SECRET });
  await withServer(app, async (base) => {
    const request = (language) => fetch(`${base}/api/account`, {
      method: "PATCH",
      headers: { Cookie: sessionCookie(), "Content-Type": "application/json" },
      body: JSON.stringify({ language }),
    });
    const supported = await request("te");
    assert.equal(supported.status, 200);
    assert.deepEqual(updateArgs.data, { language: "te" });
    const unsupported = await request("xx");
    assert.equal(unsupported.status, 400);
  });
});

test("public reports are read-only and query only the link owner's approved date range and fields", async () => {
  let query;
  const share = {
    userId: "owner-1",
    fromDate: new Date("2026-01-01T00:00:00.000Z"),
    toDate: new Date("2026-01-31T00:00:00.000Z"),
    fields: ["title", "amount"],
    expiresAt: null,
    revokedAt: null,
  };
  const app = createApp({
    shareLink: { findUnique: async () => share },
    transaction: {
      findMany: async (args) => {
        query = args;
        return [{
          happenedAt: new Date("2026-01-04T00:00:00.000Z"),
          kind: "expense",
          title: "Lunch",
          amount: "24.50",
          notes: "private detail",
        }];
      },
    },
  }, { JWT_SECRET: SECRET });
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/public/opaque-token`);
    assert.equal(response.status, 200);
    const report = await response.json();
    assert.deepEqual(report.records, [{ title: "Lunch", amount: "24.50" }]);
    assert.equal(query.where.userId, "owner-1");
    assert.equal(query.where.happenedAt.gte.toISOString(), share.fromDate.toISOString());
    assert.equal(query.where.happenedAt.lte.toISOString(), share.toDate.toISOString());
    assert.deepEqual(Object.keys(query.select), ["happenedAt", "kind", "title", "amount", "counterparty", "category"]);
  });
});

test("public report summaries include only selected figures and calculate the current balance", async () => {
  const share = {
    userId: "owner-1",
    fromDate: new Date("2026-01-01T00:00:00.000Z"),
    toDate: new Date("2026-01-31T23:59:59.999Z"),
    fields: ["incomeTotal", "expenseTotal", "availableBalance"],
    expiresAt: null,
    revokedAt: null,
  };
  const app = createApp({
    shareLink: { findUnique: async () => share },
    account: { findUniqueOrThrow: async ({ where }) => {
      assert.deepEqual(where, { userId: "owner-1" });
      return { openingBalance: "25.00" };
    } },
    transaction: {
      findMany: async ({ where, select }) => where.happenedAt && select.status
        ? [
          { kind: "income", amount: "75.00", status: "posted" },
          { kind: "expense", amount: "20.00", status: "posted" },
        ]
        : [
          { kind: "income", amount: "150.00", status: "posted" },
          { kind: "expense", amount: "50.00", status: "posted" },
          { kind: "withdrawal", amount: "10.00", status: "posted" },
        ],
    },
  }, { JWT_SECRET: SECRET });
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/public/opaque-token`);
    assert.equal(response.status, 200);
    const report = await response.json();
    assert.deepEqual(report.summary, {
      incomeTotal: "75.00",
      expenseTotal: "20.00",
      availableBalance: "115.00",
    });
    assert.deepEqual(report.fields, []);
    assert.deepEqual(report.records, []);
  });
});

test("share creation accepts summary fields and uses the configured public site origin", async () => {
  let created;
  const app = createApp({
    user: { findUnique: async () => testUser },
    shareLink: { create: async ({ data, select }) => {
      created = { data, select };
      return { id: "share-1", ...data, createdAt: new Date("2026-01-01T00:00:00.000Z") };
    } },
  }, { JWT_SECRET: SECRET, APP_ORIGIN: "https://fund.example" });
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/shares`, {
      method: "POST",
      headers: { Cookie: sessionCookie(), "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "2026-01-01",
        to: "2026-01-31",
        fields: ["incomeTotal", "expenseTotal", "availableBalance"],
      }),
    });
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.deepEqual(created.data.fields, ["incomeTotal", "expenseTotal", "availableBalance"]);
    assert.equal(result.url.startsWith("https://fund.example/share/"), true);
  });
});

test("revoked public reports cannot load transaction records", async () => {
  let transactionRead = false;
  const app = createApp({
    shareLink: { findUnique: async () => ({ revokedAt: new Date(), expiresAt: null }) },
    transaction: { findMany: async () => { transactionRead = true; return []; } },
  }, { JWT_SECRET: SECRET });
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/public/revoked-token`);
    assert.equal(response.status, 404);
    assert.equal(transactionRead, false);
  });
});

test("share revocation is scoped to the authenticated owner", async () => {
  let where;
  const app = createApp({
    user: { findUnique: async () => testUser },
    shareLink: { updateMany: async (args) => { where = args.where; return { count: 1 }; } },
  }, { JWT_SECRET: SECRET });
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/shares/share-1`, {
      method: "DELETE",
      headers: { Cookie: sessionCookie() },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(where, { id: "share-1", userId: "owner-1", revokedAt: null });
  });
});

test("statement endpoint generates a downloadable PDF", async () => {
  const app = createApp({
    account: { findUniqueOrThrow: async () => ({ name: "Test account", openingBalance: "100.00" }) },
    user: {
      findUnique: async () => testUser,
      findUniqueOrThrow: async () => ({ name: testUser.name, email: testUser.email }),
    },
    transaction: {
      findMany: async ({ where }) => where.happenedAt.lt
        ? [{ kind: "income", amount: "25.00", status: "posted" }]
        : [{ kind: "expense", amount: "5.00", title: "Coffee", happenedAt: new Date("2026-01-04T00:00:00.000Z") }],
    },
  }, { JWT_SECRET: SECRET });
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/statements.pdf?from=2026-01-01&to=2026-01-31`, {
      headers: { Cookie: sessionCookie() },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/pdf/);
    assert.equal((await response.arrayBuffer()).byteLength > 500, true);
  });
});
