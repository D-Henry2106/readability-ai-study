import { ResearchRepository, type VariantLockStore } from '@/lib/repositories/research.repository';
import { assertRole } from '@/lib/auth/roles';
import { AuditService } from './audit.service';
import type { AdminRole, Presentation, VariantLock } from '@/types/research';

export interface VariantLockActor { username: string; role: AdminRole }

/**
 * P5-D: independent intake lock for each variant (V1 / V2). A locked variant issues no new invitation and redeems no unused
 * invitation (enforced in InvitationService.issue and InvitationRedemptionService.redeemIssued, i.e. on the backend).
 * It deletes nothing and never blocks a participant who already started: resume, recovery and test submit do not read it.
 * Every change records who and when in the existing admin audit log.
 */
export class VariantLockService {
  constructor(
    private readonly store: VariantLockStore = new ResearchRepository(),
    private readonly audit: Pick<AuditService, 'record'> = new AuditService(),
    private readonly now: () => Date = () => new Date()
  ) {}

  async list(actor: VariantLockActor): Promise<Record<Presentation, VariantLock>> {
    assertRole(actor, ['RESEARCHER', 'SUPERVISOR']);
    return this.store.getVariantLocks();
  }

  async set(actor: VariantLockActor, variant: Presentation, locked: boolean): Promise<{ locks: Record<Presentation, VariantLock>; auditLogged: boolean }> {
    assertRole(actor, ['RESEARCHER']);
    const at = this.now();
    await this.store.setVariantLock(variant, locked, actor.username, at);
    let auditLogged = true;
    try {
      await this.audit.record({
        username: actor.username, role: actor.role, action: locked ? 'VARIANT_LOCKED' : 'VARIANT_UNLOCKED',
        targetType: 'variant', targetId: variant, metadata: { variant, locked, changedAt: at.toISOString() }
      });
    } catch {
      auditLogged = false;
      console.error('Variant lock audit entry failed after a successful write.');
    }
    return { locks: await this.store.getVariantLocks(), auditLogged };
  }
}
