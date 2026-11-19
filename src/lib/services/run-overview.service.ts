import { StudyRunRepository } from '@/lib/repositories/study-run.repository';
import { InvitationRepository } from '@/lib/repositories/invitation.repository';
import type { StudyRunStatus } from '@/types/study-run';
import type { StudyPhase } from '@/types/research';

/** One row per research run for the admin dashboard: quota progress per variant and how many personal links were made / used / left. */
export interface RunOverviewRow {
  id: string;
  code: string;
  name: string;
  phase: StudyPhase;
  status: StudyRunStatus;
  quotaPerArm: number | null;
  v1Valid: number;
  v2Valid: number;
  linksIssued: number;
  linksRedeemed: number;
  linksUnused: number;
  linksRevoked: number;
}

export interface RunOverviewDeps {
  runs?: Pick<StudyRunRepository, 'list'>;
  links?: Pick<InvitationRepository, 'listByRun'>;
}

/** Read-only summary for the admin dashboard. It never changes a run, a link or a session. */
export class RunOverviewService {
  private readonly runs: NonNullable<RunOverviewDeps['runs']>;
  private readonly links: NonNullable<RunOverviewDeps['links']>;

  constructor(deps: RunOverviewDeps = {}) {
    this.runs = deps.runs ?? new StudyRunRepository();
    this.links = deps.links ?? new InvitationRepository();
  }

  async list(): Promise<RunOverviewRow[]> {
    const runs = await this.runs.list();
    return Promise.all(runs.map(async (run) => {
      const all = await this.links.listByRun(run._id!);
      const redeemed = all.filter((l) => l.status === 'REDEEMED').length;
      const revoked = all.filter((l) => l.status === 'REVOKED').length;
      return {
        id: run._id!.toHexString(),
        code: run.code,
        name: run.name,
        phase: run.phase,
        status: run.status,
        quotaPerArm: run.quotaPerArm,
        v1Valid: run.arms?.V1?.validIncluded ?? 0,
        v2Valid: run.arms?.V2?.validIncluded ?? 0,
        linksIssued: all.length,
        linksRedeemed: redeemed,
        linksUnused: all.length - redeemed - revoked,
        linksRevoked: revoked
      };
    }));
  }
}
