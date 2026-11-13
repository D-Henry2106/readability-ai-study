import { beforeEach, describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { resetAndSeedReady, withTestDb } from '../helpers/test-db';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { ExportService } from '@/lib/services/export.service';

// Requires a dedicated test MongoDB (see tests/helpers/test-mongo-env.ts).
const questionSetId = new ObjectId();
const session = (id: string, variant: 'V1' | 'V2') => ({
  id, participantId: `p-${id}`, invitationId: new ObjectId(), studyRunId: new ObjectId(), presentationVariant: variant, presentationVersion: 1,
  status: 'COMPLETED', currentStage: 'COMPLETED', groupCode: null, phase: 'MAIN', deviceType: 'desktop', validityFlag: 'VALID', questionSetId, questionSetRevision: 3,
  contentRevisionId: new ObjectId(), createdAt: new Date('2026-11-01T00:00:00Z'), updatedAt: new Date(), completedAt: new Date('2026-11-01T00:30:00Z'), withdrawnAt: null
});

describe('P5 with a real MongoDB', () => {
  beforeEach(async () => { await resetAndSeedReady(); });

  it('V1 and V2 locks persist independently', async () => {
    const repo = new ResearchRepository();
    expect((await repo.getVariantLocks()).V1.locked).toBe(false);
    await repo.setVariantLock('V1', true, 'researcher', new Date('2026-11-11T10:00:00Z'));
    let locks = await repo.getVariantLocks();
    expect(locks.V1).toMatchObject({ locked: true, changedBy: 'researcher' });
    expect(locks.V2.locked).toBe(false);
    await repo.setVariantLock('V2', true, 'researcher', new Date());
    await repo.setVariantLock('V1', false, 'researcher', new Date());
    locks = await repo.getVariantLocks();
    expect([locks.V1.locked, locks.V2.locked]).toEqual([false, true]);
    // The lock document must not disturb the active research config.
    expect((await repo.getConfig()).phase).toBe('MAIN');
  });

  it('the run export for V1 and the one for V2 never mix participants', async () => {
    await withTestDb((db) => db.collection('sessions').insertMany([session('s-v1-a', 'V1'), session('s-v1-b', 'V1'), session('s-v2-a', 'V2')] as never[]));
    const exporter = new ExportService();
    const v1 = (await exporter.run('MAIN', { variant: 'V1' })).split('\n');
    const v2 = (await exporter.run('MAIN', { variant: 'V2' })).split('\n');
    expect(v1.length - 1).toBe(2);
    expect(v2.length - 1).toBe(1);
    expect(v1.join('\n')).not.toContain('s-v2-a');
    expect(v2.join('\n')).not.toContain('s-v1-');
    expect(v1.slice(1).every((row) => row.includes('"V1"'))).toBe(true);
  });

  it('the session list can be filtered by variant', async () => {
    await withTestDb((db) => db.collection('sessions').insertMany([session('s-v1', 'V1'), session('s-v2', 'V2')] as never[]));
    const repo = new ResearchRepository();
    const v2 = await repo.listSessions({ page: 1, pageSize: 25, phase: 'MAIN', variant: 'V2' });
    expect(v2.items.map((s) => s.id)).toEqual(['s-v2']);
  });
});
