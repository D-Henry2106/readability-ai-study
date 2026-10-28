import { ResearchRepository } from '@/lib/repositories/research.repository';
import { ReadinessService } from './readiness.service';
import { AuditService } from './audit.service';
import type { AdminRole, ExperimentConfigDoc } from '@/types/research';
import type { z } from 'zod';
import { configSchema } from '@/lib/validation/schemas';

export async function updateResearchConfig(
  input: z.infer<typeof configSchema>,
  actor: { username: string; role: AdminRole },
  repo = new ResearchRepository()
) {
  // Construct the proposed config in memory; never unpublish as a temporary step.
  const previous = await repo.getConfig();
  const proposed: ExperimentConfigDoc = { ...previous, ...input };
  if (proposed.phase === 'MAIN' && proposed.assignmentMode === 'RANDOM' && !proposed.mainRandomApproved) {
    return { status: 409 as const, body: { error: 'Phân công ngẫu nhiên MAIN chưa được phê duyệt.', missing: ['MAIN_RANDOM_NOT_APPROVED'] } };
  }
  if (proposed.studyPublished) {
    const check = await new ReadinessService(repo).check({ ignorePublication: true, configOverride: proposed });
    if (!check.ready) return { status: 409 as const, body: { error: 'Chưa đủ điều kiện để mở nghiên cứu.', missing: check.missing, checks: check.checks } };
  }
  // A single compare-and-swap operation prevents stale simultaneous config updates.
  const saved = await repo.saveConfigIfUnchanged(previous, proposed);
  if (!saved) return { status: 409 as const, body: { error: 'Cấu hình đã thay đổi bởi một yêu cầu khác. Vui lòng tải lại rồi thử lại.', code: 'CONFIG_CONFLICT' } };
  let auditLogged = true;
  try { await new AuditService(repo).record({ username: actor.username, role: actor.role, action: 'EXPERIMENT_CONFIG_UPDATED',
    targetType: 'experiment_config', targetId: 'active',
    metadata: { phase: saved.phase, studyPublished: saved.studyPublished ?? false } }); } catch {
    // After a successful config commit, do not return an erroneous failure response.
    auditLogged = false;
    console.error('Configuration audit entry failed after successful config save.');
  }
  return { status: 200 as const, body: { ok: true, config: saved, auditLogged } };
}
