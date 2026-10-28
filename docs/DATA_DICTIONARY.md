# Data Dictionary

## Session

- `id`: anonymous UUID; not a student/person identifier.
- `status`: ACTIVE / DECLINED / WITHDRAWN / INCOMPLETE / COMPLETED.
- `currentStage`: authoritative experiment state.
- `groupCode`: A or B after assignment.
- `contentRevisionId`, `questionSetId`: pinned experimental materials.
- protocol version fields and wording snapshots: preserve what this session was shown.
- `minimumReadingSeconds`: pinned approved threshold for this session.
- `phase`: PILOT or MAIN.
- `deviceType`: desktop/tablet/mobile only; full user-agent is not stored.
- `validityFlag`, `validityReason`: researcher review outcome.

## Reading

- `roundNo`: 1 or 2.
- `presentation`: V1 or V2.
- `startedAt`, `finishedAt`: server timestamps.
- `renderedAt`, `nextClickedAt`: client descriptive timestamps.
- `readingSeconds`: server-derived elapsed duration.
- `scrollCount`: throttled count of scroll samples.
- `maxScrollDepthPercent`: clamped 0–100.

## Test

- one document per `sessionId + roundNo`.
- `answers[].selectedOptionId` may be null.
- `answers[].isCorrect` and `score` are server-derived and never sent to the participant UI.

## Missing values

CSV missing data remains blank. It is never silently converted to zero.
