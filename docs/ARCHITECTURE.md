# Architecture

## Chosen architecture

A single Next.js full-stack application is used because the requirements do not justify a separate Express/Nest backend.

```text
Browser
  ↓
Next.js App Router
  ├─ Participant pages
  ├─ Admin pages
  └─ Route Handlers
       ↓
Validation / Auth / Session
       ↓
Focused Services
       ↓
ResearchRepository
       ↓
MongoDB Atlas
```

## Main modules

- `src/app`: pages and Route Handlers.
- `src/components/participant`: participant interaction components.
- `src/components/admin`: researcher interaction components.
- `src/lib/auth`: participant/admin cookies and authorization.
- `src/lib/experiment`: content normalization and presentation-order logic.
- `src/lib/services`: state, readiness, assignment, reading, break, scoring, export, audit.
- `src/lib/repositories`: MongoDB data access.
- `src/lib/db`: connection reuse, typed collections and indexes.
- `src/lib/validation`: Zod request/config validation.
- `tests`: unit, integration and E2E tests.

## Why no extra infrastructure

No Redis, Kafka, message queues, GraphQL, WebSocket, Redux, social login, participant accounts, trackers, AI assistant or microservices are used because none is required by the research purpose.
