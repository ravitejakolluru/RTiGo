# Personal Expenditure & Fund Management

A responsive full-stack finance tracker built with React, Vite, Express, Prisma, and MySQL. All financial amounts are Indian rupees (INR), and displayed dates use `dd/mm/yy`. The interface supports English, Hindi, Telugu, Kannada, and Tamil; each account's language preference is saved with its financial account.

## Requirements

- Node.js 20+
- MySQL 8+
- SMTP service (Mailpit is suitable for local development)

## Setup

1. Copy `.env.example` to `.env`, set `DATABASE_URL` and a random `JWT_SECRET`, and configure SMTP.
2. Create the MySQL database named in `DATABASE_URL`.
3. From the project root run:

   ```sh
   npm install
   npm run db:generate
   npm run db:migrate
   npm run db:seed
   npm run dev
   ```

4. Open `http://localhost:5173`. Register with an email address; the verification code is sent through the configured SMTP server. In development, the API logs a verification code if SMTP delivery fails.

The API listens on `http://localhost:3001`. The Vite development server proxies `/api` requests to it.

## Features and API

- Authentication: `POST /api/auth/register`, `/verify-email`, `/resend-verification`, `/login`, `/logout`, `/forgot-password`, `/reset-password`; bearer session is stored in an HttpOnly, SameSite cookie.
- Dashboard: `GET /api/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD`
- Transactions: `GET/POST /api/transactions`, `PATCH/DELETE /api/transactions/:id`; income, expense, and withdrawal entries use decimal database amounts and audited soft deletions.
- Schedules: `GET/POST /api/schedules`, `PATCH/DELETE /api/schedules/:id`; marking a schedule paid creates its cash transaction atomically and once.
- Statements: `GET /api/statements.pdf?from=...&to=...&type=all|income|expense|withdrawal` (amounts are labeled INR)
- Monthly reports: verified users receive an encrypted PDF by email on the first day of each month. It covers the previous calendar month, includes transaction and balance totals, and lists unpaid bills due the following month. A unique random PDF password is included in the same email as selected; this protects the attachment if stored or forwarded separately but is not a separate authentication channel. Configure `MONTHLY_REPORT_TIMEZONE` (defaults to `Asia/Kolkata`); the monthly job uses the configured SMTP settings, records delivery status to avoid routine duplicates, and retries failures.
- Public reports: `POST /api/shares`, `GET /api/shares`, `DELETE /api/shares/:id`; public read-only endpoint `GET /api/public/:token`. Selectable report summaries include received income and paid expenditure for the chosen period, plus current available balance.
- Account: `GET/PATCH /api/account` for opening balance, language preference (`en`, `hi`, `te`, `kn`, or `ta`), and the explicit overdraft setting.

All user-owned reads and mutations are scoped to the authenticated account owner. Public reports are scoped on the server by token, selected dates, and an allow-list of fields. A development share URL using `localhost` only works on the computer running the app; to share with others, deploy the site at a publicly reachable HTTPS address and set `APP_ORIGIN` to that exact public site origin. The share URL is based on `APP_ORIGIN`. Set `NODE_ENV=production`, secure the database/network, and configure a production SMTP service before deployment. Deploy the API and built `client/dist` behind a TLS-terminating reverse proxy, and provide secrets through the deployment environment (not source control).

## Database and tests

The Prisma schema and initial MySQL migration are in `server/prisma/`. The default seed command only verifies database connectivity. To add clearly labeled demo activity, first register and verify an empty account, then set `SEED_DEMO_DATA=true` and `SEED_EMAIL` in `.env` and run `npm run db:seed`. No sample user, credentials, or financial activity are created without this explicit opt-in. Run `npm test` for monetary arithmetic, date-window, and ownership/public-field permission tests.

## Deploying on Render and Vercel

The frontend is hosted on Vercel; the Express API runs on Render. Vercel proxies `/api` to Render so browser sessions remain same-origin and the secure HttpOnly cookie continues to work. `render.yaml` describes the Render API service, and `vercel.json` configures the frontend build and API/SPA rewrites.

**Database requirement:** this application uses Prisma's MySQL connector. Render and Vercel do not provide a MySQL database for this setup, so provision an externally reachable MySQL 8-compatible database with TLS and backups from a managed MySQL provider. Do not use `localhost` or expose a development database. The remote production database starts empty; local financial data is not automatically copied.

1. Push the project to a private GitHub repository. Make sure `.env` and database exports are not committed.
2. Provision a managed MySQL 8-compatible database and keep its TLS-enabled connection URL private.
3. Import the GitHub repository into Vercel from the project root. Keep the build command `npm run build`, install command `npm ci`, and output directory `client/dist` (already set in `vercel.json`). Assign the Vercel production domain you want to use.
4. Create a Render Blueprint from the same repository, using `render.yaml`. It is configured on the Free plan for initial testing. Free instances can sleep, so monthly report delivery is not reliable until you change the API service to an always-on paid plan.
5. In the Render service environment, set:
   - `DATABASE_URL` to the managed MySQL connection URL.
   - `APP_ORIGIN` to the exact Vercel production origin, e.g. `https://your-project.vercel.app`, with no path or trailing slash.
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `EMAIL_FROM` from a production SMTP provider.
   - Keep the generated `JWT_SECRET`, `NODE_ENV=production`, `TRUST_PROXY=true`, and `MONTHLY_REPORT_TIMEZONE=Asia/Kolkata`.
6. After Render creates the API's `https://...onrender.com` domain, edit `vercel.json` and replace `your-render-service.onrender.com` with that exact Render hostname. Push the change and wait for Vercel to redeploy.
7. Confirm `https://your-render-service.onrender.com/api/health` returns `{"status":"ok"}`, then open the Vercel site. Register a production account and confirm email verification, login/logout, transaction entry, statement PDFs, public share links, and monthly email delivery.

The Render start command applies `prisma migrate deploy` before starting the API. Back up the production database before deploying schema changes. Never use a production login password as a PDF password, commit secrets, or enable demo seeding in production. Treat a production database as a separate account: copying local financial records requires a deliberate, secure migration and backup.
