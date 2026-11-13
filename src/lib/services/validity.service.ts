import { LEGACY_QUESTIONS_PER_TEST, QUESTIONS_PER_TEST } from '@/lib/questions/question-spec';
import { BREAK_SECONDS } from './break.service';
import { presentationForRound } from '@/lib/experiment/presentation';
import { ScoringService } from './scoring.service';
import type { PresentationProfileDoc } from '@/types/presentation-profile';
import type { BreakDoc, ConsentDoc, ExperimentEventDoc, QuestionSetDoc, ReadingSessionDoc, SessionDoc, TestAttemptDoc } from '@/types/research';
import type { StudyRunDoc } from '@/types/study-run';

export const VALIDITY_CHECKLIST_VERSION = 1;

export type CheckState = 'PASS' | 'FAIL' | 'REVIEW_REQUIRED';
export type ValidityCheck = { code: string; label: string; status: CheckState; reason: string };
export type ValidityBundle = {
  session: SessionDoc;
  consent?: ConsentDoc | null;
  readings: ReadingSessionDoc[];
  tests: TestAttemptDoc[];
  events: ExperimentEventDoc[];
  breakDoc?: BreakDoc | null;
  questions?: QuestionSetDoc | null;
};

export type RunValidityBundle = ValidityBundle & {
  profile?: PresentationProfileDoc | null;
  run?: StudyRunDoc | null;
};

/**
 * MongoDB persists session-level events (e.g. SESSION_STARTED, SESSION_COMPLETED) with `roundNo: null`,
 * whereas in-memory objects may have `roundNo: undefined`. Round 1 and Round 2 events must match 1 or 2 strictly.
 */
function matchesEventRound(eventRound: 1 | 2 | null | undefined, expectedRound?: 1 | 2): boolean {
  return expectedRound === undefined ? eventRound === undefined || eventRound === null : eventRound === expectedRound;
}

