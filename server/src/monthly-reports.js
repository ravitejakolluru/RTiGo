const crypto = require("node:crypto");
const nodemailer = require("nodemailer");
const { fromCents, toCents, totalsFor } = require("./domain");
const { createFinancialPdf, dateText, formatMoney } = require("./pdf-layout");

const DAY_MS = 24 * 60 * 60 * 1000;
const DELIVERY_POLL_MS = 15 * 60 * 1000;
const STALE_DELIVERY_MS = 15 * 60 * 1000;

function dateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map(({ type, value }) => [type, Number(value)]));
}

function zonedMidnight(year, month, timeZone) {
  const localAsUtc = Date.UTC(year, month - 1, 1);
  let instant = localAsUtc;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const fields = Object.fromEntries(formatter.formatToParts(new Date(instant))
      .filter((part) => part.type !== "literal")
      .map(({ type, value }) => [type, Number(value)]));
    const representedAsUtc = Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second);
    instant = localAsUtc - (representedAsUtc - instant);
  }
  return new Date(instant);
}

function monthStartDate(year, month) {
  return new Date(Date.UTC(year, month - 1, 1));
}

function getPreviousMonthPeriod(now = new Date(), timeZone = "Asia/Kolkata") {
  const current = dateParts(now, timeZone);
  const previousMonth = current.month === 1 ? 12 : current.month - 1;
  const previousYear = current.month === 1 ? current.year - 1 : current.year;
  const nextMonth = current.month === 12 ? 1 : current.month + 1;
  const nextYear = current.month === 12 ? current.year + 1 : current.year;
  const from = monthStartDate(previousYear, previousMonth);
  const to = new Date(Date.UTC(current.year, current.month - 1, 0));
  const nextMonthFrom = monthStartDate(current.year, current.month);
  const nextMonthToExclusive = monthStartDate(nextYear, nextMonth);
  const monthKey = `${previousYear}-${String(previousMonth).padStart(2, "0")}`;
  const monthLabel = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone })
    .format(new Date(Date.UTC(previousYear, previousMonth - 1, 15, 12)));
  return {
    from,
    to,
    nextMonthFrom,
    nextMonthToExclusive,
    currentMonthStart: zonedMidnight(current.year, current.month, timeZone),
    currentDay: current.day,
    monthKey,
    monthLabel,
    fromText: `${monthKey}-01`,
    toText: `${previousYear}-${String(previousMonth).padStart(2, "0")}-${String(to.getUTCDate()).padStart(2, "0")}`,
  };
}

function createMonthlyReportPdf(report, password) {
  return createFinancialPdf({
    documentLabel: "Monthly spend report",
    title: `Monthly Spend Report - ${report.period.monthLabel}`,
    accountName: report.account.name,
    ownerName: report.user.name,
    ownerEmail: report.user.email,
    from: report.period.from,
    to: report.period.to,
    generatedAt: report.generatedAt,
    reference: report.reference,
    openingBalance: report.openingBalance,
    summary: [
      { label: "Opening balance", value: report.openingBalance, accent: "#a99cff" },
      { label: "Amount received", value: report.totals.income, accent: "#14804a", valueColor: "#14804a" },
      { label: "Amount spent", value: report.totals.expense, accent: "#b42332", valueColor: "#b42332" },
      { label: "Withdrawals", value: report.totals.withdrawal, accent: "#9a5d00", valueColor: "#9a5d00" },
      { label: "Total debited", value: report.totalDebited, accent: "#b42332", valueColor: "#b42332" },
      { label: "Closing balance", value: report.closingBalance, accent: "#28234a" },
    ],
    bills: report.schedules,
    billsTotal: report.upcomingTotal,
    billsTitle: `UPCOMING BILLS  ·  ${report.nextMonthLabel.toUpperCase()}`,
    transactions: report.transactions,
  }, { password });
}

function inr(value) {
  return formatMoney(value);
}

function formatDate(value) {
  return dateText(value);
}

