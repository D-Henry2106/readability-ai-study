# Server-Authoritative State Machine

```text
INFORMATION
→ CONSENT
→ DEMOGRAPHICS
→ READING_1
→ REVIEW_1
→ TEST_1
→ BREAK
→ READING_2
→ REVIEW_2
→ TEST_2
→ COMPLETED
```

`REVIEW_1` and `REVIEW_2` are pre-question transition stages. They show only neutral instructions about the five-question comprehension task. They do not show the reading material, presentation label, question text, answer options, correct answers, or score.

Terminal/non-normal statuses:

```text
DECLINED
WITHDRAWN
INCOMPLETE
```

`currentStage` in MongoDB is the source of truth. Participant pages compare the requested page with the stored stage and redirect to the canonical route when they do not match. Route Handlers independently validate stage before accepting data, so manually entering a future URL cannot bypass server validation.

Refresh does not recreate the session, group assignment, reading start time, break start time or stage.