/** Audit existing evidence only. Never auto-promote a session to VALID. */
export function checkValidity({ session, consent, readings, tests, events, breakDoc, questions }: ValidityBundle) {
  const checks: ValidityCheck[] = [];
  const add = (code: string, label: string, status: CheckState, reason = '') => checks.push({ code, label, status, reason });
  add('COMPLETION', 'Phiên hoàn thành đủ hai lượt', session.status === 'COMPLETED' && session.currentStage === 'COMPLETED' && !!session.completedAt ? 'PASS' : 'FAIL', 'Trạng thái, bước hoặc mốc hoàn thành không nhất quán.');
  add('CONSENT', 'Chấp thuận tham gia', consent?.decision === 'ACCEPTED' && consent.consentVersion === session.consentVersion && consent.informationVersion === session.informationVersion ? 'PASS' : consent ? 'FAIL' : 'REVIEW_REQUIRED', 'Thiếu hoặc không khớp bản chấp thuận đã khóa.');
  add('ASSIGNMENT', 'Nhóm và bộ nội dung cố định', !!session.groupCode && !!session.assignedPackageId && !!session.assignedPackageRevision && !!session.contentRevisionId && !!session.questionSetId ? 'PASS' : 'REVIEW_REQUIRED', 'Phiên cũ có thể thiếu thông tin gắn revision; cần kiểm tra thủ công.');
  const expected = session.groupCode ? [presentationForRound(session.groupCode, 1), presentationForRound(session.groupCode, 2)] : [];
  const once = <T extends { roundNo: 1 | 2 }>(items: T[]) => items.length === 2 && items.filter(x => x.roundNo === 1).length === 1 && items.filter(x => x.roundNo === 2).length === 1;
  const readingComplete = once(readings) && readings.every(r => r.finishedAt && r.readingSeconds !== null && r.readingSeconds >= 0 && r.presentation === expected[r.roundNo - 1] && r.finishedAt >= r.startedAt);
  add('READING', 'Đủ hai lượt đọc, đúng AB/BA', readingComplete ? 'PASS' : 'FAIL', 'Thiếu, trùng, sai thứ tự hoặc thời gian đọc không hợp lệ.');
  const minimum = session.minimumReadingSeconds;
  add('READING_TIMER', 'Thời gian đọc tối thiểu từng lượt', minimum && readingComplete ? (readings.every(r => (r.readingSeconds ?? 0) >= minimum && (r.finishedAt!.getTime() - r.startedAt.getTime()) / 1000 >= minimum) ? 'PASS' : 'FAIL') : 'REVIEW_REQUIRED', 'Thiếu cấu hình đã khóa hoặc thời gian đọc không đạt tối thiểu.');
  const breaksOK = !!breakDoc?.finishedAt && (breakDoc.finishedAt.getTime() - breakDoc.startedAt.getTime()) / 1000 >= BREAK_SECONDS;
  add('BREAK', 'Nghỉ đúng thời gian bắt buộc', !breakDoc ? 'REVIEW_REQUIRED' : breaksOK ? 'PASS' : 'FAIL', 'Thiếu thời gian nghỉ hoặc nghỉ không đủ.');
  const attemptsComplete = once(tests) && tests.every(t => t.questionSetId?.toString() === session.questionSetId?.toString() && t.presentation === expected[t.roundNo - 1] && t.submittedAt >= t.startedAt && t.answers.length === (questions?.questions.length ?? t.answers.length) && (t.answers.length === LEGACY_QUESTIONS_PER_TEST || t.answers.length === QUESTIONS_PER_TEST) && Number.isInteger(t.score) && t.score >= 0 && t.score <= t.answers.length);
  add('QUIZ', 'Hai bài Quiz, cùng Question Revision và đúng thứ tự', attemptsComplete ? 'PASS' : 'FAIL', 'Thiếu, trùng, sai revision/thứ tự hoặc điểm bất thường.');
  if (!questions) add('SERVER_SCORING', 'Đối chiếu đáp án với revision đã khóa', 'REVIEW_REQUIRED', 'Không truy xuất được Question Set lịch sử.');
  else {
    let correct = attemptsComplete;
    if (correct) {
      try {
        const scorer = new ScoringService();
        correct = tests.every(t => { const scored = scorer.score(questions, t.answers.map(a => ({ questionId: a.questionId, selectedOptionId: a.selectedOptionId })));
          return scored.score === t.score && JSON.stringify(scored.answers) === JSON.stringify(t.answers);
        });
      } catch { correct = false; }
    }
    add('SERVER_SCORING', 'Điểm và đáp án khớp Question Set lịch sử', correct ? 'PASS' : 'FAIL', 'Dữ liệu điểm/câu trả lời không khớp quy tắc chấm trên server.');
  }
  const stages = [1, 2] as const;
  const eventOnce = (type: ExperimentEventDoc['type'], roundNo?: 1 | 2) =>
    events.filter(e => e.type === type && matchesEventRound(e.roundNo, roundNo)).length === 1;
  const logOK = eventOnce('SESSION_STARTED') && eventOnce('SESSION_COMPLETED') && stages.every(round => eventOnce('READING_STARTED', round) && eventOnce('READING_FINISHED', round) && eventOnce('TEST_STARTED', round) && eventOnce('TEST_SUBMITTED', round));
  add('EVENTS', 'Nhật ký các bước bắt buộc', logOK ? 'PASS' : 'REVIEW_REQUIRED', 'Log cũ có thể thiếu; cần đối chiếu theo dấu thời gian.');
  const timeOK = readingComplete && attemptsComplete && breaksOK && !!session.completedAt &&
    stages.every(round => { const r = readings.find(x => x.roundNo === round)!; const t = tests.find(x => x.roundNo === round)!;
      return r.finishedAt! <= t.startedAt && t.submittedAt <= session.completedAt!;
    }) && tests.find(x => x.roundNo === 1)!.submittedAt <= breakDoc!.startedAt && breakDoc!.finishedAt! <= readings.find(x => x.roundNo === 2)!.startedAt;
  add('CHRONOLOGY', 'Thời gian đọc, Quiz, nghỉ và hoàn thành hợp lý', timeOK ? 'PASS' : 'REVIEW_REQUIRED', 'Thiếu mốc hoặc trình tự thời gian bất thường.');
  return { checks, eligible: checks.every(c => c.status === 'PASS'), hasFailure: checks.some(c => c.status === 'FAIL') };
}

/**
 * P4: Evidence checklist for a single-round Study Run session (architecture §4, AC-09, AC-10, AC-11, AC-14, AC-15).
 * Only called when `session.studyRunId` exists. Requires the real StudyRunDoc (`run`) and, for V2, the real locked
 * PresentationProfileDoc (`profile`). Never defaults to PASS when `run` or `profile` is missing.
 */