async function loadMonthlyReport(prisma, user, period, generatedAt) {
  if (!user.account) throw new Error("The account is missing");
  const [before, transactions, schedules] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId: user.id, deletedAt: null, status: "posted", happenedAt: { lt: period.from } },
      select: { kind: true, amount: true, status: true },
    }),
    prisma.transaction.findMany({
      where: {
        userId: user.id,
        deletedAt: null,
        status: "posted",
        happenedAt: { gte: period.from, lt: period.nextMonthFrom },
      },
      orderBy: [{ happenedAt: "asc" }, { createdAt: "asc" }],
    }),
    prisma.paymentSchedule.findMany({
      where: {
        userId: user.id,
        status: "scheduled",
        dueDate: { gte: period.nextMonthFrom, lt: period.nextMonthToExclusive },
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  const openingBalance = totalsFor(before, user.account.openingBalance).current;
  const totals = totalsFor(transactions, 0);
  const closingBalance = totalsFor(transactions, openingBalance).current;
  const upcomingCents = schedules.reduce((sum, item) => sum + toCents(item.amount), 0);
  const totalDebited = fromCents(toCents(totals.expense) + toCents(totals.withdrawal));
  const nextMonthLabel = new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(period.nextMonthFrom.getUTCFullYear(), period.nextMonthFrom.getUTCMonth(), 15, 12)));
  return {
    user,
    account: user.account,
    period,
    generatedAt,
    reference: `RTIGO-${period.monthKey.replace("-", "")}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
    openingBalance,
    totals,
    totalDebited,
    closingBalance,
    transactions,
    schedules,
    upcomingTotal: fromCents(upcomingCents),
    nextMonthLabel,
  };
}

function createMailer(config) {
  if (!config.SMTP_HOST) throw new Error("SMTP_HOST is not configured");
  return nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: Number(config.SMTP_PORT || 587),
    secure: String(config.SMTP_SECURE) === "true",
    ...(config.SMTP_USER ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } } : {}),
  });
}

async function deliverMonthlyReports(prisma, config = process.env, options = {}) {
  const now = options.now || new Date();
  const timeZone = config.MONTHLY_REPORT_TIMEZONE || "Asia/Kolkata";
  const period = getPreviousMonthPeriod(now, timeZone);
  const staleBefore = new Date(now.getTime() - STALE_DELIVERY_MS);
  let candidates;
  if (period.currentDay === 1) {
    const users = await prisma.user.findMany({
      where: { verifiedAt: { not: null }, createdAt: { lt: period.currentMonthStart } },
      select: { id: true, name: true, email: true, account: { select: { name: true, openingBalance: true } } },
    });
    candidates = users.map((user) => ({ user, delivery: null }));
  } else {
    const pending = await prisma.monthlyReportDelivery.findMany({
      where: {
        periodStart: period.from,
        OR: [
          { status: { in: ["pending", "failed"] } },
          { status: "sending", attemptedAt: { lt: staleBefore } },
        ],
      },
      include: {
        user: {
          select: { id: true, name: true, email: true, account: { select: { name: true, openingBalance: true } } },
        },
      },
    });
    candidates = pending.map((delivery) => ({ user: delivery.user, delivery }));
  }
  let mailer;
  let sent = 0;

  for (const { user, delivery: existingDelivery } of candidates) {
    const delivery = existingDelivery || await prisma.monthlyReportDelivery.upsert({
      where: { userId_periodStart: { userId: user.id, periodStart: period.from } },
      create: { userId: user.id, periodStart: period.from, status: "pending" },
      update: {},
      select: { id: true, status: true, attemptedAt: true },
    });
    if (delivery.status === "sent") continue;
    const claim = await prisma.monthlyReportDelivery.updateMany({
      where: {
        id: delivery.id,
        OR: [
          { status: { in: ["pending", "failed"] } },
          { status: "sending", attemptedAt: { lt: staleBefore } },
        ],
      },
      data: { status: "sending", attemptedAt: now, lastError: null },
    });
    if (!claim.count) continue;

    try {
      if (!options.sendMail && !mailer) mailer = createMailer(config);
      const report = await loadMonthlyReport(prisma, user, period, now);
      const password = crypto.randomBytes(16).toString("hex");
      const pdf = await createMonthlyReportPdf(report, password);
      const filename = `monthly-spend-report-${period.monthKey}.pdf`;
      const subject = `Monthly Spend Report - ${period.monthLabel}`;
      const body = [
        `Your Monthly Spend Report for ${period.monthLabel} (${formatDate(period.from)} to ${formatDate(period.to)}) is attached.`,
        "",
        `Opening balance: ${inr(report.openingBalance)}`,
        `Total credited: ${inr(report.totals.income)}`,
        `Paid expenses: ${inr(report.totals.expense)}`,
        `Withdrawals: ${inr(report.totals.withdrawal)}`,
        `Total debited: ${inr(report.totalDebited)}`,
        `Closing balance: ${inr(report.closingBalance)}`,
        `Upcoming bills in ${report.nextMonthLabel}: ${inr(report.upcomingTotal)}`,
        "",
        `PDF password: ${password}`,
        "The password is generated for this report and is not your website login password.",
      ].join("\n");
      const sendMail = options.sendMail || ((message) => mailer.sendMail(message));
      await sendMail({
        from: config.EMAIL_FROM,
        to: user.email,
        subject,
        text: body,
        attachments: [{ filename, content: pdf, contentType: "application/pdf" }],
      });
      await prisma.monthlyReportDelivery.update({
        where: { id: delivery.id },
        data: { status: "sent", sentAt: now, lastError: null },
      });
      sent += 1;
    } catch (error) {
      await prisma.monthlyReportDelivery.update({
        where: { id: delivery.id },
        data: { status: "failed", lastError: String(error.message || error).slice(0, 2000) },
      });
      console.error(`Monthly report delivery failed for user ${user.id}:`, error);
    }
  }
  return { period: period.monthKey, eligible: candidates.length, sent };
}

function startMonthlyReportScheduler(prisma, config = process.env) {
  const run = () => deliverMonthlyReports(prisma, config)
    .catch((error) => console.error("Monthly report job failed:", error));
  run();
  const interval = setInterval(run, DELIVERY_POLL_MS);
  interval.unref();
  return () => clearInterval(interval);
}

module.exports = { createMonthlyReportPdf, deliverMonthlyReports, getPreviousMonthPeriod, startMonthlyReportScheduler };
