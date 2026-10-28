# API Reference

All participant APIs use the anonymous HttpOnly `exp_session` cookie. Admin APIs require a valid signed admin session cookie and role authorization.

## Participant

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/session` | Create anonymous session after readiness passes |
| GET | `/api/session/current` | Return current safe status/stage/route |
| POST | `/api/information/ack` | Record information shown and advance to consent |
| POST | `/api/consent` | Accept/decline consent |
| POST | `/api/demographics` | Save allowed demographics and assign group |
| POST | `/api/reading/start` | Idempotently start current reading round |
| POST | `/api/reading/finish` | Validate server reading time and save scroll metrics |
| POST | `/api/test/start` | Record test-start event |
| POST | `/api/test/submit` | Validate answers, score server-side, idempotently persist attempt |
| GET | `/api/break/status` | Return server-calculated remaining break seconds |
| POST | `/api/break/finish` | Advance only after 120 seconds elapsed |
| POST | `/api/withdraw` | Mark active participant withdrawn without asking for reason |

## Admin

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/admin/login` | Admin login |
| POST | `/api/admin/logout` | Clear admin session |
| GET/POST | `/api/admin/config` | Read/update protocol config |
| GET/POST | `/api/admin/content` | List/create/publish content revisions |
| GET/POST | `/api/admin/questions` | List/create/publish question sets |
| GET | `/api/admin/sessions` | Search/filter/paginate sessions |
| GET | `/api/admin/sessions/[id]` | Session detail |
| POST | `/api/admin/sessions/[id]/validity` | Set validity and reason |
| GET | `/api/admin/export` | Wide/long CSV export |

Participant test responses never include answer keys, `isCorrect` or scores.
