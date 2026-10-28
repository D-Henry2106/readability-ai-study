# Research Experiment Platform

A single-folder, full-stack Next.js application for a controlled online within-subject research experiment using MongoDB Atlas.


## Latest study-flow upgrades

- Public landing page contains no admin link; admin access remains available only by directly visiting `/admin/login`.
- Each reading round now ends on a dedicated pre-question review screen before the five comprehension questions are revealed.
- The review screen contains instructions only and never re-displays the learning material or answers.
- V2 accessible presentation now uses character-preserving visual sentence grouping in addition to readable line width, type size, line height and spacing.
- V1 and V2 still use one canonical raw content source; no words are generated or rewritten for V2.

## What is implemented

- Anonymous participant session with HttpOnly cookie.
- Server-authoritative experiment state machine and anti-URL-skip checks.
- Consent and demographics collection without direct identifiers.
- Counterbalanced Group A/B assignment.
- Same canonical raw content rendered as V1 and V2 with presentation-only DOM/CSS differences; V2 visual grouping preserves the exact source string.
- Reading timer, scroll metrics, 5-MCQ test, server-side scoring, 120-second break, two rounds, completion, withdrawal.
- Immutable published content/question revisions pinned to each session.
- Admin authentication, roles, dashboard, session review, validity review and audit events.
- PILOT/MAIN separation and CSV wide/long export.
- SEO/noindex controls, accessibility-oriented UI and security headers.
- Unit, MongoDB integration and Playwright E2E test files.
- Documentation under `docs/`.

## Important: experiment initially blocked

The application contains **no invented research protocol wording or research data**. On first run, the Experiment Readiness Check is expected to be blocked until a researcher enters approved protocol values and publishes approved content/questions.

See `research/UNRESOLVED_PROTOCOL_VALUES.md`.

## Requirements

- Node.js 20.9+ (Node.js 22 LTS recommended for the most predictable local tooling).
- npm.
- MongoDB Atlas or another compatible MongoDB deployment.

## Local setup

```bash
cp .env.example .env.local
npm install
npm run db:check
npm run db:indexes
npm run create-admin
npm run dev
```

Populate `.env.local` with your own values. Never commit secrets.

Required environment variables:

```text
MONGODB_URI=[MONGODB_URI_REDACTED]
AUTH_SECRET=<at least 32 random characters>
APP_URL=http://localhost:3000
```

Open `http://localhost:3000/admin/login`, configure approved protocol wording, publish one content revision and one question set for the active phase, then confirm Readiness is READY before recruiting participants.

## Validation commands for your machine

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
npm run build
```

Integration/E2E tests require a dedicated test database. Copy `.env.test.example` to `.env.test.local` and set:

```text
MONGODB_URI=[MONGODB_URI_REDACTED]
AUTH_SECRET=<at least 32 random characters>
```

The database is selected solely from the `/database_name` path in `MONGODB_URI` (no separate database-name variable). Development loads `.env.local`; tests load `.env.test.local` through `@next/env`. Test setup/reset and E2E fixtures can drop the entire database, so they require a dedicated URI whose database name ends in `_test` or `-test`. Never point tests to your development or production database.

## Deployment

Target deployment:

```text
GitHub → Vercel → Next.js → MongoDB Atlas
```

See `docs/DEPLOYMENT.md` for the full procedure.

## Data retention

Anonymous research data retention is documented as **3 years after thesis submission**, followed by secure deletion according to the approved protocol. The application does not invent a deletion date because the thesis submission date was not supplied.
