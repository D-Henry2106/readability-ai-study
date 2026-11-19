import { ResearchRepository } from '@/lib/repositories/research.repository';
import { presentationForRound } from '@/lib/experiment/presentation';
import { pairedEvidence } from './paired-eligibility';
import type { StudyPhase } from '@/types/research';
import type { ResearchFilters } from './research-filters';

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw = value instanceof Date ? value.toISOString() : String(value);
  // Prevent spreadsheet formula injection when CSV is opened in Excel/Sheets.
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

function line(values: unknown[]): string {
  return values.map(csvCell).join(',');
}

export class ExportService {
  constructor(private readonly repo = new ResearchRepository()) {}

  async paired(phase?: StudyPhase, filters: ResearchFilters = {}): Promise<string> {
    const dataset = await this.repo.analysisDataset(phase, true, filters);
    const rows = [line(['session_id','phase','group','package_id','package_code','package_revision','package_topic','content_revision_id','question_set_id',
      'v1_score','v2_score','v2_minus_v1','v1_reading_seconds','v2_reading_seconds','completed_at'])];
    for (const session of dataset.sessions) {
      const pair = pairedEvidence(session, dataset.tests.filter(t => t.sessionId === session.id), dataset.readings.filter(r => r.sessionId === session.id));
      if (!pair) continue;
      rows.push(line([session.id, session.phase, session.groupCode, session.assignedPackageId?.toString(), session.assignedPackageCode, session.assignedPackageRevision, session.assignedPackageTopic, session.contentRevisionId.toString(), session.questionSetId.toString(),
        pair.v1.score, pair.v2.score, pair.difference, pair.v1Reading.readingSeconds, pair.v2Reading.readingSeconds, session.completedAt]));
    }
    return rows.join('\n');
  }

  async questions(phase?: StudyPhase, filters: ResearchFilters = {}): Promise<string> {
    const dataset = await this.repo.analysisDataset(phase, false, filters);
    const byId = new Map(dataset.sessions.map((s) => [s.id, s]));
    const rows = [line(['session_id','phase','group','package_id','package_code','package_revision','package_topic','status','validity','round_no','presentation','question_set_id','question_id','selected_option_id','is_correct','score','score_max','submitted_at'])];
    for (const test of dataset.tests) {
      const session = byId.get(test.sessionId);
      if (!session) continue;
      for (const answer of test.answers) rows.push(line([
        test.sessionId, session.phase, session.groupCode, session.assignedPackageId?.toString(), session.assignedPackageCode, session.assignedPackageRevision, session.assignedPackageTopic, session.status, session.validityFlag,
        test.roundNo, test.presentation, test.questionSetId.toString(), answer.questionId,
        answer.selectedOptionId, answer.isCorrect, test.score, test.answers.length, test.submittedAt
      ]));
    }
    return rows.join('\n');
  }

  /**
   * P5: one row per Study Run participant (single-round design). Filter with `variant` to get the V1 file and the V2 file separately;
   * the variant is the invitation's, copied onto the session at redeem time. Legacy two-round sessions have no studyRunId and are skipped.
   * The score is out of `score_max` (the attempt's own question count: 15 for P5 question sets, 5 for older data).
   */
  async run(phase?: StudyPhase, filters: ResearchFilters = {}): Promise<string> {
    const sessions = (await this.repo.listAllSessionsForExport(phase, filters)).filter((s) => s.studyRunId);
    const rows = [line(['session_id','participant_id','invitation_id','study_run_id','variant','presentation_version','question_set_id','question_set_revision',
      'package_code','package_revision','status','validity','device','gender','field_of_study','year_of_study','ai_usage_frequency','online_reading_frequency',
      'reading_seconds','scroll_count','max_scroll_depth_percent','score','score_max','answers','created_at','completed_at',
      'content_revision_id','source_hash','read_start','read_end','test_started_at','test_submitted_at'])];
    const sourceHashByContent = new Map<string, string | null>();
    for (const session of sessions) {
      const bundle = await this.repo.getSessionBundle(session.id);
      const reading = bundle.readings.find((r) => r.roundNo === 1);
      const test = bundle.tests.find((t) => t.roundNo === 1);
      // Hash of the original (V1) text, so every row can be traced to the exact source it was shown.
      const contentId = session.contentRevisionId ? session.contentRevisionId.toString() : null;
      if (contentId && !sourceHashByContent.has(contentId)) sourceHashByContent.set(contentId, (await this.repo.getContentById(session.contentRevisionId))?.contentHash ?? null);
      const sourceHash = contentId ? sourceHashByContent.get(contentId) ?? null : null;
      rows.push(line([session.id, session.participantId, session.invitationId?.toHexString(), session.studyRunId?.toHexString(), session.presentationVariant, session.presentationVersion,
        session.questionSetId.toHexString(), session.questionSetRevision, session.assignedPackageCode, session.assignedPackageRevision, session.status, session.validityFlag, session.deviceType,
        bundle.demographics?.gender, bundle.demographics?.fieldOfStudy, bundle.demographics?.yearOfStudy, bundle.demographics?.aiUsageFrequency, bundle.demographics?.onlineReadingFrequency,
        reading?.readingSeconds, reading?.scrollCount, reading?.maxScrollDepthPercent, test?.score, test?.answers.length,
        test ? JSON.stringify(test.answers.map((a) => ({ questionId: a.questionId, selectedOptionId: a.selectedOptionId, isCorrect: a.isCorrect }))) : null,
        session.createdAt, session.completedAt,
        contentId, sourceHash, reading?.startedAt, reading?.finishedAt, test?.startedAt, test?.submittedAt]));
    }
    return rows.join('\n');
  }

