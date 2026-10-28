# Database Design

## Collections

- `sessions`: anonymous session, server stage, assignment, pinned revisions/config snapshots, validity.
- `consents`: one consent decision per anonymous session.
- `demographics`: one demographic record per anonymous session.
- `content_revisions`: versioned immutable published experimental content.
- `question_sets`: versioned immutable published 5×4 MCQ sets.
- `reading_sessions`: reading start/finish timestamps and scroll metrics per round.
- `test_attempts`: one scored attempt per session+round.
- `breaks`: server-timed 120-second break.
- `experiment_events`: meaningful research-flow events only.
- `admins`: researcher/supervisor credentials with scrypt hashes.
- `admin_audit`: important admin actions.
- `experiment_config`: current approved protocol configuration.

## Key indexes

The setup logic creates real MongoDB indexes including:

- `sessions.id` unique.
- `sessions.status`, `groupCode`, `validityFlag`, `createdAt`.
- `consents.sessionId` unique.
- `demographics.sessionId` unique.
- `reading_sessions(sessionId, roundNo)` unique.
- `test_attempts(sessionId, roundNo)` unique.
- `breaks.sessionId` unique.
- `admins.username` unique.
- content/question lookup indexes by phase/status/revision.

Run `npm run db:indexes` during setup. Session creation also verifies indexes before opening a new experiment session.

## MongoDB design rationale

Question options are embedded inside each question set because they are versioned and published as one coherent immutable unit. Reading/test records remain separate because each round has its own timestamps, metrics and uniqueness constraints.
