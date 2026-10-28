# Requirements Summary & Traceability

## Requirements Summary

The implementation treats the website as a controlled online research experiment, not a general content website. Priority is research validity → data integrity → experiment flow → security → accessibility → UX → maintainability → performance → limited SEO.

Core requirements implemented:

- no mock production/development research data;
- no invented protocol wording or thresholds;
- experiment readiness gate;
- anonymous session and privacy-preserving storage;
- server-authoritative state machine;
- within-subject two-round experiment with A/B counterbalancing;
- one raw content source and zero lexical difference between V1/V2;
- server reading/break timing and server-side MCQ scoring;
- idempotent one-attempt-per-round persistence;
- withdrawal separated from incomplete/abandoned behavior;
- MongoDB indexes and pinned immutable revisions;
- researcher/supervisor admin area;
- PILOT/MAIN separation, validity review, audit and CSV export;
- accessibility/noindex/security/test/deployment documentation.

## Architecture Plan

```text
Next.js 16 App Router
├─ Participant UI
├─ Admin UI
├─ Route Handlers
├─ Zod validation
├─ Cookie auth/session
├─ Focused services
├─ ResearchRepository
└─ MongoDB Atlas
```

A separate Express/Nest backend, Redis, GraphQL, message queues and complex client state were intentionally not added.

## Unresolved Protocol Values

See `research/UNRESOLVED_PROTOCOL_VALUES.md`. The application blocks recruitment until required approved values are configured.

## Requirement Traceability Matrix

| Requirement | Implementation | Main files |
|---|---|---|
| Experiment readiness | Missing approved values block session creation | `readiness.service.ts`, Admin dashboard |
| No mock research data | Empty DB by default; fixtures only under `tests/` | `tests/helpers/test-db.ts` |
| Anonymous session | UUID + HttpOnly cookie; no direct identifiers | `session.service.ts`, `participant-session.ts` |
| Consent | Explicit accept/decline, versions persisted | `/api/consent`, `consents` |
| Demographics | Only listed research demographics | `DemographicsForm.tsx`, `/api/demographics` |
| Counterbalancing | A/B assign once; smaller group preferred, secure random on tie | `assignment.service.ts` |
| Refresh persistence | Stored session/group/stage/timers | repository + participant guard |
| Server state machine | Every API/page checks stored stage | `state.service.ts`, `participant-guard.ts` |
| Anti URL skip | Server page redirect + API stage validation | participant pages/routes |
| V1/V2 same content | One `rawContent`; CSS-only presentation | `ReadingClient.tsx`, `content-integrity.ts` |
| Zero lexical difference | No V2-generated headings/summary; publish check/test | content service + unit test |
| Reading time | Server `startedAt` and approved pinned minimum | `reading.service.ts` |
| Scroll metrics | Throttled count and max depth 0–100 | `ReadingClient.tsx`, validation schema |
| 5×4 MCQ | Zod validates 5 questions × 4 options × one correct | `questionSetSchema` |
| Answer-key secrecy | Participant gets id/prompt/options only | test page mapping |
| Server scoring | Correct options used only server-side | `scoring.service.ts` |
| Idempotent submission | Unique `(sessionId, roundNo)` + duplicate handling | indexes + repository |
| Mandatory 120s break | Server start/status/finish | `break.service.ts` |
| Withdrawal | Explicit action, no reason | `/api/withdraw` |
| Completion gate | `/complete` requires `COMPLETED` stage | participant guard |
| MongoDB indexes | Setup script + session setup verification | `db/indexes.ts`, `db:indexes` script |
| Content revisions | Draft → publish/lock; session pins revision | content service/repository |
| Question revisions | Draft → validate → publish/lock; session pins set | question service/repository |
| PILOT vs MAIN | Config, revisions, sessions and exports carry phase | types/services/admin |
| Admin auth | scrypt password, signed expiring cookie | `password.ts`, `admin-session.ts` |
| Roles | Researcher write/export; Supervisor read/review | admin APIs/UI |
| Dashboard | Real MongoDB counts, targets labeled as target | `/admin` |
| Validity review | VALID/INVALID/REVIEW_REQUIRED + reason | session detail/API |
| Audit | Publish/config/validity/export actions | `audit.service.ts` |
| Experiment events | Meaningful flow events, not clickstream | `event.service.ts` |
| CSV wide/long | Real sessions only, blanks for missing | `export.service.ts` |
| Accessibility | semantic forms, focus, reduced motion, responsive UI | CSS/components |
| SEO | root-only sitemap, noindex experiment/admin | `robots.ts`, `sitemap.ts`, metadata |
| Security | secrets, cookies, authz, validation, headers | config/auth/security/routes |
| Automated tests | Unit/integration/E2E source provided | `tests/` |
| Vercel deployment | Env/Atlas/Vercel instructions | `DEPLOYMENT.md` |
