import { describe, expect, it } from 'vitest';
import { RunOverviewService } from '@/lib/services/run-overview.service';
import type { StudyRunRepository } from '@/lib/repositories/study-run.repository';
import type { InvitationRepository } from '@/lib/repositories/invitation.repository';

const oid = (hex: string) => ({ toHexString: () => hex });
const run = (hex: string, over: Record<string, unknown> = {}) => ({
  _id: oid(hex), code: `R${hex}`, name: `Run ${hex}`, phase: 'MAIN', status: 'OPEN', quotaPerArm: 15,
  arms: { V1: { validIncluded: 12, supplementalValid: 0 }, V2: { validIncluded: 3, supplementalValid: 0 } }, ...over
});

describe('dashboard run overview', () => {
  it('counts personal links created, used, unused and revoked per run, and reports quota progress per variant', async () => {
    const runs = { list: async () => [run('a'), run('b', { quotaPerArm: null, status: 'DRAFT', arms: undefined })] } as unknown as StudyRunRepository;
    const links = {
      listByRun: async (id: { toHexString: () => string }) =>
        id.toHexString() === 'a'
          ? [{ status: 'REDEEMED' }, { status: 'REDEEMED' }, { status: 'ISSUED' }, { status: 'ISSUED' }, { status: 'ISSUED' }, { status: 'REVOKED' }]
          : []
    } as unknown as InvitationRepository;

    const rows = await new RunOverviewService({ runs, links }).list();

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: 'a', status: 'OPEN', quotaPerArm: 15, v1Valid: 12, v2Valid: 3,
      linksIssued: 6, linksRedeemed: 2, linksUnused: 3, linksRevoked: 1
    });
    expect(rows[1]).toMatchObject({
      id: 'b', status: 'DRAFT', quotaPerArm: null, v1Valid: 0, v2Valid: 0,
      linksIssued: 0, linksRedeemed: 0, linksUnused: 0, linksRevoked: 0
    });
  });

  it('returns an empty list when there are no runs', async () => {
    const runs = { list: async () => [] } as unknown as StudyRunRepository;
    const links = { listByRun: async () => [] } as unknown as InvitationRepository;
    expect(await new RunOverviewService({ runs, links }).list()).toEqual([]);
  });
});
