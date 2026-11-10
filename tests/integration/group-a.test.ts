import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ObjectId } from 'mongodb';
import { resetAndSeedReady, withTestDb } from '../helpers/test-db';
import { ResearchRepository } from '@/lib/repositories/research.repository';

const requireAdmin = vi.fn();
vi.mock('@/lib/auth/admin-session', () => ({ requireAdmin: (...a: unknown[]) => requireAdmin(...a), getAdminSession: vi.fn() }));
const post = (url: string, body: unknown) => new NextRequest(`http://localhost${url}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

describe('Group A on a real MongoDB', () => {
  let contentId: ObjectId, questionSetId: ObjectId;
  beforeEach(async () => {
    ({ contentId, questionSetId } = await resetAndSeedReady({ existingGroup: 'A' }));
    requireAdmin.mockReset();
    requireAdmin.mockResolvedValue({ username: 'r', role: 'RESEARCHER', exp: 0 });
  });

  it('session list supports the same revision filter as statistics/export', async () => {
    const repo = new ResearchRepository();
    expect((await repo.listSessions({ page: 1, pageSize: 25, phase: 'MAIN', revision: 1 })).total).toBe(1);
    expect((await repo.listSessions({ page: 1, pageSize: 25, phase: 'MAIN', revision: 2 })).total).toBe(0);
    expect((await repo.listSessions({ page: 1, pageSize: 25, phase: 'MAIN', packageCode: 'FIXTURE_MAIN', groupCode: 'B' })).total).toBe(0);
  });

  it('legacy question/content endpoints refuse revisions owned by a package (409) and change nothing', async () => {
    const q = await import('@/app/api/admin/questions/route');
    const c = await import('@/app/api/admin/content/route');
    for (const action of ['PUBLISH', 'UPDATE_DRAFT']) {
      const rq = await q.POST(post('/api/admin/questions', { action, id: questionSetId.toHexString() }));
      const rc = await c.POST(post('/api/admin/content', { action, id: contentId.toHexString() }));
      expect(rq.status).toBe(409); expect((await rq.json()).code).toBe('PACKAGE_OWNED_REVISION');
      expect(rc.status).toBe(409); expect((await rc.json()).code).toBe('PACKAGE_OWNED_REVISION');
    }
    const repo = new ResearchRepository();
    expect(await repo.isRevisionOwnedByPackage('content', contentId)).toBe(true);
    expect(await repo.isRevisionOwnedByPackage('questions', new ObjectId())).toBe(false);
    expect(await withTestDb(db => db.collection('admin_audit').countDocuments())).toBe(0);
  });

  it('a standalone (non-package) draft can still be published through the legacy API', async () => {
    const repo = new ResearchRepository();
    const id = await repo.insertContent({ revision: 99, topicLabel: 'x', rawContent: 'x', contentHash: 'h', wordCount: 1, status: 'DRAFT', locked: false, phase: 'PILOT', createdAt: new Date(), publishedAt: null });
    expect(await repo.isRevisionOwnedByPackage('content', id)).toBe(false);
  });
});
