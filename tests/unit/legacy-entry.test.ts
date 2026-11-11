import { describe, expect, it } from 'vitest';
import { isLegacyEntryBlocked } from '@/lib/study-run/legacy-entry';
import { makeHarness, RESEARCHER, ALL_CAPABILITIES } from '../helpers/study-run-fakes';
import { INFO_CONSENT_REVIEW_STATEMENT } from '@/lib/validation/study-run-schemas';

async function runWith(h: ReturnType<typeof makeHarness>, code: string, legacyEntry: 'UNCHANGED' | 'BLOCKED_WHILE_OPEN') {
  let run = (await h.service.create(RESEARCHER, { code, name: code, phase: 'MAIN', packageId: h.packageId.toHexString(), targetSampleSize: 30 })).run;
  const id = run._id!.toHexString();
  run = (await h.service.confirmQuota(RESEARCHER, id, { expectedVersion: run.version, quotaPerArm: 15 })).run;
  run = (await h.service.confirmEntryPolicy(RESEARCHER, id, { expectedVersion: run.version, legacyEntry })).run;
  run = (await h.service.confirmInfoConsentReview(RESEARCHER, id, { expectedVersion: run.version, statement: INFO_CONSENT_REVIEW_STATEMENT })).run;
  const profile = await h.confirmDefaultProfile();
  run = (await h.service.confirmPresentationProfile(RESEARCHER, id, { expectedVersion: run.version, profileId: profile._id!.toHexString() })).run;
  return { id, version: run.version };
}
const move = async (h: ReturnType<typeof makeHarness>, id: string, to: 'OPEN' | 'PAUSED' | 'CLOSED') =>
  h.service.transition(RESEARCHER, id, { expectedVersion: (await h.service.get(RESEARCHER, id)).version, to, reason: 'test' });

describe('legacyEntry enforcement (AC-28)', () => {
  it('no runs, or only UNCHANGED runs: legacy entry is never blocked, whatever the run status', async () => {
    const h = makeHarness({ capabilities: ALL_CAPABILITIES });
    expect(await isLegacyEntryBlocked(h.store)).toBe(false);
    const r = await runWith(h, 'U1', 'UNCHANGED');
    for (const to of ['OPEN', 'PAUSED', 'OPEN', 'CLOSED'] as const) { await move(h, r.id, to); expect(await isLegacyEntryBlocked(h.store)).toBe(false); }
  });
  it('BLOCKED_WHILE_OPEN blocks only while that run is OPEN (DRAFT, PAUSED and CLOSED do not)', async () => {
    const h = makeHarness({ capabilities: ALL_CAPABILITIES });
    const r = await runWith(h, 'B1', 'BLOCKED_WHILE_OPEN');
    expect(await isLegacyEntryBlocked(h.store)).toBe(false);          // DRAFT
    await move(h, r.id, 'OPEN');
    expect(await isLegacyEntryBlocked(h.store)).toBe(true);
    await move(h, r.id, 'PAUSED');
    expect(await isLegacyEntryBlocked(h.store)).toBe(false);
    await move(h, r.id, 'OPEN');
    expect(await isLegacyEntryBlocked(h.store)).toBe(true);
    await move(h, r.id, 'CLOSED');
    expect(await isLegacyEntryBlocked(h.store)).toBe(false);
  });
  it('several OPEN runs: blocked if ANY of them chose BLOCKED_WHILE_OPEN', async () => {
    const h = makeHarness({ capabilities: ALL_CAPABILITIES });
    const u = await runWith(h, 'U2', 'UNCHANGED');
    const b = await runWith(h, 'B2', 'BLOCKED_WHILE_OPEN');
    await move(h, u.id, 'OPEN');
    expect(await isLegacyEntryBlocked(h.store)).toBe(false);
    await move(h, b.id, 'OPEN');
    expect(await isLegacyEntryBlocked(h.store)).toBe(true);
    await move(h, b.id, 'CLOSED');
    expect(await isLegacyEntryBlocked(h.store)).toBe(false);
  });
});
