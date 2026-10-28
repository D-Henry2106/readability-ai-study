import { ResearchRepository } from '@/lib/repositories/research.repository';
import { AuditService } from './audit.service';
import { checkValidity } from './validity.service';
import type { AdminRole, ValidityFlag } from '@/types/research';

export const VALIDITY_CHECKLIST_VERSION = 1;

export type ValidityReviewResult =
  | { status: 404 | 409; body: { error: string; checks?: ReturnType<typeof checkValidity>['checks'] } }
  | { status: 200; body: { ok: true; checks: ReturnType<typeof checkValidity>['checks']; auditLogged: boolean } };

/** The only backend path allowed to change a session's validity decision. */
export async function reviewSessionValidity(
  id: string,
  input: { validityFlag: ValidityFlag; reason: string | null },
  reviewer: { username: string; role: AdminRole },
  repo = new ResearchRepository()
): Promise<ValidityReviewResult> {
  const bundle = await repo.getSessionBundle(id);
  if (!bundle.session) return { status: 404, body: { error: 'Không tìm thấy phiên.' } };
  if (bundle.session.status !== 'COMPLETED') return { status: 409, body: { error: 'Chỉ xét phiên đã hoàn thành.' } };
  const questions = await repo.getQuestionSetById(bundle.session.questionSetId);
  const validity = checkValidity({ ...bundle, session: bundle.session, questions });
  if (input.validityFlag === 'VALID' && !validity.eligible) {
    return { status: 409, body: { error: 'Checklist chưa đạt tất cả điều kiện PASS.', checks: validity.checks } };
  }
  const previousFlag = bundle.session.validityFlag;
  const checklistVersion = input.validityFlag === 'VALID' ? VALIDITY_CHECKLIST_VERSION : null;
  const updated = await repo.setValidity(id, input.validityFlag, input.reason, reviewer.username, checklistVersion);
  if (!updated) return { status: 409, body: { error: 'Phiên không còn hợp lệ để xét.' } };
  // An embedded history record is committed in the same MongoDB update as the decision.
  let auditLogged = true;
  try { await new AuditService(repo).record({
    username: reviewer.username, role: reviewer.role, action: 'VALIDITY_CHANGED',
    targetType: 'session', targetId: id,
    metadata: { previousFlag, validityFlag: input.validityFlag, reason: input.reason,
      allChecksPass: validity.eligible, checklistVersion: checklistVersion ?? 0 }
  }); } catch {
    // The atomic embedded validityHistory remains the primary durable audit trail.
    auditLogged = false;
    console.error('Validity audit mirror could not be written; embedded history was retained.');
  }
  return { status: 200, body: { ok: true, checks: validity.checks, auditLogged } };
}
