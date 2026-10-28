import { BREAK_SECONDS } from './break.service';
import { presentationForRound } from '@/lib/experiment/presentation';
import { ScoringService } from './scoring.service';
import type { BreakDoc, ConsentDoc, ExperimentEventDoc, QuestionSetDoc, ReadingSessionDoc, SessionDoc, TestAttemptDoc } from '@/types/research';

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
  const attemptsComplete = once(tests) && tests.every(t => t.questionSetId?.toString() === session.questionSetId?.toString() && t.presentation === expected[t.roundNo - 1] && t.submittedAt >= t.startedAt && t.answers.length === 5 && Number.isInteger(t.score) && t.score >= 0 && t.score <= 5);
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
  const eventOnce = (type: ExperimentEventDoc['type'], roundNo?: 1 | 2) => events.filter(e => e.type === type && e.roundNo === roundNo).length === 1;
  const logOK = eventOnce('SESSION_STARTED') && eventOnce('SESSION_COMPLETED') && stages.every(round => eventOnce('READING_STARTED', round) && eventOnce('READING_FINISHED', round) && eventOnce('TEST_STARTED', round) && eventOnce('TEST_SUBMITTED', round));
  add('EVENTS', 'Nhật ký các bước bắt buộc', logOK ? 'PASS' : 'REVIEW_REQUIRED', 'Log cũ có thể thiếu; cần đối chiếu theo dấu thời gian.');
  const timeOK = readingComplete && attemptsComplete && breaksOK && !!session.completedAt &&
    stages.every(round => { const r = readings.find(x => x.roundNo === round)!; const t = tests.find(x => x.roundNo === round)!;
      return r.finishedAt! <= t.startedAt && t.submittedAt <= session.completedAt!;
    }) && tests.find(x => x.roundNo === 1)!.submittedAt <= breakDoc!.startedAt && breakDoc!.finishedAt! <= readings.find(x => x.roundNo === 2)!.startedAt;
  add('CHRONOLOGY', 'Thời gian đọc, Quiz, nghỉ và hoàn thành hợp lý', timeOK ? 'PASS' : 'REVIEW_REQUIRED', 'Thiếu mốc hoặc trình tự thời gian bất thường.');
  return { checks, eligible: checks.every(c => c.status === 'PASS'), hasFailure: checks.some(c => c.status === 'FAIL') };
}
