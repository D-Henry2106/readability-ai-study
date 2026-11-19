import { LEGACY_QUESTIONS_PER_TEST } from '@/lib/questions/question-spec';
import { pairedEvidence } from './paired-eligibility';
import { ResearchRepository, type SessionExportFilters } from '@/lib/repositories/research.repository';
import type { GroupCode, QuestionSetDoc, ReadingSessionDoc, SessionDoc, StudyPhase, TestAttemptDoc } from '@/types/research';

export function descriptive(values: number[]) {
  if (!values.length) return { count: 0, mean: null, median: null, standardDeviation: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const standardDeviation =
    values.length > 1
      ? Math.sqrt(values.reduce((sum, n) => sum + (n - mean) ** 2, 0) / (values.length - 1))
      : null;
  return { count: values.length, mean, median, standardDeviation };
}

export type AnalysisDataset = {
  sessions: SessionDoc[];
  tests: TestAttemptDoc[];
  readings: ReadingSessionDoc[];
};

export interface VariantArmSummary {
  variant: 'V1' | 'V2';
  label: string;
  totalParticipants: number;
  completed: number;
  active: number;
  withdrawn: number;
  incomplete: number;
  valid: number;
  pendingReview: number;
  invalid: number;
  completionRate: number;
  scoreStats: ReturnType<typeof descriptive>;
  readingTimeStats: ReturnType<typeof descriptive>;
  quizTimeStats: ReturnType<typeof descriptive>;
  totalTimeStats: ReturnType<typeof descriptive>;
  overallAccuracy: number;
  scoreDistribution: number[];
}

export interface QuestionAccuracyComparison {
  questionId: string;
  prompt: string;
  category: string;
  v1Correct: number;
  v1Total: number;
  v1Accuracy: number;
  v2Correct: number;
  v2Total: number;
  v2Accuracy: number;
  diffAccuracy: number;
}

export interface VariantComparisonSummary {
  v1: VariantArmSummary;
  v2: VariantArmSummary;
  diffMeanScore: number | null;
  diffCompletionRate: number;
  diffOverallAccuracy: number;
  diffMeanReadingTime: number | null;
  diffMeanQuizTime: number | null;
  diffMeanTotalTime: number | null;
  scoreMax: number;
  questions: QuestionAccuracyComparison[];
  totalSessions: number;
  completedSessions: number;
  validSessions: number;
}

/** Summarizes V1 vs V2 between-subjects variant sessions. */
export function summarizeVariants(
  { sessions, tests, readings }: AnalysisDataset,
  questionSet?: QuestionSetDoc | null
): VariantComparisonSummary {
  const bySessionTest = new Map<string, TestAttemptDoc>();
  for (const t of tests) {
    if (t.roundNo === 1 || !bySessionTest.has(t.sessionId)) {
      bySessionTest.set(t.sessionId, t);
    }
  }
  const bySessionReading = new Map<string, ReadingSessionDoc>();
  for (const r of readings) {
    if (r.roundNo === 1 || !bySessionReading.has(r.sessionId)) {
      bySessionReading.set(r.sessionId, r);
    }
  }

  const variantSessions = sessions.filter((s) => s.presentationVariant === 'V1' || s.presentationVariant === 'V2');

  function analyzeArm(variant: 'V1' | 'V2'): VariantArmSummary {
    const armSessions = variantSessions.filter((s) => s.presentationVariant === variant);
    const totalParticipants = armSessions.length;
    const completed = armSessions.filter((s) => s.status === 'COMPLETED').length;
    const active = armSessions.filter((s) => s.status === 'ACTIVE').length;
    const withdrawn = armSessions.filter((s) => s.status === 'WITHDRAWN').length;
    const incomplete = armSessions.filter((s) => s.status === 'INCOMPLETE' || s.status === 'DECLINED').length;
    const valid = armSessions.filter((s) => s.status === 'COMPLETED' && s.validityFlag === 'VALID').length;
    const pendingReview = armSessions.filter((s) => s.status === 'COMPLETED' && s.validityFlag === 'REVIEW_REQUIRED').length;
    const invalid = armSessions.filter((s) => s.status === 'COMPLETED' && s.validityFlag === 'INVALID').length;
    const completionRate = totalParticipants > 0 ? (completed / totalParticipants) * 100 : 0;

    const completedArmSessions = armSessions.filter((s) => s.status === 'COMPLETED');
    const scores: number[] = [];
    const readingTimes: number[] = [];
    const quizTimes: number[] = [];
    const totalTimes: number[] = [];
    let totalCorrectAnswers = 0;
    let totalAnswersGiven = 0;

    for (const session of completedArmSessions) {
      const sessionId = session.id || (session as unknown as { sessionId?: string }).sessionId || session._id?.toHexString() || '';
      const test = bySessionTest.get(sessionId);
      const reading = bySessionReading.get(sessionId);

      if (test) {
        scores.push(test.score);
        const quizElapsed = test.submittedAt && test.startedAt ? (test.submittedAt.getTime() - test.startedAt.getTime()) / 1000 : null;
        if (quizElapsed !== null && quizElapsed >= 0) quizTimes.push(quizElapsed);

        for (const ans of test.answers) {
          totalAnswersGiven += 1;
          if (ans.isCorrect === true) totalCorrectAnswers += 1;
        }
      }

      const readingSec = reading?.readingSeconds ?? (reading as unknown as { durationSeconds?: number })?.durationSeconds ?? null;
      if (readingSec !== null && readingSec >= 0) {
        readingTimes.push(readingSec);
      }

      if (test && readingSec !== null) {
        const quizElapsed = test.submittedAt && test.startedAt ? (test.submittedAt.getTime() - test.startedAt.getTime()) / 1000 : null;
        if (quizElapsed !== null && quizElapsed >= 0) {
          totalTimes.push(readingSec + quizElapsed);
        }
      }
    }

    const scoreStats = descriptive(scores);
    const readingTimeStats = descriptive(readingTimes);
    const quizTimeStats = descriptive(quizTimes);
    const totalTimeStats = descriptive(totalTimes);
    const overallAccuracy = totalAnswersGiven > 0 ? (totalCorrectAnswers / totalAnswersGiven) * 100 : 0;
    const scoreDistribution = Array.from({ length: 16 }, (_, i) => scores.filter((sc) => sc === i).length);

    return {
      variant,
      label: variant === 'V1' ? 'V1 — Standard AI Output' : 'V2 — Accessible AI Output',
      totalParticipants,
      completed,
      active,
      withdrawn,
      incomplete,
      valid,
      pendingReview,
      invalid,
      completionRate,
      scoreStats,
      readingTimeStats,
      quizTimeStats,
      totalTimeStats,
      overallAccuracy,
      scoreDistribution
    };
  }

  const v1 = analyzeArm('V1');
  const v2 = analyzeArm('V2');

  const questionMap = new Map<string, { prompt: string; category: string }>();
  if (questionSet?.questions) {
    for (const q of questionSet.questions) {
      questionMap.set(q.id, { prompt: q.prompt, category: q.category ?? 'CHUNG' });
    }
  }

  for (const t of tests) {
    for (const ans of t.answers) {
      if (!questionMap.has(ans.questionId)) {
        questionMap.set(ans.questionId, { prompt: `Câu hỏi ${ans.questionId}`, category: 'CHUNG' });
      }
    }
  }

  const questionStatsMap = new Map<string, { v1Correct: number; v1Total: number; v2Correct: number; v2Total: number }>();
  for (const qId of questionMap.keys()) {
    questionStatsMap.set(qId, { v1Correct: 0, v1Total: 0, v2Correct: 0, v2Total: 0 });
  }

  for (const session of variantSessions.filter((s) => s.status === 'COMPLETED')) {
    const sessionId = session.id || (session as unknown as { sessionId?: string }).sessionId || session._id?.toHexString() || '';
    const test = bySessionTest.get(sessionId);
    if (!test) continue;
    const isV1 = session.presentationVariant === 'V1';
    for (const ans of test.answers) {
      const stat = questionStatsMap.get(ans.questionId) ?? { v1Correct: 0, v1Total: 0, v2Correct: 0, v2Total: 0 };
      if (isV1) {
        stat.v1Total += 1;
        if (ans.isCorrect === true) stat.v1Correct += 1;
      } else {
        stat.v2Total += 1;
        if (ans.isCorrect === true) stat.v2Correct += 1;
      }
      questionStatsMap.set(ans.questionId, stat);
    }
  }

  const questions: QuestionAccuracyComparison[] = [];
  for (const [qId, meta] of questionMap.entries()) {
    const stat = questionStatsMap.get(qId) ?? { v1Correct: 0, v1Total: 0, v2Correct: 0, v2Total: 0 };
    const v1Accuracy = stat.v1Total > 0 ? (stat.v1Correct / stat.v1Total) * 100 : 0;
    const v2Accuracy = stat.v2Total > 0 ? (stat.v2Correct / stat.v2Total) * 100 : 0;
    questions.push({
      questionId: qId,
      prompt: meta.prompt,
      category: meta.category,
      v1Correct: stat.v1Correct,
      v1Total: stat.v1Total,
      v1Accuracy,
      v2Correct: stat.v2Correct,
      v2Total: stat.v2Total,
      v2Accuracy,
      diffAccuracy: v2Accuracy - v1Accuracy
    });
  }

  const diffMeanScore = (v2.scoreStats.mean !== null && v1.scoreStats.mean !== null) ? v2.scoreStats.mean - v1.scoreStats.mean : null;
  const diffMeanReadingTime = (v2.readingTimeStats.mean !== null && v1.readingTimeStats.mean !== null) ? v2.readingTimeStats.mean - v1.readingTimeStats.mean : null;
  const diffMeanQuizTime = (v2.quizTimeStats.mean !== null && v1.quizTimeStats.mean !== null) ? v2.quizTimeStats.mean - v1.quizTimeStats.mean : null;
  const diffMeanTotalTime = (v2.totalTimeStats.mean !== null && v1.totalTimeStats.mean !== null) ? v2.totalTimeStats.mean - v1.totalTimeStats.mean : null;

  return {
    v1,
    v2,
    diffMeanScore,
    diffCompletionRate: v2.completionRate - v1.completionRate,
    diffOverallAccuracy: v2.overallAccuracy - v1.overallAccuracy,
    diffMeanReadingTime,
    diffMeanQuizTime,
    diffMeanTotalTime,
    scoreMax: 15,
    questions,
    totalSessions: variantSessions.length,
    completedSessions: variantSessions.filter((s) => s.status === 'COMPLETED').length,
    validSessions: variantSessions.filter((s) => s.status === 'COMPLETED' && s.validityFlag === 'VALID').length
  };
}

/** Only completed sessions with explicitly VALID quality review and both rounds enter analysis. */
export function summarizePairs({ sessions, tests, readings }: AnalysisDataset) {
  const bySession = new Map<string, TestAttemptDoc[]>();
  for (const t of tests) bySession.set(t.sessionId, [...(bySession.get(t.sessionId) ?? []), t]);
  const readingBySession = new Map<string, ReadingSessionDoc[]>();
  for (const r of readings)
    readingBySession.set(r.sessionId, [...(readingBySession.get(r.sessionId) ?? []), r]);
  const pairs: Array<{
    v1: number;
    v2: number;
    difference: number;
    group: string;
    cohort: string;
  }> = [];
  const readingTimes: number[] = [];
  const quizTimes: number[] = [];
  const questionCounts = new Map<
    string,
    { correct: number; answered: number; total: number; presentation: string }
  >();
  let completedPairs = 0;
  let scoreMax = 0;
  for (const session of sessions) {
    if (session.status !== 'COMPLETED') continue;
    const ts = bySession.get(session.id) ?? [];
    const rs = readingBySession.get(session.id) ?? [];
    const pair = pairedEvidence(session, ts, rs);
    // Completed structural pairs (including Pending Review) are not labelled excluded.
    const structurallyComplete = pairedEvidence({ ...session, validityFlag: 'VALID', validityChecklistVersion: 1 }, ts, rs);
    if (structurallyComplete) completedPairs += 1;
    if (!pair) continue;
    pairs.push({ v1: pair.v1.score, v2: pair.v2.score, difference: pair.difference,
      group: session.groupCode!, cohort: pair.cohort });
    for (const r of rs) if (r.readingSeconds !== null) readingTimes.push(r.readingSeconds);
    for (const t of ts) {
      const elapsed = (t.submittedAt.getTime() - t.startedAt.getTime()) / 1000;
      if (elapsed >= 0) quizTimes.push(elapsed);
      scoreMax = Math.max(scoreMax, t.answers.length);
      for (const answer of t.answers) {
        const key = `${t.presentation}:${answer.questionId}`;
        const c = questionCounts.get(key) ?? {
          correct: 0,
          answered: 0,
          total: 0,
          presentation: t.presentation
        };
        c.total += 1;
        if (answer.selectedOptionId !== null) c.answered += 1;
        if (answer.isCorrect === true) c.correct += 1;
        questionCounts.set(key, c);
      }
    }
  }
  const cohortKeys = [...new Set(pairs.map((p) => p.cohort))];
  const mixedRevisions = cohortKeys.length > 1;
  const pooled = mixedRevisions ? [] : pairs;
  const cohorts = cohortKeys.map((revisionIds) => {
    const data = pairs.filter((p) => p.cohort === revisionIds);
    return {
      revisionIds,
      count: data.length,
      v1: descriptive(data.map((p) => p.v1)),
      v2: descriptive(data.map((p) => p.v2)),
      differences: descriptive(data.map((p) => p.difference)),
      groups: (['A','B'] as const).map(group => { const subset = data.filter(p => p.group === group); return {
        group, count: subset.length,
        v1: descriptive(subset.map(p => p.v1)), v2: descriptive(subset.map(p => p.v2)),
        differences: descriptive(subset.map(p => p.difference))
      }; })
    };
  });
  return {
    mixedRevisions,
    cohorts,
    completedPairs,
    validPairs: pairs.length,
    smallSample: pairs.length > 0 && pairs.length < 10,
    pendingReview: sessions.filter(s => s.status === 'COMPLETED' && s.validityFlag === 'REVIEW_REQUIRED').length,
    invalidCompleted: sessions.filter(s => s.status === 'COMPLETED' && s.validityFlag === 'INVALID').length,
    excludedCompleted: sessions.filter(s => s.status === 'COMPLETED' && s.validityFlag === 'INVALID').length,
    v1: descriptive(pooled.map((p) => p.v1)),
    v2: descriptive(pooled.map((p) => p.v2)),
    differences: descriptive(pooled.map((p) => p.difference)),
    readingDurationSeconds: descriptive(mixedRevisions ? [] : readingTimes),
    quizDurationSeconds: descriptive(mixedRevisions ? [] : quizTimes),
    scoreMax: Math.max(scoreMax, LEGACY_QUESTIONS_PER_TEST),
    v1Distribution: Array.from({ length: Math.max(scoreMax, LEGACY_QUESTIONS_PER_TEST) + 1 }, (_, i) => pooled.filter((p) => p.v1 === i).length),
    v2Distribution: Array.from({ length: Math.max(scoreMax, LEGACY_QUESTIONS_PER_TEST) + 1 }, (_, i) => pooled.filter((p) => p.v2 === i).length),
    questions: (mixedRevisions ? [] : [...questionCounts])
      .map(([key, data]) => ({ questionId: key.split(':').slice(1).join(':'), ...data }))
      .sort(
        (a, b) =>
          a.presentation.localeCompare(b.presentation) || a.questionId.localeCompare(b.questionId)
      ),
    groupA: pairs.filter((p) => p.group === 'A').length,
    groupB: pairs.filter((p) => p.group === 'B').length
  };
}

export class AnalysisService {
  constructor(private readonly repo = new ResearchRepository()) {}
  async overview(phase: StudyPhase, filters: SessionExportFilters = {}) {
    const [counts, dataset] = await Promise.all([
      this.repo.dashboardCounts(phase, filters),
      this.repo.analysisDataset(phase, false, filters)
    ]);

    let questionSet: QuestionSetDoc | null = null;
    const firstWithSet = dataset.sessions.find(s => s.questionSetId);
    if (firstWithSet?.questionSetId) {
      questionSet = await this.repo.getQuestionSetById(firstWithSet.questionSetId);
    } else {
      questionSet = await this.repo.getPublishedQuestionSet(phase);
    }

    const variants = summarizeVariants(dataset, questionSet);
    const completedDataset: AnalysisDataset = {
      sessions: dataset.sessions.filter(s => s.status === 'COMPLETED'),
      tests: dataset.tests,
      readings: dataset.readings
    };
    const legacy = summarizePairs(completedDataset);

    return {
      counts,
      variants,
      legacy,
      analysis: legacy
    };
  }
}