export function checkRunSessionValidity({
  session,
  consent,
  readings,
  tests,
  events,
  breakDoc,
  questions,
  profile,
  run
}: RunValidityBundle) {
  const checks: ValidityCheck[] = [];
  const add = (code: string, label: string, status: CheckState, reason = '') => checks.push({ code, label, status, reason });

  const completed = Boolean(session.studyRunId) && session.status === 'COMPLETED' && session.currentStage === 'COMPLETED' && Boolean(session.completedAt);
  add('COMPLETION', 'Phiên hoàn thành đủ một lượt', completed ? 'PASS' : 'FAIL', 'Trạng thái, bước hoặc mốc hoàn thành không nhất quán.');

  add(
    'CONSENT',
    'Chấp thuận tham gia',
    consent?.decision === 'ACCEPTED' && consent.consentVersion === session.consentVersion && consent.informationVersion === session.informationVersion
      ? 'PASS'
      : consent
        ? 'FAIL'
        : 'REVIEW_REQUIRED',
    'Thiếu hoặc không khớp bản chấp thuận đã khóa.'
  );

  const variant = session.presentationVariant;
  const validSessionVersion =
    typeof session.presentationVersion === 'number' &&
    Number.isInteger(session.presentationVersion) &&
    session.presentationVersion >= 1;
  const hasSnapshotFields = Boolean(
    session.studyRunId &&
      session.invitationId &&
      session.groupCode === null &&
      (variant === 'V1' || variant === 'V2') &&
      validSessionVersion &&
      session.assignedPackageId &&
      session.assignedPackageCode &&
      session.assignedPackageRevision != null &&
      session.contentRevisionId &&
      session.questionSetId
  );

  // Study Run must exist and match the full immutable snapshot + both V1 and V2 presentation versions.
  const runHasValidPresentation = Boolean(
    run &&
      typeof run.presentation?.V1?.version === 'number' &&
      Number.isInteger(run.presentation.V1.version) &&
      run.presentation.V1.version >= 1 &&
      run.presentation?.V2?.profileId &&
      typeof run.presentation?.V2?.version === 'number' &&
      Number.isInteger(run.presentation.V2.version) &&
      run.presentation.V2.version >= 1
  );
  const runMatches = Boolean(
    run &&
      hasSnapshotFields &&
      runHasValidPresentation &&
      (!run._id || run._id.equals(session.studyRunId!)) &&
      run.snapshot.packageId.equals(session.assignedPackageId!) &&
      run.snapshot.packageCode === session.assignedPackageCode &&
      run.snapshot.packageRevision === session.assignedPackageRevision &&
      run.snapshot.contentRevisionId.equals(session.contentRevisionId) &&
      run.snapshot.questionSetId.equals(session.questionSetId) &&
      (variant === 'V1'
        ? session.presentationVersion === run.presentation.V1.version
        : Boolean(
            session.presentationProfileId &&
              run.presentation.V2.profileId!.equals(session.presentationProfileId) &&
              session.presentationVersion === run.presentation.V2.version
          ))
  );

  // V1 must not have a V2 profile; V2 requires a real LOCKED profile matching id, contentRevisionId, variant and version.
  const profileMatches =
    variant === 'V1'
      ? !session.presentationProfileId && (profile === undefined || profile === null)
      : variant === 'V2'
        ? Boolean(
            session.presentationProfileId &&
              profile &&
              (!profile._id || profile._id.equals(session.presentationProfileId)) &&
              profile.contentRevisionId.equals(session.contentRevisionId) &&
              profile.variant === 'V2' &&
              profile.status === 'LOCKED' &&
              profile.version === session.presentationVersion
          )
        : false;

  add(
    'ASSIGNMENT',
    'Study Run, biến thể và hồ sơ hiển thị cố định',
    hasSnapshotFields && runMatches && profileMatches ? 'PASS' : 'FAIL',
    'Thiếu hoặc sai lệch thông tin Study Run, snapshot gói nội dung, biến thể V1/V2, groupCode hoặc hồ sơ hiển thị.'
  );

  const singleReading = readings.length === 1 && readings[0].roundNo === 1;
  const readingComplete =
    singleReading &&
    validSessionVersion &&
    Boolean(
      readings[0].finishedAt &&
        readings[0].readingSeconds !== null &&
        readings[0].readingSeconds >= 0 &&
        readings[0].presentation === variant &&
        typeof readings[0].presentationVersion === 'number' &&
        Number.isInteger(readings[0].presentationVersion) &&
        readings[0].presentationVersion === session.presentationVersion &&
        readings[0].finishedAt >= readings[0].startedAt
    );
  add('READING', 'Một lượt đọc duy nhất, đúng biến thể', readingComplete ? 'PASS' : 'FAIL', 'Thiếu, dư lượt đọc, sai biến thể/phiên bản hiển thị hoặc thời gian đọc không hợp lệ.');

  const minimum = session.minimumReadingSeconds;
  add(
    'READING_TIMER',
    'Thời gian đọc tối thiểu',
    minimum && readingComplete
      ? (readings[0].readingSeconds ?? 0) >= minimum && (readings[0].finishedAt!.getTime() - readings[0].startedAt.getTime()) / 1000 >= minimum
        ? 'PASS'
        : 'FAIL'
      : 'REVIEW_REQUIRED',
    'Thiếu cấu hình đã khóa hoặc thời gian đọc không đạt tối thiểu.'
  );

  const hasForbiddenEvents = events.some(
    (e) => e.roundNo === 2 || e.type === 'BREAK_STARTED' || e.type === 'BREAK_FINISHED' || e.type === 'GROUP_ASSIGNED'
  );
  const noBreak = !breakDoc && !hasForbiddenEvents;
  add('BREAK', 'Không phát sinh bước nghỉ hoặc lượt 2', noBreak ? 'PASS' : 'FAIL', 'Phiên một lượt không được có bản ghi nghỉ hoặc dữ liệu lượt 2.');

  const singleAttempt = tests.length === 1 && tests[0].roundNo === 1;
  const attemptsComplete =
    singleAttempt &&
    validSessionVersion &&
    Boolean(
      tests[0].questionSetId?.toString() === session.questionSetId?.toString() &&
        tests[0].presentation === variant &&
        typeof tests[0].presentationVersion === 'number' &&
        Number.isInteger(tests[0].presentationVersion) &&
        tests[0].presentationVersion === session.presentationVersion &&
        tests[0].submittedAt >= tests[0].startedAt &&
        (tests[0].answers.length === (questions?.questions.length ?? tests[0].answers.length)) &&
        (tests[0].answers.length === LEGACY_QUESTIONS_PER_TEST || tests[0].answers.length === QUESTIONS_PER_TEST) &&
        Number.isInteger(tests[0].score) &&
        tests[0].score >= 0 &&
        tests[0].score <= tests[0].answers.length
    );
  add('QUIZ', 'Một bài Quiz duy nhất, đúng Question Revision và biến thể', attemptsComplete ? 'PASS' : 'FAIL', 'Thiếu, dư lượt làm bài, sai revision/biến thể/phiên bản hiển thị hoặc điểm bất thường.');

  if (!questions) {
    add('SERVER_SCORING', 'Đối chiếu đáp án với revision đã khóa', 'REVIEW_REQUIRED', 'Không truy xuất được Question Set lịch sử.');
  } else {
    let correct = attemptsComplete;
    if (correct) {
      try {
        const scorer = new ScoringService();
        const scored = scorer.score(
          questions,
          tests[0].answers.map((a) => ({ questionId: a.questionId, selectedOptionId: a.selectedOptionId }))
        );
        correct = scored.score === tests[0].score && JSON.stringify(scored.answers) === JSON.stringify(tests[0].answers);
      } catch {
        correct = false;
      }
    }
    add('SERVER_SCORING', 'Điểm và đáp án khớp Question Set lịch sử', correct ? 'PASS' : 'FAIL', 'Dữ liệu điểm/câu trả lời không khớp quy tắc chấm trên server.');
  }

  const eventOnce = (type: ExperimentEventDoc['type'], roundNo?: 1 | 2) =>
    events.filter((e) => e.type === type && matchesEventRound(e.roundNo, roundNo)).length === 1;
  const requiredEventsOK =
    eventOnce('SESSION_STARTED') &&
    eventOnce('SESSION_COMPLETED') &&
    eventOnce('READING_STARTED', 1) &&
    eventOnce('READING_FINISHED', 1) &&
    eventOnce('TEST_STARTED', 1) &&
    eventOnce('TEST_SUBMITTED', 1);
  add(
    'EVENTS',
    'Nhật ký các bước bắt buộc (một lượt)',
    hasForbiddenEvents ? 'FAIL' : requiredEventsOK ? 'PASS' : 'REVIEW_REQUIRED',
    hasForbiddenEvents ? 'Nhật ký xuất hiện sự kiện nghỉ, gán nhóm A/B hoặc lượt 2.' : 'Thiếu hoặc trùng sự kiện bắt buộc của luồng một lượt.'
  );

  const timeOK =
    readingComplete &&
    attemptsComplete &&
    noBreak &&
    Boolean(session.completedAt) &&
    readings[0].finishedAt! <= tests[0].startedAt &&
    tests[0].submittedAt <= session.completedAt!;
  add('CHRONOLOGY', 'Thời gian đọc, Quiz và hoàn thành hợp lý', timeOK ? 'PASS' : 'REVIEW_REQUIRED', 'Thiếu mốc hoặc trình tự thời gian bất thường.');

  return { checks, eligible: checks.every((c) => c.status === 'PASS'), hasFailure: checks.some((c) => c.status === 'FAIL') };
}
