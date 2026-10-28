import { presentationForRound } from '@/lib/experiment/presentation';
import type { ReadingSessionDoc, SessionDoc, TestAttemptDoc } from '@/types/research';

/** Shared eligibility for descriptive statistics and paired CSV. */
export function pairedEvidence(session: SessionDoc, tests: TestAttemptDoc[], readings: ReadingSessionDoc[]) {
  if (session.status !== 'COMPLETED' || session.validityFlag !== 'VALID' || session.validityChecklistVersion !== 1 || !session.groupCode || tests.length !== 2 || readings.length !== 2) return null;
  for (const roundNo of [1, 2] as const) {
    const tt = tests.filter(t => t.roundNo === roundNo);
    const rr = readings.filter(r => r.roundNo === roundNo);
    if (tt.length !== 1 || rr.length !== 1) return null;
    const t = tt[0], r = rr[0], expected = presentationForRound(session.groupCode, roundNo);
    if (t.presentation !== expected || r.presentation !== expected || t.questionSetId?.toString() !== session.questionSetId?.toString() || !r.finishedAt || r.readingSeconds === null || !Number.isInteger(t.score) || t.score < 0 || t.score > 5 || t.answers.length !== 5) return null;
  }
  const v1 = tests.find(t => t.presentation === 'V1')!, v2 = tests.find(t => t.presentation === 'V2')!;
  const v1Reading = readings.find(r => r.presentation === 'V1')!, v2Reading = readings.find(r => r.presentation === 'V2')!;
  return { v1, v2, v1Reading, v2Reading, difference: v2.score - v1.score,
    cohort: `${session.assignedPackageCode ?? 'legacy'}@${session.assignedPackageRevision ?? '-'} / ${session.contentRevisionId?.toString() ?? 'missing'} / ${session.questionSetId?.toString() ?? 'missing'}` };
}
