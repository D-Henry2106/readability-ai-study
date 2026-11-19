# P5 – implementation notes

- One Study Run snapshots ONE question set (15 questions, 3 per category, 0–15 points) shared by V1 and V2. `variant` of the invitation is the "version".
- Invitation pins `questionSetId` + `questionSetRevision` at issue time (copied from the run snapshot); the session copies them at redeem time.
- Per-variant intake lock: document `{ key: 'variant-locks' }` in `experiment_config` (no new collection). Enforced in `InvitationService.issue` and `InvitationRedemptionService.redeemIssued` only; resume, recovery and test submit never read it. Audit: `VARIANT_LOCKED` / `VARIANT_UNLOCKED` in `admin_audit`.
- Old data: sets/attempts with 5 questions stay readable and are scored/validated against their own size; they cannot be chosen for a new Study Run. Old invitations (no pin) fall back to the run snapshot. No migration script is needed.
- Export: `/api/admin/export?format=run&variant=V1|V2&phase=MAIN|PILOT` (one file per variant); `variant` filter also works for the other formats and for the session list.

## Commands (run locally)
    npm ci
    npm run typecheck
    npm run lint
    npx vitest run tests/unit
    # integration: dedicated TEST MongoDB only (see tests/helpers/test-mongo-env.ts)
    npm run test:db:setup
    npx vitest run tests/integration
    npm run build
