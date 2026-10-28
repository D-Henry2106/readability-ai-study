# Testing Guide

## Architecture

- `tests/unit`: pure logic and service tests without a real research DB.
- `tests/integration`: MongoDB-backed service/repository integration tests.
- `tests/e2e`: Playwright tests against the running Next.js app.
- `tests/helpers/test-db.ts`: test-only fixtures and database safety guards.

## Test database

Copy `.env.test.example` to `.env.test.local`, then set a dedicated test database only:

```text
MONGODB_URI=[MONGODB_URI_REDACTED]
AUTH_SECRET=<32+ characters for test runtime>
```

The test runner loads `.env.test.local` through `@next/env` with `NODE_ENV=test` (it does not load `.env.local`). The MongoDB database is selected from the path in `MONGODB_URI`. The helper/reset scripts reject any database not ending in `_test` or `-test`; they can drop the entire database. Use a separate database from local development and production. Vitest owns unit/integration tests; Playwright owns `tests/e2e` and refuses to reuse an existing local server.

## Commands

```bash
npm run lint
npm run typecheck
npm run test
npm run test:unit
npm run test:integration
npm run test:e2e
npm run build
```

Database utilities:

```bash
npm run test:db:setup
npm run test:db:reset
```

## What is covered

Unit tests cover state behavior, group assignment, V1/V2 order, scoring, lexical integrity, reading-time validation, 120-second break, question validation, CSV empty mapping and readiness.

Integration tests exercise real MongoDB uniqueness, anonymous session creation, consent/demographics persistence, duplicate test-attempt protection, immutable published content and CSV export.

Playwright covers both counterbalanced flows and important edge cases including manual `/complete` navigation, refresh during reading, withdrawal, unauthorized Admin API and unanswered MCQs. Break expiry is accelerated only by modifying the isolated test fixture database; production break logic remains fixed at 120 seconds.

## Expected result

Tests require dependencies and a reachable dedicated test DB. If integration fails before connecting, check that `.env.test.local` declares `MONGODB_URI` with an explicit `_test`/`-test` database path. A missing URI now fails rather than silently skipping integration tests.

## Reading failures

- Zod/400 failures usually indicate invalid test payload or a state mismatch.
- `EXPERIMENT_NOT_READY` means protocol/config fixtures are missing.
- duplicate-key errors on session+round indicate idempotency protection is working unless the test expected a first insert.
- database timeout means the test URI/network allow-list is not reachable.

## Manual pre-deploy checklist

- [ ] Landing page works.
- [ ] Experiment readiness works.
- [ ] Session is created once.
- [ ] Refresh does not create a new session.
- [ ] Consent persists.
- [ ] Decline exits the flow.
- [ ] Demographics save correctly.
- [ ] Group A/B is assigned and persists.
- [ ] Manual URL skip is blocked server-side.
- [ ] V1/V2 use the same raw content.
- [ ] Lexical integrity passes.
- [ ] Reading timer does not reset on refresh.
- [ ] Server enforces approved minimum reading time.
- [ ] Scroll metrics are stored and depth remains 0–100.
- [ ] Participant test payload never receives correct answers.
- [ ] Server-side scoring is correct.
- [ ] Double/concurrent submit does not create duplicate attempts.
- [ ] Break cannot be skipped before 120 seconds.
- [ ] Break does not reset on refresh.
- [ ] Withdrawal works without a reason.
- [ ] Complete is accessible only after both tests.
- [ ] Admin authentication and authorization work.
- [ ] Published content revision is immutable.
- [ ] Published question set is immutable.
- [ ] Dashboard uses real MongoDB data.
- [ ] Empty database displays zero counts.
- [ ] Wide and long CSV export correctly.
- [ ] Missing data remains blank, not zero.
- [ ] Admin and experiment routes are noindex.
- [ ] Sitemap exposes no research material.
- [ ] No secrets are committed.
- [ ] Production build succeeds locally.
