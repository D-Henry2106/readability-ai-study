import { describe, it, expect, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import { reviewSessionValidity } from '@/lib/services/validity-review.service';
import { updateResearchConfig } from '@/lib/services/config-update.service';
import { ExportService } from '@/lib/services/export.service';
import { parseResearchFilters } from '@/lib/services/research-filters';
import { pairedEvidence } from '@/lib/services/paired-eligibility';
import { summarizePairs } from '@/lib/services/analysis.service';
import type { ResearchRepository } from '@/lib/repositories/research.repository';
import type { ExperimentConfigDoc, SessionDoc, TestAttemptDoc, ReadingSessionDoc } from '@/types/research';

const actor = { username: 'test_researcher', role: 'RESEARCHER' as const };
const d = new Date('2026-01-01T00:00:00Z');
const at = (seconds: number) => new Date(d.getTime() + seconds * 1000);
const qid = new ObjectId(), cid = new ObjectId(), pid = new ObjectId();
const config: ExperimentConfigDoc = { key: 'active', phase: 'MAIN', studyPublished: true, assignmentMode: 'FIXED',
  fixedPackageId: null, mainRandomApproved: false, allowPilotRetakes: false,
  informationText: 'Information', informationVersion: 'I1', consentText: 'Consent', consentVersion: 'C1',
  debriefText: 'Debrief', debriefVersion: 'D1', dataRightsText: 'Rights', findingsText: 'Findings',
  minimumReadingSeconds: 60, minimumValidTarget: 40, recruitmentTarget: 60, updatedAt: d };
const inputs = { studyPublished: true, assignmentMode: 'FIXED' as const, fixedPackageId: null, mainRandomApproved: false,
  allowPilotRetakes: false, phase: 'MAIN' as const, informationText: 'Information', informationVersion: 'I1',
  consentText: 'Consent', consentVersion: 'C1', debriefText: 'Debrief', debriefVersion: 'D1',
  dataRightsText: 'Rights', findingsText: 'Findings', minimumReadingSeconds: 60, minimumValidTarget: 40, recruitmentTarget: 60 };

function session(id: string, group: 'A'|'B', code = 'PKG_01', revision = 1): SessionDoc {
  return { id, groupCode: group, assignedPackageId: pid, assignedPackageCode: code, assignedPackageRevision: revision,
    contentRevisionId: cid, questionSetId: qid, phase: 'MAIN', status: 'COMPLETED', currentStage: 'COMPLETED',
    deviceType: 'desktop', informationVersion: 'I1', consentVersion: 'C1', debriefVersion: 'D1',
    minimumReadingSeconds: 60, validityFlag: 'VALID', validityChecklistVersion: 1, validityReason: null,
    completedAt: at(700), withdrawnAt: null, createdAt: d, updatedAt: at(700) };
}
function pair(s: SessionDoc) {
  const tests: TestAttemptDoc[] = ([1, 2] as const).map((roundNo) => ({ sessionId: s.id, roundNo,
    presentation: s.groupCode === 'A' ? (roundNo === 1 ? 'V1' : 'V2') : (roundNo === 1 ? 'V2' : 'V1'),
    questionSetId: qid, startedAt: at(roundNo * 100), submittedAt: at(roundNo * 100 + 30), score: roundNo === 1 ? 3 : 4,
    answers: Array.from({ length: 5 }, (_, i) => ({ questionId: `q${i}`, selectedOptionId: 'o0', isCorrect: true })) }));
  const readings: ReadingSessionDoc[] = ([1, 2] as const).map((roundNo) => ({ sessionId: s.id, roundNo,
    presentation: tests[roundNo - 1].presentation, startedAt: at(roundNo * 100 - 90), finishedAt: at(roundNo * 100),
    renderedAt: d, nextClickedAt: at(roundNo * 100), readingSeconds: 90, scrollCount: 0, maxScrollDepthPercent: 100 }));
  return { tests, readings };
}

describe('Phase 1: session validity guard', () => {
  it('rejects VALID with missing consent/checklist, without writes', async () => {
    const s = session('bad', 'A');
    const repo = { getSessionBundle: vi.fn().mockResolvedValue({ session: s, consent: null, readings: [], tests: [], events: [], breakDoc: null }),
      getQuestionSetById: vi.fn().mockResolvedValue(null), setValidity: vi.fn(), addAudit: vi.fn() } as unknown as ResearchRepository;
    const result = await reviewSessionValidity('bad', { validityFlag: 'VALID', reason: null }, actor, repo);
    expect(result.status).toBe(409);
    expect(result.body).toHaveProperty('checks');
    expect(repo.setValidity).not.toHaveBeenCalled();
    expect(repo.addAudit).not.toHaveBeenCalled();
  });
  it('rejects review of unfinished sessions; records reviewer on manual INVALID', async () => {
    const s = session('bad', 'A');
    const repo = { getSessionBundle: vi.fn().mockResolvedValue({ session: { ...s, status: 'ACTIVE' }, consent: null, readings: [], tests: [], events: [], breakDoc: null }),
      getQuestionSetById: vi.fn(), setValidity: vi.fn(), addAudit: vi.fn() } as unknown as ResearchRepository;
    expect((await reviewSessionValidity('bad', { validityFlag: 'INVALID', reason: 'no consent' }, actor, repo)).status).toBe(409);
    expect(repo.setValidity).not.toHaveBeenCalled();
    vi.mocked(repo.getSessionBundle).mockResolvedValue({ session: s, consent: null, readings: [], tests: [], events: [], breakDoc: null } as never);
    vi.mocked(repo.setValidity).mockResolvedValue(s);
    const accepted = await reviewSessionValidity('bad', { validityFlag: 'INVALID', reason: 'no consent' }, actor, repo);
    expect(accepted.status).toBe(200);
    expect(repo.setValidity).toHaveBeenCalledWith('bad', 'INVALID', 'no consent', actor.username, null);
    expect(repo.addAudit).toHaveBeenCalledWith(expect.objectContaining({ username: actor.username, action: 'VALIDITY_CHANGED' }));
  });
  it('accepts full checklist and persists reviewer, checklist proof and audit', async () => {
    const s = { ...session('complete', 'A'), validityFlag: 'REVIEW_REQUIRED' as const };
    const questions = { _id: qid, questions: Array.from({ length: 5 }, (_, i) => ({
      id: `q${i}`, prompt: 'Sample question', options: [
        { id: 'o0', text: 'A', isCorrect: true }, { id: 'o1', text: 'B', isCorrect: false },
        { id: 'o2', text: 'C', isCorrect: false }, { id: 'o3', text: 'D', isCorrect: false }
      ] })) };
    const readings: ReadingSessionDoc[] = ([1, 2] as const).map((roundNo, i) => ({
      sessionId: s.id, roundNo, presentation: roundNo === 1 ? 'V1' : 'V2',
      startedAt: at(i ? 500 : 30), finishedAt: at(i ? 590 : 120),
      renderedAt: at(i ? 500 : 30), nextClickedAt: at(i ? 590 : 120),
      readingSeconds: 90, scrollCount: 1, maxScrollDepthPercent: 100
    }));
    const tests: TestAttemptDoc[] = ([1, 2] as const).map((roundNo, i) => ({
      sessionId: s.id, roundNo, questionSetId: qid, presentation: roundNo === 1 ? 'V1' : 'V2',
      startedAt: at(i ? 600 : 140), submittedAt: at(i ? 630 : 170), score: 5,
      answers: questions.questions.map(q => ({ questionId: q.id, selectedOptionId: 'o0', isCorrect: true }))
    }));
    const events = ([1, 2] as const).flatMap(roundNo =>
      (['READING_STARTED', 'READING_FINISHED', 'TEST_STARTED', 'TEST_SUBMITTED'] as const).map(type =>
        ({ sessionId: s.id, roundNo, type, createdAt: d })));
    const repo = {
      getSessionBundle: vi.fn().mockResolvedValue({ session: s, readings, tests,
        consent: { sessionId: s.id, decision: 'ACCEPTED', informationVersion: 'I1', consentVersion: 'C1' },
        events: [...events, { sessionId: s.id, type: 'SESSION_STARTED' }, { sessionId: s.id, type: 'SESSION_COMPLETED' }],
        breakDoc: { sessionId: s.id, startedAt: at(170), finishedAt: at(300) } }),
      getQuestionSetById: vi.fn().mockResolvedValue(questions), setValidity: vi.fn().mockResolvedValue(s),
      addAudit: vi.fn().mockResolvedValue(undefined)
    } as unknown as ResearchRepository;
    const result = await reviewSessionValidity(s.id, { validityFlag: 'VALID', reason: null }, actor, repo);
    expect(result.status).toBe(200);
    expect(repo.setValidity).toHaveBeenCalledWith(s.id, 'VALID', null, actor.username, 1);
    expect(repo.addAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'VALIDITY_CHANGED', username: actor.username }));
  });
  it('does not count legacy VALID without proven checklist in paired analysis', () => {
    const s = session('legacy', 'A');
    const { tests, readings } = pair(s);
    expect(pairedEvidence({ ...s, validityChecklistVersion: undefined }, tests, readings)).toBeNull();
    expect(pairedEvidence(s, tests, readings)).not.toBeNull();
    expect(pairedEvidence({ ...s, validityFlag: 'INVALID' }, tests, readings)).toBeNull();
  });
});

