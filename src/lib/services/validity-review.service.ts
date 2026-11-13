import { PresentationProfileRepository } from '@/lib/repositories/presentation-profile.repository';
import { ZodError } from 'zod';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { StudyRunRepository, type StudyRunStore } from '@/lib/repositories/study-run.repository';
import { AuditService } from './audit.service';
import { StudyRunQuotaService } from './study-run-quota.service';
import { checkRunSessionValidity, checkValidity, VALIDITY_CHECKLIST_VERSION } from './validity.service';
import { assertRole } from '@/lib/auth/roles';
import { StudyRunError } from '@/lib/study-run/errors';
import type { QuotaWarningCode } from '@/lib/study-run/quota';
import type { AdminRole, QuotaStatus, ValidityFlag } from '@/types/research';

export { VALIDITY_CHECKLIST_VERSION };

export type ValidityReviewResult =
  | { status: 400 | 404 | 409; body: { error: string; checks?: ReturnType<typeof checkValidity>['checks'] } }
  | {
      status: 200;
      body: {
        ok: true;
        checks: ReturnType<typeof checkValidity>['checks'];
        auditLogged: boolean;
        quotaStatus?: QuotaStatus;
        warnings?: QuotaWarningCode[];
      };
    };

function domainConflictMessage(code: string): string {
  switch (code) {
    case 'STUDY_RUN_QUOTA_NOT_CONFIRMED':
      return 'Chỉ tiêu mỗi nhánh của đợt nghiên cứu chưa được xác nhận.';
    case 'SESSION_VALIDITY_NOT_ELIGIBLE':
      return 'Checklist chưa đạt tất cả điều kiện PASS.';
    case 'SESSION_NOT_COMPLETED':
      return 'Chỉ xét phiên đã hoàn thành.';
    case 'SESSION_NOT_IN_STUDY_RUN':
      return 'Phiên không thuộc đợt nghiên cứu.';
    case 'STUDY_RUN_QUOTA_TRANSITION_PENDING':
      return 'Phiên đang có cập nhật chỉ tiêu chưa hoàn tất. Vui lòng thử lại.';
    case 'STUDY_RUN_QUOTA_AUDIT_PENDING':
      return 'Nhật ký của lần cập nhật chỉ tiêu trước chưa được ghi. Vui lòng thử lại.';
    default:
      return 'Phiên không còn hợp lệ để xét hoặc đang có xung đột cập nhật chỉ tiêu.';
  }
}

/** The only backend path allowed to change a session's validity decision. */
export async function reviewSessionValidity(
  id: string,
  input: { validityFlag: ValidityFlag; reason: string | null },
  reviewer: { username: string; role: AdminRole },
  repo = new ResearchRepository(),
  deps: {
    profiles?: Pick<PresentationProfileRepository, 'getById'>;
    runs?: Pick<StudyRunStore, 'getById' | 'applyQuotaCounterTransition'>;
  } = {}
): Promise<ValidityReviewResult> {
  assertRole(reviewer, ['RESEARCHER']);
  const bundle = await repo.getSessionBundle(id);
  if (!bundle.session) return { status: 404, body: { error: 'Không tìm thấy phiên.' } };
  if (bundle.session.status !== 'COMPLETED') return { status: 409, body: { error: 'Chỉ xét phiên đã hoàn thành.' } };
  const questions = await repo.getQuestionSetById(bundle.session.questionSetId);

  if (bundle.session.studyRunId) {
    const runRepo = deps.runs ?? new StudyRunRepository();
    const profileRepo = deps.profiles ?? new PresentationProfileRepository();
    const [run, profile] = await Promise.all([
      runRepo.getById(bundle.session.studyRunId),
      bundle.session.presentationProfileId
        ? profileRepo.getById(bundle.session.presentationProfileId)
        : Promise.resolve(bundle.session.presentationVariant === 'V2' ? null : undefined)
    ]);

    const validity = checkRunSessionValidity({ ...bundle, session: bundle.session, questions, run, profile });
    if (input.validityFlag === 'VALID' && !validity.eligible) {
      return { status: 409, body: { error: 'Checklist chưa đạt tất cả điều kiện PASS.', checks: validity.checks } };
    }
    try {
      const quotaService = new StudyRunQuotaService({
        runs: runRepo,
        sessions: repo,
        audit: new AuditService(repo)
      });
      const result = await quotaService.recordValidity(reviewer, id, input, { checklistEligible: validity.eligible });
      return {
        status: 200,
        body: {
          ok: true,
          checks: validity.checks,
          auditLogged: result.auditLogged,
          quotaStatus: result.quotaStatus,
          warnings: result.warnings
        }
      };
    } catch (error) {
      if (error instanceof ZodError) {
        return { status: 400, body: { error: 'Dữ liệu gửi lên không hợp lệ.' } };
      }
      if (error instanceof StudyRunError) {
        if (error.status === 400) return { status: 400, body: { error: 'Dữ liệu gửi lên không hợp lệ.' } };
        if (error.status === 404) return { status: 404, body: { error: 'Không tìm thấy phiên hoặc đợt nghiên cứu.' } };
        if (error.status === 409) return { status: 409, body: { error: domainConflictMessage(error.code) } };
      }
      throw error;
    }
  }

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
