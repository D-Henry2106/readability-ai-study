# Project Review — 2026-10-06

## Overall assessment

The project has a solid research-oriented architecture: server-authoritative stages, anonymous sessions, immutable published revisions, server scoring, counterbalanced V1/V2 order, server-side reading/break timers, admin authorization, and dedicated unit/integration/E2E suites.

It was not ready to treat as production-ready because the supplied version contained several runtime/configuration issues and a few research-design mismatches.

## High-priority technical issues corrected in this reviewed copy

1. **Vitest was collecting Playwright files.**
   - `npm test` used Vitest defaults, which match both `*.test.ts` and `*.spec.ts`.
   - `tests/e2e/*.spec.ts` therefore ran inside Vitest and Playwright threw `test()/beforeEach() did not expect ...`.
   - `vitest.config.ts` now includes only unit/integration tests and excludes `tests/e2e`.

2. **Test environment variables were not loaded for Playwright.**
   - Added `@next/env` as an explicit dependency.
   - Playwright/Vitest now load the test environment consistently.
   - Added `.env.test.example`; copy it to `.env.test.local` and keep a dedicated test DB.

3. **`tests/setup.ts` broke `next build`.**
   - Removed direct assignment to the readonly `process.env.NODE_ENV` property.
   - Test-only environment assignment now uses safe runtime mutation where required.

4. **CLI scripts used top-level await in CJS mode.**
   - `create-admin`, `create-indexes`, `test-db-setup`, and `test-db-reset` are now wrapped in async `main()` functions.
   - Scripts explicitly load project/test environment files outside the Next.js runtime.

5. **MongoDB configuration was coupled to `AUTH_SECRET`.**
   - The original `getEnv()` validated DB, auth, and app URL at once.
   - A short/invalid `AUTH_SECRET` could make a DB operation appear to be a MongoDB failure before MongoDB was even contacted.
   - MongoDB/auth/app env validation is now separated.

6. **The original `.env.example` was misleading.**
   - It did not include the complete local setup and contained an auth-secret example shorter than the schema requirement.
   - Replaced with non-secret placeholders and added a separate test-env example.

7. **Mongo connection retry behavior improved.**
   - A rejected cached connection promise is now cleared so a later request can retry after a transient failure.

8. **Invalid API request data could return HTTP 500.**
   - `ZodError` is now mapped to HTTP 400 with safe field-level issues.

9. **CSV spreadsheet formula injection hardened.**
   - Exported cells beginning with spreadsheet formula trigger characters are neutralized before CSV quoting.

10. **Participant UI received a visual refresh.**
    - Improved typography, spacing, cards, focus states, responsive layout, question choices, progress UI, landing page, and reading controls.
    - The experimental content area remains separately scoped so the surrounding design does not erase the V1/V2 manipulation.

11. **Reading start failure is now visible.**
    - The participant cannot continue until the server has successfully created/read the reading timer record.

## Important research-design issues that should not be silently changed in code

### 1. V2 description conflicts with the zero-lexical-difference rule

The stated research design says V2 must not add/remove/substitute words, but the supplied system prompt also says to add headings, bullet lists, a short summary, and highlighted key points. A newly written heading or summary necessarily introduces or duplicates lexical content.

The current application takes the safer reproducible interpretation: **one raw text source; V1/V2 differ only in presentation CSS**. This is internally cleaner, but the written protocol/proposal should be made consistent with the actual intervention before data collection.

### 2. Current V2 implementation is narrower than the written V2 specification

The effective V2 differences are mainly font size, line height, line width, letter spacing, and general typography. The CSS rule `.reader-v2 p` does not create paragraph groups because `rawContent` is rendered as one text node, not `<p>` elements. The code therefore does not currently implement generated headings, bullets, summaries, or semantic grouping.

Recommendation: either:
- redefine V2 in the research documents as a **typographic/readability presentation intervention**, or
- introduce a pre-approved structured presentation map that reuses the exact same lexical content without generating new words.

Do not generate V2 live with an LLM during participant sessions.

### 3. Repeating the same content and the same five MCQs creates carryover/practice risk

Counterbalancing A/B helps with order effects, but a participant still sees the same learning material and the same answer options twice. The first reading/test can affect the second reading/test through familiarity, memory, and question priming.

Before changing this, confirm with the supervisor/ethics-approved protocol. A stronger within-subject design would use two matched content passages and matched question sets with presentation/material/order counterbalancing, or alternatively use a between-subject design if exactly the same material/test must be used once per participant.

## Lower-priority improvements still worth considering

- Add edit UI for existing content/question drafts; APIs already support `UPDATE_DRAFT` but current admin screens mainly expose create + publish.
- Add better network-error handling to all client forms, not only the reading screen.
- Consider a login-rate-limit strategy for a public deployment.
- Consider moving index verification out of every participant session creation; it is safe but adds avoidable DB work per new session.
- The `LEXICAL_INTEGRITY` publish/readiness check currently compares `rawContent` with itself. Same-source rendering already guarantees this property; the check is redundant unless a second presentation representation is introduced.
- `INCOMPLETE` is modeled but not automatically assigned because no inactivity rule was approved. The dashboard label should be interpreted accordingly.

## Recommended local environment

Use Node.js 22 LTS for predictable local tooling.

Application env: `.env.local`

```text
MONGODB_URI=[MONGODB_URI_REDACTED]
AUTH_SECRET=<random value with at least 32 characters>
APP_URL=http://localhost:3000
```

Test env: `.env.test.local`

```text
MONGODB_URI=[MONGODB_URI_REDACTED]
AUTH_SECRET=<random test value with at least 32 characters>
```

Suggested validation order:

```text
npm install
npm run db:check
npm run db:indexes
npm run create-admin
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run test:e2e
npm run build
npm run dev
```

## Validation limitation in this review environment

Dependency installation could not be completed in the review container because package downloads encountered network/DNS `EAI_AGAIN` failures. Source-level corrections and configuration review were completed, but the reviewed ZIP should still be validated with the command sequence above on a machine with normal npm registry access and a reachable dedicated MongoDB test database.
