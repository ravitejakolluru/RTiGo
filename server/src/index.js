const path = require("node:path");
const envPath = path.resolve(process.env.ENV_FILE || path.join(__dirname, "..", "..", ".env"));
require("dotenv").config({ path: envPath });
const { PrismaClient } = require("@prisma/client");
const { createApp } = require("./app");
const { startMonthlyReportScheduler } = require("./monthly-reports");

if (!process.env.DATABASE_URL) throw new Error(`DATABASE_URL must be configured in ${envPath}`);
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error(`JWT_SECRET must contain at least 32 characters in ${envPath}`);

const prisma = new PrismaClient();
const app = createApp(prisma);
const stopMonthlyReportScheduler = startMonthlyReportScheduler(prisma);
const port = Number(process.env.PORT || process.env.API_PORT || 3001);

const server = app.listen(port, "0.0.0.0", () => console.log(`Fund Manager API listening on port ${port}`));

async function shutdown() {
  stopMonthlyReportScheduler();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