describe('Phase 1: config no-write guarantee', () => {
  it('does not unpublish on unapproved MAIN random assignment', async () => {
    const repo = { getConfig: vi.fn().mockResolvedValue(config), saveConfigIfUnchanged: vi.fn(), addAudit: vi.fn() } as unknown as ResearchRepository;
    const result = await updateResearchConfig({ ...inputs, assignmentMode: 'RANDOM', mainRandomApproved: false }, actor, repo);
    expect(result.status).toBe(409);
    expect(repo.saveConfigIfUnchanged).not.toHaveBeenCalled();
    expect(config.studyPublished).toBe(true);
  });
  it('does not write if publish readiness fails for the proposed state', async () => {
    const repo = { getConfig: vi.fn().mockResolvedValue(config), listEligiblePackages: vi.fn().mockResolvedValue([]),
      saveConfigIfUnchanged: vi.fn(), addAudit: vi.fn() } as unknown as ResearchRepository;
    const result = await updateResearchConfig({ ...inputs, phase: 'PILOT' }, actor, repo);
    expect(result.status).toBe(409);
    expect(repo.saveConfigIfUnchanged).not.toHaveBeenCalled();
    expect(config.studyPublished).toBe(true);
  });
  it('returns 409 if concurrent update prevented compare-and-swap, without audit', async () => {
    const repo = { getConfig: vi.fn().mockResolvedValue(config), saveConfigIfUnchanged: vi.fn().mockResolvedValue(null),
      addAudit: vi.fn() } as unknown as ResearchRepository;
    const result = await updateResearchConfig({ ...inputs, studyPublished: false }, actor, repo);
    expect(result.status).toBe(409);
    expect(repo.addAudit).not.toHaveBeenCalled();
  });
  it('commits only one proposed update and records audit on success', async () => {
    const saved = { ...config, studyPublished: false };
    const repo = { getConfig: vi.fn().mockResolvedValue(config), saveConfigIfUnchanged: vi.fn().mockResolvedValue(saved),
      addAudit: vi.fn().mockResolvedValue(undefined) } as unknown as ResearchRepository;
    const result = await updateResearchConfig({ ...inputs, studyPublished: false }, actor, repo);
    expect(result.status).toBe(200);
    expect(repo.saveConfigIfUnchanged).toHaveBeenCalledWith(config, saved);
    expect(repo.addAudit).toHaveBeenCalledTimes(1);
  });
});

