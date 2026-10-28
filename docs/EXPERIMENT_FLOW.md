# Experiment Flow

## Participant sequence

```text
Landing
→ Participant Information
→ Consent
→ Demographics
→ backend assignment
→ Reading Round 1
→ Pre-question review / instructions
→ Test Round 1
→ mandatory 120-second break
→ Reading Round 2
→ Pre-question review / instructions
→ Test Round 2
→ Complete / Debrief
```

## Counterbalancing

```text
Group A: V1 → Test → Break → V2 → Test
Group B: V2 → Test → Break → V1 → Test
```

Assignment occurs once after demographics. If one group has fewer assignments, the service chooses that group; when balanced, a cryptographically secure random choice is used. The stored `groupCode` is never changed on refresh.

## V1 / V2

Both render the exact same `rawContent`. V1 and V2 only differ in CSS presentation. The project deliberately does not generate V2 headings, summaries, examples or explanatory text because that would violate zero lexical difference.

## Timers

Reading start and break start are stored on the server. Client timestamps are descriptive only. The server decides whether the minimum reading period or 120-second break has elapsed.


## Pre-question review stage

After each reading timer is successfully completed, the server moves the participant to `REVIEW_1` or `REVIEW_2` before any question is shown. The review screen explains the question procedure only. It deliberately does **not** re-display the learning material, question text, answer options, scores, or presentation labels. This improves transition clarity without adding a second exposure to V1/V2 content.

## Accessible V2 visual grouping

V2 now partitions the same source string into visual blocks at sentence boundaries. The partition function is character-preserving: concatenating all rendered V2 blocks reproduces the exact source string. CSS block spacing, line length, font sizing and line height create the accessibility/readability manipulation without generating headings, summaries or any new lexical content.
