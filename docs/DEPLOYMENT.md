# Deployment — MongoDB Atlas + Vercel

## 1. MongoDB Atlas

1. Create an Atlas project and cluster.
2. Create a dedicated database user with only the permissions required for this application.
3. Configure Network Access according to your institution/security requirements. Avoid unrestricted access where a narrower option is practical.
4. Copy the MongoDB connection string without committing it to source control.

## 2. Local environment

Create `.env.local` from `.env.example` and set:

```text
MONGODB_URI=[MONGODB_URI_REDACTED]
AUTH_SECRET=<32+ random characters>
APP_URL=http://localhost:3000
```

Then run:

```bash
npm install
npm run db:check
npm run db:indexes
npm run create-admin
npm run dev
```

## 3. Pre-deploy checks on your machine

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
npm run build
```

Create `.env.test.local` from `.env.test.example` and use `MONGODB_URI` with a dedicated database whose URI path ends in `_test` or `-test`. Test reset and fixtures can drop that database. Never use the development or production research database.

## 4. GitHub

Push source code only. Confirm `.env`, `.env.local`, participant exports, database dumps, Playwright output and coverage are not committed.

## 5. Vercel

1. Import the GitHub repository.
2. Framework preset: Next.js.
3. Add `MONGODB_URI`, `AUTH_SECRET`, `APP_URL` as Vercel environment variables. Include the production database path (e.g. `/research_experiment_prod`) in `MONGODB_URI`; no separate DB-name variable is used.
4. Set `APP_URL` to the final HTTPS production URL.
5. Deploy.

## 6. Production verification

- HTTPS works.
- Database connection works.
- Admin login works.
- `npm run db:indexes` has been run against the production DB once during controlled setup.
- Experiment Readiness is READY only after approved protocol values/content/questions are present.
- Admin and experiment routes are noindex.
- Sitemap contains no research material.
- No secrets or participant data exist in the deployment repository.

Anonymous research data retention: 3 years after thesis submission, then secure deletion according to the approved protocol. No deletion date is automatically invented.