describe('Phase 1: CSV filter agreement with paired statistics', () => {
  it('applies phase/group/package/revision to both statistics query and CSV, preserving formula escaping', async () => {
    const filters = parseResearchFilters({ group: 'B', package: 'pkg_01', revision: '2' });
    const s1 = session('in', 'B', 'PKG_01', 2), s2 = session('out-group', 'A', 'PKG_01', 2), s3 = session('out-rev', 'B', 'PKG_01', 1);
    const sessions = [s1, s2, s3];
    const repo = { analysisDataset: vi.fn(async (_phase: string, _completed: boolean, f: typeof filters) => {
      const selected = sessions.filter(s => (!f.group || s.groupCode === f.group) && (!f.packageCode || s.assignedPackageCode === f.packageCode) && (!f.revision || s.assignedPackageRevision === f.revision));
      return { sessions: selected, tests: selected.flatMap(s => pair(s).tests), readings: selected.flatMap(s => pair(s).readings) };
    }) } as unknown as ResearchRepository;
    const csv = await new ExportService(repo).paired('MAIN', filters);
    const stats = await repo.analysisDataset('MAIN', true, filters);
    const summary = summarizePairs(stats);
    expect(summary.validPairs).toBe(1);
    expect(csv.split('\n')).toHaveLength(summary.validPairs + 1);
    expect(csv).toContain('"in"');
    expect(csv).not.toContain('out-group');
    expect(csv).not.toContain('out-rev');
    expect(repo.analysisDataset).toHaveBeenCalledWith('MAIN', true, filters);
    expect(parseResearchFilters({ revision: '99999999999999999' }).revision).toBeUndefined();
  });
  it('passes filters to every export format', async () => {
    const filters = parseResearchFilters({ group: 'A', package: 'PKG_01', revision: '1' });
    const repo = { analysisDataset: vi.fn().mockResolvedValue({ sessions: [], tests: [], readings: [] }),
      listAllSessionsForExport: vi.fn().mockResolvedValue([]), listEventData: vi.fn().mockResolvedValue([]) } as unknown as ResearchRepository;
    const csv = new ExportService(repo);
    await Promise.all([csv.wide('MAIN', filters), csv.long('MAIN', filters), csv.questions('MAIN', filters), csv.events('MAIN', filters)]);
    expect(repo.listAllSessionsForExport).toHaveBeenCalledWith('MAIN', filters);
    expect(repo.analysisDataset).toHaveBeenCalledWith('MAIN', false, filters);
    expect(repo.listEventData).toHaveBeenCalledWith('MAIN', filters);
  });
});
