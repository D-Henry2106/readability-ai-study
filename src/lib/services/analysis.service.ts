import { pairedEvidence } from './paired-eligibility';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import type { GroupCode, ReadingSessionDoc, SessionDoc, StudyPhase, TestAttemptDoc } from '@/types/research';

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

type AnalysisDataset = {
  sessions: SessionDoc[];
  tests: TestAttemptDoc[];
  readings: ReadingSessionDoc[];
};

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
  // Mixing different content/question revisions invalidates a single pooled
  // comprehension comparison. Report results separately, not as one estimate.
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
    v1Distribution: Array.from({ length: 6 }, (_, i) => pooled.filter((p) => p.v1 === i).length),
    v2Distribution: Array.from({ length: 6 }, (_, i) => pooled.filter((p) => p.v2 === i).length),
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
  async overview(phase: StudyPhase, filters: { group?: GroupCode; packageCode?: string; revision?: number } = {}) {
    const [counts, dataset] = await Promise.all([
      this.repo.dashboardCounts(phase, filters),
      this.repo.analysisDataset(phase, true, filters)
    ]);
    return { counts, analysis: summarizePairs(dataset) };
  }
}