  async events(phase?: StudyPhase, filters: ResearchFilters = {}): Promise<string> {
    const [events, sessions] = await Promise.all([this.repo.listEventData(phase, filters), this.repo.listAllSessionsForExport(phase, filters)]);
    const byId = new Map(sessions.map(s => [s.id, s]));
    const rows = [line(['session_id','package_id','package_code','package_revision','package_topic','event_id','event_type','round_no','stage','server_timestamp','participant_id','invitation_id','variant'])];
    for (const e of events) { const s = byId.get(e.sessionId);
      rows.push(line([e.sessionId, s?.assignedPackageId?.toString(), s?.assignedPackageCode, s?.assignedPackageRevision, s?.assignedPackageTopic, e._id?.toString(), e.type, e.roundNo, e.stage, e.createdAt, s?.participantId, s?.invitationId?.toHexString(), s?.presentationVariant]));
    }
    return rows.join('\n');
  }

  async wide(phase?: StudyPhase, filters: ResearchFilters = {}): Promise<string> {
    const sessions = await this.repo.listAllSessionsForExport(phase, filters);
    const header = [
      'session_id','phase','group','device','gender','field_of_study','year_of_study','ai_usage_frequency','online_reading_frequency',
      'package_id','package_code','package_revision','package_topic','content_revision_id','question_set_id','round1_presentation','round2_presentation','v1_score','v2_score','v2_minus_v1',
      'v1_reading_seconds','v2_reading_seconds','v1_scroll_count','v2_scroll_count','v1_max_scroll_depth_percent','v2_max_scroll_depth_percent',
      'completed','status','validity','validity_reason','created_at','completed_at','answers_round1','answers_round2'
    ];
    const rows = [line(header)];
    for (const session of sessions) {
      const bundle = await this.repo.getSessionBundle(session.id);
      const r1 = bundle.readings.find((r) => r.roundNo === 1);
      const r2 = bundle.readings.find((r) => r.roundNo === 2);
      const t1 = bundle.tests.find((t) => t.roundNo === 1);
      const t2 = bundle.tests.find((t) => t.roundNo === 2);
      const presentations = session.groupCode ? [presentationForRound(session.groupCode, 1), presentationForRound(session.groupCode, 2)] : [null, null];
      const v1Test = [t1, t2].find((t) => t?.presentation === 'V1');
      const v2Test = [t1, t2].find((t) => t?.presentation === 'V2');
      const v1Reading = [r1, r2].find((r) => r?.presentation === 'V1');
      const v2Reading = [r1, r2].find((r) => r?.presentation === 'V2');
      rows.push(line([
        session.id, session.phase, session.groupCode, session.deviceType,
        bundle.demographics?.gender, bundle.demographics?.fieldOfStudy, bundle.demographics?.yearOfStudy,
        bundle.demographics?.aiUsageFrequency, bundle.demographics?.onlineReadingFrequency,
        session.assignedPackageId?.toString(), session.assignedPackageCode, session.assignedPackageRevision, session.assignedPackageTopic, session.contentRevisionId.toHexString(), session.questionSetId.toHexString(), presentations[0], presentations[1],
        v1Test?.score, v2Test?.score, v1Test && v2Test ? v2Test.score - v1Test.score : null,
        v1Reading?.readingSeconds, v2Reading?.readingSeconds, v1Reading?.scrollCount, v2Reading?.scrollCount,
        v1Reading?.maxScrollDepthPercent, v2Reading?.maxScrollDepthPercent,
        session.status === 'COMPLETED', session.status, session.validityFlag, session.validityReason, session.createdAt, session.completedAt,
        t1 ? JSON.stringify(t1.answers.map((a) => ({ questionId: a.questionId, selectedOptionId: a.selectedOptionId }))) : null,
        t2 ? JSON.stringify(t2.answers.map((a) => ({ questionId: a.questionId, selectedOptionId: a.selectedOptionId }))) : null
      ]));
    }
    return rows.join('\n');
  }

  async long(phase?: StudyPhase, filters: ResearchFilters = {}): Promise<string> {
    const sessions = await this.repo.listAllSessionsForExport(phase, filters);
    const rows = [line(['session_id','package_id','package_code','package_revision','package_topic','group','round_no','presentation','score','reading_seconds','scroll_count','max_scroll_depth_percent'])];
    for (const session of sessions) {
      const bundle = await this.repo.getSessionBundle(session.id);
      for (const roundNo of [1, 2] as const) {
        const reading = bundle.readings.find((r) => r.roundNo === roundNo);
        const test = bundle.tests.find((t) => t.roundNo === roundNo);
        rows.push(line([session.id, session.assignedPackageId?.toString(), session.assignedPackageCode, session.assignedPackageRevision, session.assignedPackageTopic, session.groupCode, roundNo, reading?.presentation ?? test?.presentation, test?.score, reading?.readingSeconds, reading?.scrollCount, reading?.maxScrollDepthPercent]));
      }
    }
    return rows.join('\n');
  }
}
