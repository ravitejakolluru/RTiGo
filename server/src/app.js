const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const path = require("node:path");
const nodemailer = require("nodemailer");
const { Prisma } = require("@prisma/client");
const { ALLOWED_FIELDS, ALLOWED_SUMMARY_FIELDS, toCents, fromCents, isBalanceAllowed, totalsFor, dateWindow, publicRecord } = require("./domain");
const { createFinancialPdf } = require("./pdf-layout");

const COOKIE = "fund_session";
const DAY_MS = 24 * 60 * 60 * 1000;
const SUPPORTED_LANGUAGES = new Set(["en", "hi", "te", "kn", "ta"]);
const DATABASE_UNAVAILABLE_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);

function createApp(prisma, config = process.env, dependencies = {}) {
  const app = express();
  const origin = config.APP_ORIGIN || "http://localhost:5173";
  // Render places one trusted edge proxy in front of the app; never trust the full forwarded chain.
  app.set("trust proxy", config.NODE_ENV === "production" || config.TRUST_PROXY === "true" ? 1 : false);
  app.use(helmet());
  app.use(cors({ origin, credentials: true }));
  app.use(express.json({ limit: "32kb" }));
  app.use(cookieParser());

  const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false });
  const requireAuth = asyncRoute(async (req, res, next) => {
    const token = req.cookies[COOKIE];
    if (!token) return res.status(401).json({ error: "Authentication required" });
    try {
      const payload = jwt.verify(token, config.JWT_SECRET);
      const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, name: true, email: true, verifiedAt: true } });
      if (!user || !user.verifiedAt) return res.status(401).json({ error: "Authentication required" });
      req.user = user;
      return next();
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
        return res.status(401).json({ error: "Session expired; please sign in again" });
      }
      return next(error);
    }
  });

  function issueSession(res, user) {
    const token = jwt.sign({ sub: user.id }, config.JWT_SECRET, { expiresIn: "7d", issuer: "fund-manager" });
    res.cookie(COOKIE, token, {
      httpOnly: true,
      secure: config.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * DAY_MS,
      path: "/",
    });
  }

  function validDate(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
      && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
  }

  function money(value) {
    const cents = toCents(value);
    if (cents <= 0 || cents > 99999999999999) throw Object.assign(new Error("Amount must be greater than zero and within the supported limit"), { status: 400 });
    return fromCents(cents);
  }

  function cleanText(value, max, required = false) {
    if (typeof value !== "string") {
      if (required) throw Object.assign(new Error("A required text field is missing"), { status: 400 });
      return null;
    }
    const result = value.trim();
    if ((required && !result) || result.length > max) {
      throw Object.assign(new Error(`Text must be ${required ? "non-empty and " : ""}at most ${max} characters`), { status: 400 });
    }
    return result || null;
  }

  function parseDate(value) {
    if (!validDate(value)) throw Object.assign(new Error("Date must use YYYY-MM-DD format"), { status: 400 });
    return new Date(`${value}T00:00:00.000Z`);
  }

  function transactionInput(body, partial = false) {
    const data = {};
    if (!partial || body.kind !== undefined) {
      if (!["income", "expense", "withdrawal"].includes(body.kind)) throw Object.assign(new Error("Invalid transaction type"), { status: 400 });
      data.kind = body.kind;
    }
    if (!partial || body.amount !== undefined) data.amount = money(body.amount);
    if (!partial || body.title !== undefined) data.title = cleanText(body.title, 120, true);
    for (const field of ["counterparty", "category", "method", "notes"]) {
      if (!partial || body[field] !== undefined) data[field] = cleanText(body[field], field === "notes" ? 2000 : 120);
    }
    if (!partial || body.happenedAt !== undefined) data.happenedAt = parseDate(body.happenedAt);
    if (body.status !== undefined || !partial) {
      const status = body.status || "posted";
      if (!["posted", "scheduled"].includes(status)) throw Object.assign(new Error("Invalid payment status"), { status: 400 });
      data.status = status;
    }
    if (data.kind === "income" && data.status === "scheduled") {
      throw Object.assign(new Error("Income must be recorded as posted"), { status: 400 });
    }
    return data;
  }

  async function currentBalance(tx, userId, excludeId) {
    const [account, transactions] = await Promise.all([
      tx.account.findUniqueOrThrow({ where: { userId } }),
      tx.transaction.findMany({
        where: { userId, deletedAt: null, status: "posted", ...(excludeId ? { id: { not: excludeId } } : {}) },
        select: { kind: true, amount: true, status: true },
      }),
    ]);
    return { account, ...totalsFor(transactions, account.openingBalance) };
  }

  async function enforceBalance(tx, userId, excludeId) {
    const balance = await currentBalance(tx, userId, excludeId);
    if (!isBalanceAllowed(balance.current, balance.account.allowOverdraft)) {
      throw Object.assign(new Error("This transaction would create a negative balance"), { status: 409 });
    }
  }

  async function audit(tx, userId, entityType, entityId, action, beforeData, afterData) {
    const toJson = (value) => value == null ? Prisma.JsonNull : JSON.parse(JSON.stringify(value));
    await tx.auditLog.create({
      data: { userId, entityType, entityId, action, beforeData: toJson(beforeData), afterData: toJson(afterData) },
    });
  }

  async function sendCode(email, subject, code) {
    if (dependencies.sendEmail) return dependencies.sendEmail({ email, subject, code });
    if (!config.SMTP_HOST) throw new Error("SMTP_HOST is not configured");
    const transport = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: Number(config.SMTP_PORT || 587),
      secure: String(config.SMTP_SECURE) === "true",
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      ...(config.SMTP_USER ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } } : {}),
    });
    await transport.sendMail({ from: config.EMAIL_FROM, to: email, subject, text: `Your verification code is ${code}. It expires in 15 minutes.` });
  }

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

  app.post("/api/auth/register", authLimiter, asyncRoute(async (req, res) => {
    const name = cleanText(req.body.name, 100, true);
    const email = cleanText(req.body.email, 254, true).toLowerCase();
    const password = req.body.password;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address" });
    if (typeof password !== "string" || password.length < 10 || password.length > 128) {
      return res.status(400).json({ error: "Password must be 10–128 characters" });
    }
    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }
    const code = String(crypto.randomInt(100000, 1000000));
    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash: await bcrypt.hash(password, 12),
        verifyHash: crypto.createHash("sha256").update(code).digest("hex"),
        verifyExpires: new Date(Date.now() + 15 * 60 * 1000),
        account: { create: {} },
      },
      select: { id: true },
    });
    try {
      await sendCode(email, "Verify your Fund Manager account", code);
    } catch (error) {
      if (config.NODE_ENV === "production") {
        await prisma.user.delete({ where: { id: user.id } });
        console.error("Registration verification email delivery failed:", error.code || error.name);
        throw Object.assign(new Error("Email delivery is temporarily unavailable. Please try again later."), { status: 503 });
      }
      console.error("Verification email could not be delivered; configure SMTP:", error.message);
      console.info(`Development verification code for ${email}: ${code}`);
    }
    return res.status(201).json({ message: "Verification code sent. Check your email to activate your account." });
  }));

  app.post("/api/auth/verify-email", authLimiter, asyncRoute(async (req, res) => {
    const email = cleanText(req.body.email, 254, true).toLowerCase();
    const code = String(req.body.code || "");
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.verifiedAt || !user.verifyExpires || user.verifyExpires < new Date()
      || user.verifyAttempts >= 5 || !user.verifyHash
      || !crypto.timingSafeEqual(Buffer.from(user.verifyHash), Buffer.from(crypto.createHash("sha256").update(code).digest("hex")))) {
      if (user && !user.verifiedAt && user.verifyAttempts < 5) {
        await prisma.user.updateMany({ where: { id: user.id, verifyAttempts: { lt: 5 } }, data: { verifyAttempts: { increment: 1 } } });
      }
      return res.status(400).json({ error: "Invalid or expired verification code" });
    }
    const activated = await prisma.user.update({
      where: { id: user.id },
      data: { verifiedAt: new Date(), verifyHash: null, verifyExpires: null },
      select: { id: true, name: true, email: true },
    });
    issueSession(res, activated);
    return res.json({ user: activated });
  }));

  app.post("/api/auth/resend-verification", authLimiter, asyncRoute(async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, verifiedAt: true } });
    if (user && !user.verifiedAt) {
      const code = String(crypto.randomInt(100000, 1000000));
      await prisma.user.update({
        where: { id: user.id },
        data: {
          verifyHash: crypto.createHash("sha256").update(code).digest("hex"),
          verifyExpires: new Date(Date.now() + 15 * 60 * 1000),
          verifyAttempts: 0,
        },
      });
      try {
        await sendCode(user.email, "Verify your Fund Manager account", code);
      } catch (error) {
        if (config.NODE_ENV === "production") throw error;
        console.error("Verification email could not be delivered; configure SMTP:", error.message);
        console.info(`Development verification code for ${email}: ${code}`);
      }
    }
    return res.json({ message: "If that account needs verification, a new code has been sent." });
  }));

  app.post("/api/auth/login", authLimiter, asyncRoute(async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = req.body.password;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !await bcrypt.compare(String(password || ""), user.passwordHash)) return res.status(401).json({ error: "Email or password is incorrect" });
    if (!user.verifiedAt) return res.status(403).json({ error: "Verify your email before signing in" });
    issueSession(res, user);
    return res.json({ user: { id: user.id, name: user.name, email: user.email } });
  }));

  app.post("/api/auth/logout", (_req, res) => {
    res.clearCookie(COOKIE, { httpOnly: true, secure: config.NODE_ENV === "production", sameSite: "lax", path: "/" });
    return res.json({ message: "Signed out" });
  });

  app.get("/api/auth/me", requireAuth, (req, res) => res.json({ user: req.user }));

  app.post("/api/auth/forgot-password", authLimiter, asyncRoute(async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
    if (user) {
      const code = String(crypto.randomInt(100000, 1000000));
      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetHash: crypto.createHash("sha256").update(code).digest("hex"),
          resetExpires: new Date(Date.now() + 15 * 60 * 1000),
          resetAttempts: 0,
        },
      });
      try {
        await sendCode(user.email, "Reset your Fund Manager password", code);
      } catch (error) {
        console.error("Password reset email delivery failed:", error.code || error.name);
        throw Object.assign(new Error("If this account exists, its reset email could not be delivered right now. Please try again later."), { status: 503 });
      }
    }
    return res.json({ message: "If that email is registered, a password reset code has been sent." });
  }));

  app.post("/api/auth/reset-password", authLimiter, asyncRoute(async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const code = String(req.body.code || "");
    const password = req.body.password;
    if (typeof password !== "string" || password.length < 10 || password.length > 128) {
      return res.status(400).json({ error: "Password must be 10–128 characters" });
    }
    const user = await prisma.user.findUnique({ where: { email } });
    const hash = crypto.createHash("sha256").update(code).digest("hex");
    if (!user || !user.resetExpires || user.resetExpires < new Date() || !user.resetHash || user.resetAttempts >= 5
      || !crypto.timingSafeEqual(Buffer.from(user.resetHash), Buffer.from(hash))) {
      if (user?.resetHash && user.resetExpires && user.resetExpires >= new Date() && user.resetAttempts < 5) {
        const attempt = await prisma.user.updateMany({
          where: { id: user.id, resetHash: user.resetHash, resetAttempts: { lt: 5 } },
          data: { resetAttempts: { increment: 1 } },
        });
        if (attempt.count) {
          await prisma.user.updateMany({
            where: { id: user.id, resetAttempts: { gte: 5 } },
            data: { resetHash: null, resetExpires: null },
          });
        }
      }
      return res.status(400).json({ error: "Invalid or expired reset code" });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(password, 12), resetHash: null, resetExpires: null, resetAttempts: 0 },
    });
    return res.json({ message: "Password updated. You can now sign in." });
  }));

  app.get("/api/account", requireAuth, asyncRoute(async (req, res) => {
    const account = await prisma.account.findUniqueOrThrow({ where: { userId: req.user.id } });
    return res.json({ account });
  }));

  app.patch("/api/account", requireAuth, asyncRoute(async (req, res) => {
    const data = {};
    if (req.body.name !== undefined) data.name = cleanText(req.body.name, 100, true);
    if (req.body.language !== undefined) {
      if (!SUPPORTED_LANGUAGES.has(req.body.language)) {
        return res.status(400).json({ error: "Unsupported language" });
      }
      data.language = req.body.language;
    }
    if (req.body.openingBalance !== undefined) {
      const cents = toCents(req.body.openingBalance);
      if (cents < 0) return res.status(400).json({ error: "Opening balance cannot be negative" });
      data.openingBalance = fromCents(cents);
    }
    if (req.body.allowOverdraft !== undefined) {
      if (typeof req.body.allowOverdraft !== "boolean") return res.status(400).json({ error: "Invalid overdraft setting" });
      data.allowOverdraft = req.body.allowOverdraft;
    }
    const updated = await prisma.$transaction(async (tx) => {
      const before = await tx.account.findUniqueOrThrow({ where: { userId: req.user.id } });
      const account = await tx.account.update({ where: { userId: req.user.id }, data });
      const balance = await currentBalance(tx, req.user.id);
      if (!isBalanceAllowed(balance.current, account.allowOverdraft)) {
        throw Object.assign(new Error("Account settings cannot create a negative balance"), { status: 409 });
      }
      await audit(tx, req.user.id, "account", account.id, "update", before, account);
      return account;
    });
    return res.json({ account: updated });
  }));

  app.get("/api/dashboard", requireAuth, asyncRoute(async (req, res) => {
    const from = req.query.from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    const to = req.query.to || new Date().toISOString().slice(0, 10);
    const range = dateWindow(from, to);
    const [account, all, filtered, schedules] = await Promise.all([
      prisma.account.findUniqueOrThrow({ where: { userId: req.user.id } }),
      prisma.transaction.findMany({ where: { userId: req.user.id, deletedAt: null, status: "posted" }, select: { kind: true, amount: true, status: true } }),
      prisma.transaction.findMany({ where: { userId: req.user.id, deletedAt: null, happenedAt: range }, orderBy: [{ happenedAt: "desc" }, { createdAt: "desc" }], take: 100 }),
      prisma.paymentSchedule.findMany({ where: { userId: req.user.id, status: "scheduled" } }),
    ]);
    const overall = totalsFor(all, account.openingBalance);
    const period = totalsFor(filtered.filter((item) => item.status === "posted"), 0);
    const pendingTotal = schedules.reduce((sum, item) => sum + toCents(item.amount), 0);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const upcoming = schedules
      .filter((item) => item.dueDate >= today)
      .reduce((sum, item) => sum + toCents(item.amount), 0);
    const byDay = new Map();
    for (const item of filtered) {
      const day = item.happenedAt.toISOString().slice(0, 10);
      const current = byDay.get(day) || { date: day, income: 0, expense: 0 };
      if (item.status === "posted" && item.kind === "income") current.income += toCents(item.amount);
      if (item.status === "posted" && item.kind !== "income") current.expense += toCents(item.amount);
      byDay.set(day, current);
    }
    return res.json({
      summary: {
        ...overall,
        available: overall.current,
        upcoming: fromCents(upcoming),
        projected: fromCents(toCents(overall.current) - pendingTotal),
        periodIncome: period.income,
        periodExpense: period.expense,
      },
      chart: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)).map((row) => ({ ...row, income: fromCents(row.income), expense: fromCents(row.expense) })),
      transactions: filtered.slice(0, 10),
      schedules: schedules.sort((a, b) => a.dueDate - b.dueDate).slice(0, 5),
    });
  }));

  app.get("/api/transactions", requireAuth, asyncRoute(async (req, res) => {
    const where = { userId: req.user.id, deletedAt: null };
    if (req.query.kind && ["income", "expense", "withdrawal"].includes(req.query.kind)) where.kind = req.query.kind;
    if (req.query.from || req.query.to) where.happenedAt = dateWindow(req.query.from || "1900-01-01", req.query.to || "9999-12-31");
    const transactions = await prisma.transaction.findMany({ where, orderBy: [{ happenedAt: "desc" }, { createdAt: "desc" }], take: 500 });
    return res.json({ transactions });
  }));

  app.post("/api/transactions", requireAuth, asyncRoute(async (req, res) => {
    const data = transactionInput(req.body);
    const result = await prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({ data: { ...data, userId: req.user.id } });
      if (transaction.status === "posted") await enforceBalance(tx, req.user.id);
      await audit(tx, req.user.id, "transaction", transaction.id, "create", null, transaction);
      return transaction;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return res.status(201).json({ transaction: result });
  }));

  app.patch("/api/transactions/:id", requireAuth, asyncRoute(async (req, res) => {
    const data = transactionInput(req.body, true);
    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.transaction.findFirst({ where: { id: req.params.id, userId: req.user.id, deletedAt: null } });
      if (!before) return null;
      const effectiveKind = data.kind || before.kind;
      const effectiveStatus = data.status || before.status;
      if (effectiveKind === "income" && effectiveStatus === "scheduled") {
        throw Object.assign(new Error("Income must be recorded as posted"), { status: 400 });
      }
      const transaction = await tx.transaction.update({ where: { id: before.id }, data });
      if (transaction.status === "posted") await enforceBalance(tx, req.user.id, transaction.id);
      await audit(tx, req.user.id, "transaction", transaction.id, "update", before, transaction);
      return transaction;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!result) return res.status(404).json({ error: "Transaction not found" });
    return res.json({ transaction: result });
  }));

  async function removeTransaction(req, res, action) {
    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.transaction.findFirst({ where: { id: req.params.id, userId: req.user.id, deletedAt: null } });
      if (!before) return false;
      const transaction = await tx.transaction.update({ where: { id: before.id }, data: { deletedAt: new Date() } });
      if (transaction.status === "posted") await enforceBalance(tx, req.user.id);
      await audit(tx, req.user.id, "transaction", transaction.id, action, before, transaction);
      if (before.scheduleId) {
        const schedule = await tx.paymentSchedule.update({ where: { id: before.scheduleId }, data: { status: "scheduled" } });
        await tx.transaction.update({ where: { id: before.id }, data: { scheduleId: null } });
        await audit(tx, req.user.id, "schedule", schedule.id, "payment-reversed", before, schedule);
      }
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!result) return res.status(404).json({ error: "Transaction not found" });
    return res.json({ message: action === "reverse" ? "Transaction reversed; audit history retained" : "Transaction removed from balances; audit history retained" });
  }

  app.delete("/api/transactions/:id", requireAuth, asyncRoute((req, res) => removeTransaction(req, res, "delete")));
  app.post("/api/transactions/:id/reverse", requireAuth, asyncRoute((req, res) => removeTransaction(req, res, "reverse")));

  app.get("/api/schedules", requireAuth, asyncRoute(async (req, res) => {
    const schedules = await prisma.paymentSchedule.findMany({ where: { userId: req.user.id }, orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }] });
    return res.json({ schedules });
  }));

  app.post("/api/schedules", requireAuth, asyncRoute(async (req, res) => {
    const schedule = await prisma.paymentSchedule.create({
      data: {
        userId: req.user.id,
        name: cleanText(req.body.name, 120, true),
        amount: money(req.body.amount),
        recipient: cleanText(req.body.recipient, 120),
        dueDate: parseDate(req.body.dueDate),
        category: cleanText(req.body.category, 120),
        notes: cleanText(req.body.notes, 2000),
      },
    });
    return res.status(201).json({ schedule });
  }));

  app.patch("/api/schedules/:id", requireAuth, asyncRoute(async (req, res) => {
    const schedule = await prisma.$transaction(async (tx) => {
      const before = await tx.paymentSchedule.findFirst({ where: { id: req.params.id, userId: req.user.id } });
      if (!before) return null;
      if (before.status === "paid") throw Object.assign(new Error("A paid schedule cannot be changed"), { status: 409 });
      if (req.body.status === "paid") {
        const updated = await tx.paymentSchedule.update({ where: { id: before.id }, data: { status: "paid" } });
        const transaction = await tx.transaction.create({
          data: {
            userId: req.user.id,
            scheduleId: before.id,
            kind: "expense",
            amount: before.amount,
            title: before.name,
            counterparty: before.recipient,
            category: before.category,
            happenedAt: req.body.happenedAt ? parseDate(req.body.happenedAt) : new Date(new Date().toISOString().slice(0, 10)),
            status: "posted",
            notes: before.notes,
          },
        });
        await enforceBalance(tx, req.user.id);
        await audit(tx, req.user.id, "schedule", before.id, "mark-paid", before, updated);
        await audit(tx, req.user.id, "transaction", transaction.id, "create-from-schedule", null, transaction);
        return updated;
      }
      const data = {};
      if (req.body.name !== undefined) data.name = cleanText(req.body.name, 120, true);
      if (req.body.amount !== undefined) data.amount = money(req.body.amount);
      if (req.body.recipient !== undefined) data.recipient = cleanText(req.body.recipient, 120);
      if (req.body.dueDate !== undefined) data.dueDate = parseDate(req.body.dueDate);
      if (req.body.category !== undefined) data.category = cleanText(req.body.category, 120);
      if (req.body.notes !== undefined) data.notes = cleanText(req.body.notes, 2000);
      const updated = await tx.paymentSchedule.update({ where: { id: before.id }, data });
      await audit(tx, req.user.id, "schedule", before.id, "update", before, updated);
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!schedule) return res.status(404).json({ error: "Schedule not found" });
    return res.json({ schedule });
  }));

  app.delete("/api/schedules/:id", requireAuth, asyncRoute(async (req, res) => {
    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.paymentSchedule.findFirst({ where: { id: req.params.id, userId: req.user.id, status: "scheduled" } });
      if (!before) return false;
      await audit(tx, req.user.id, "schedule", before.id, "delete", before, null);
      await tx.paymentSchedule.delete({ where: { id: before.id } });
      return true;
    });
    if (!result) return res.status(404).json({ error: "Scheduled payment not found" });
    return res.json({ message: "Scheduled payment deleted" });
  }));

  app.get("/api/statements.pdf", requireAuth, asyncRoute(async (req, res) => {
    const { from, to } = req.query;
    const dates = dateWindow(from, to);
    const type = req.query.type || "all";
    if (!["all", "income", "expense", "withdrawal"].includes(type)) return res.status(400).json({ error: "Invalid statement type" });
    const [account, user, transactions, before] = await Promise.all([
      prisma.account.findUniqueOrThrow({ where: { userId: req.user.id } }),
      prisma.user.findUniqueOrThrow({ where: { id: req.user.id }, select: { name: true, email: true } }),
      prisma.transaction.findMany({ where: { userId: req.user.id, deletedAt: null, status: "posted", happenedAt: dates }, orderBy: [{ happenedAt: "asc" }, { createdAt: "asc" }] }),
      prisma.transaction.findMany({ where: { userId: req.user.id, deletedAt: null, status: "posted", happenedAt: { lt: dates.gte } }, select: { kind: true, amount: true, status: true } }),
    ]);
    let runningCents = toCents(totalsFor(before, account.openingBalance).current);
    const allTotals = totalsFor(transactions, 0);
    const transactionBalances = new Map();
    for (const row of transactions) {
      const amountCents = toCents(row.amount);
      runningCents += row.kind === "income" ? amountCents : -amountCents;
      transactionBalances.set(row.id, fromCents(runningCents));
    }
    const visible = transactions
      .filter((row) => type === "all" || row.kind === type)
      .map((row) => ({ ...row, balance: transactionBalances.get(row.id) }));
    const statementRef = `RTIGO-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const closing = totalsFor([...before, ...transactions], account.openingBalance).current;
    const totalDebited = fromCents(toCents(allTotals.expense) + toCents(allTotals.withdrawal));
    const pdf = await createFinancialPdf({
      documentLabel: "Account statement",
      title: "Account Statement",
      accountName: account.name,
      ownerName: user.name,
      ownerEmail: user.email,
      from,
      to,
      generatedAt: new Date(),
      reference: statementRef,
      openingBalance: totalsFor(before, account.openingBalance).current,
      summary: [
        { label: "Opening balance", value: totalsFor(before, account.openingBalance).current, accent: "#a99cff" },
        { label: "Amount received", value: allTotals.income, accent: "#14804a", valueColor: "#14804a" },
        { label: "Amount spent", value: allTotals.expense, accent: "#b42332", valueColor: "#b42332" },
        { label: "Withdrawals", value: allTotals.withdrawal, accent: "#9a5d00", valueColor: "#9a5d00" },
        { label: "Total debited", value: totalDebited, accent: "#b42332", valueColor: "#b42332" },
        { label: "Closing balance", value: closing, accent: "#28234a" },
      ],
      transactions: visible,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="statement-${from}-${to}.pdf"`);
    return res.end(pdf);
  }));

  app.get("/api/shares", requireAuth, asyncRoute(async (req, res) => {
    const shares = await prisma.shareLink.findMany({
      where: { userId: req.user.id }, orderBy: { createdAt: "desc" },
      select: { id: true, fromDate: true, toDate: true, fields: true, expiresAt: true, revokedAt: true, createdAt: true },
    });
    return res.json({ shares });
  }));

  app.post("/api/shares", requireAuth, asyncRoute(async (req, res) => {
    const { from, to } = req.body;
    const dates = dateWindow(from, to);
    const fields = req.body.fields;
    const allowedShareFields = new Set([...ALLOWED_FIELDS, ...ALLOWED_SUMMARY_FIELDS]);
    if (!Array.isArray(fields) || !fields.length || fields.length > allowedShareFields.size || fields.some((field) => !allowedShareFields.has(field))) {
      return res.status(400).json({ error: "Select one or more permitted report fields" });
    }
    let expiresAt = null;
    if (req.body.expiresAt) {
      const expiry = new Date(req.body.expiresAt);
      if (Number.isNaN(expiry.getTime()) || expiry <= new Date()) return res.status(400).json({ error: "Expiration must be a future date" });
      expiresAt = expiry;
    }
    const token = crypto.randomBytes(32).toString("base64url");
    const share = await prisma.shareLink.create({
      data: {
        userId: req.user.id,
        tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
        fromDate: dates.gte,
        toDate: dates.lte,
        fields: [...new Set(fields)],
        expiresAt,
      },
      select: { id: true, fromDate: true, toDate: true, fields: true, expiresAt: true, createdAt: true },
    });
    return res.status(201).json({ share, url: `${origin}/share/${token}` });
  }));

  app.delete("/api/shares/:id", requireAuth, asyncRoute(async (req, res) => {
    const share = await prisma.shareLink.updateMany({
      where: { id: req.params.id, userId: req.user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!share.count) return res.status(404).json({ error: "Active share link not found" });
    return res.json({ message: "Share link revoked" });
  }));

  app.get("/api/public/:token", asyncRoute(async (req, res) => {
    const tokenHash = crypto.createHash("sha256").update(req.params.token).digest("hex");
    const share = await prisma.shareLink.findUnique({ where: { tokenHash } });
    if (!share || share.revokedAt || (share.expiresAt && share.expiresAt <= new Date())) {
      return res.status(404).json({ error: "This report is unavailable" });
    }
    const dates = { gte: share.fromDate, lte: share.toDate };
    const fields = share.fields.filter((field) => ALLOWED_FIELDS.has(field));
    const summaryFields = share.fields.filter((field) => ALLOWED_SUMMARY_FIELDS.has(field));
    const needsPeriodTotals = summaryFields.includes("incomeTotal") || summaryFields.includes("expenseTotal");
    const needsBalance = summaryFields.includes("availableBalance");
    const [transactions, periodTransactions, account, allTransactions] = await Promise.all([
      fields.length ? prisma.transaction.findMany({
      where: { userId: share.userId, deletedAt: null, status: "posted", happenedAt: dates },
      orderBy: [{ happenedAt: "asc" }, { createdAt: "asc" }],
      select: { happenedAt: true, kind: true, title: true, amount: true, counterparty: true, category: true },
      }) : [],
      needsPeriodTotals ? prisma.transaction.findMany({
      where: { userId: share.userId, deletedAt: null, status: "posted", happenedAt: dates },
        select: { kind: true, amount: true, status: true },
      }) : [],
      needsBalance ? prisma.account.findUniqueOrThrow({ where: { userId: share.userId } }) : null,
      needsBalance ? prisma.transaction.findMany({
      where: { userId: share.userId, deletedAt: null, status: "posted" },
      select: { kind: true, amount: true, status: true },
      }) : null,
    ]);
    const periodTotals = totalsFor(periodTransactions);
    const summary = {};
    if (summaryFields.includes("incomeTotal")) summary.incomeTotal = periodTotals.income;
    if (summaryFields.includes("expenseTotal")) summary.expenseTotal = periodTotals.expense;
    if (needsBalance) summary.availableBalance = totalsFor(allTransactions, account.openingBalance).current;
    return res.json({
      from: share.fromDate.toISOString().slice(0, 10),
      to: share.toDate.toISOString().slice(0, 10),
      fields,
      summary,
      records: transactions.map((row) => publicRecord(row, fields)),
    });
  }));

  if (config.NODE_ENV === "production") {
    const clientDist = path.resolve(__dirname, "..", "..", "client", "dist");
    app.use(express.static(clientDist, {
      index: false,
      maxAge: "1y",
      immutable: true,
      setHeaders(res, filePath) {
        if (path.basename(filePath) === "index.html") {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      return res.sendFile(path.join(clientDist, "index.html"));
    });
  }

  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    if (DATABASE_UNAVAILABLE_CODES.has(error.code)) {
      console.error("Database temporarily unavailable:", error.code);
      return res.status(503).json({ error: "The database is temporarily unavailable. Please try again shortly." });
    }
    console.error(error);
    if (error.code === "P2002") return res.status(409).json({ error: "A record with that value already exists" });
    if (error.code === "P2025") return res.status(404).json({ error: "Record not found" });
    const status = error.status || (error.message?.includes("date range") ? 400 : 500);
    return res.status(status).json({ error: status === 500 ? "An unexpected server error occurred" : error.message });
  });

  return app;
}

module.exports = { createApp };
