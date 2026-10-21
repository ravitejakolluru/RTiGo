const path = require("node:path");

require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env") });

async function main() {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    if (process.env.SEED_DEMO_DATA !== "true") {
      console.log("Database connection verified. Set SEED_DEMO_DATA=true and SEED_EMAIL to opt into sample records.");
      return;
    }
    const email = process.env.SEED_EMAIL?.trim().toLowerCase();
    if (!email) throw new Error("SEED_EMAIL is required when SEED_DEMO_DATA=true");
    const user = await prisma.user.findUnique({ where: { email }, include: { account: true } });
    if (!user?.verifiedAt || !user.account) throw new Error("SEED_EMAIL must belong to a verified account");
    const [transactionCount, scheduleCount] = await Promise.all([
      prisma.transaction.count({ where: { userId: user.id } }),
      prisma.paymentSchedule.count({ where: { userId: user.id } }),
    ]);
    if (transactionCount || scheduleCount) {
      console.log("Sample data was not added because this account already has financial records.");
      return;
    }
    const now = new Date();
    const day = (offset) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset));
    await prisma.$transaction([
      prisma.account.update({ where: { userId: user.id }, data: { name: "Demo household", openingBalance: "1250.00" } }),
      prisma.transaction.createMany({
        data: [
          { userId: user.id, kind: "income", amount: "3200.00", title: "Monthly salary", counterparty: "Example employer", category: "Work", method: "Bank transfer", happenedAt: day(7), status: "posted" },
          { userId: user.id, kind: "expense", amount: "1450.00", title: "Monthly rent", counterparty: "Example property", category: "Housing", happenedAt: day(5), status: "posted" },
          { userId: user.id, kind: "expense", amount: "82.40", title: "Weekly groceries", counterparty: "Local market", category: "Food", happenedAt: day(2), status: "posted" },
          { userId: user.id, kind: "withdrawal", amount: "150.00", title: "Cash withdrawal", counterparty: "ATM", category: "Cash", happenedAt: day(1), status: "posted" },
        ],
      }),
      prisma.paymentSchedule.createMany({
        data: [
          { userId: user.id, name: "Internet bill", amount: "64.99", recipient: "Example provider", category: "Utilities", dueDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 5)) },
          { userId: user.id, name: "Insurance premium", amount: "112.00", recipient: "Example insurer", category: "Insurance", dueDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 12)) },
        ],
      }),
    ]);
    console.log(`Added sample records for ${email}. Remove them before using this account for real finances.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exitCode = 1;
});
