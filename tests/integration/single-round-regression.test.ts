import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { resetAndSeedReady, withTestDb } from '../helpers/test-db';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { ExperimentStateService } from '@/lib/services/state.service';
import { ReadingService } from '@/lib/services/reading.service';
import { EventService } from '@/lib/services/event.service';
import { SessionService } from '@/lib/services/session.service';

const cookie = vi.hoisted(() => ({ id: null as string | null }));
vi.mock('@/lib/auth/participant-session', () => ({
  getParticipantSessionId: async () => cookie.id,
  setParticipantSessionId: async (id: string) => { cookie.id = id; },
  clearParticipantSession: async () => { cookie.id = null; }
}));

describe('Participant single-round regression tests', () => {
  beforeEach(async () => {
    await resetAndSeedReady();
    cookie.id = null;
  });

  it('completes the experiment in exactly 1 round and never enters BREAK, READING_2 or TEST_2', async () => {
    const repo = new ResearchRepository();
    const state = new ExperimentStateService(repo);
    const events = new EventService(repo);
    const readingSvc = new ReadingService(repo);

    // 1. Participant entry
    const session = await new SessionService(repo).create('desktop');
    cookie.id = session.id;
    expect(session.currentStage).toBe('INFORMATION');

    // 2. Consent
    await events.add(session.id, 'INFORMATION_SHOWN');
    await state.transition(session.id, 'INFORMATION', 'CONSENT');
    await repo.saveConsent({
      sessionId: session.id,
      informationVersion: session.informationVersion,
      consentVersion: session.consentVersion,
      decision: 'ACCEPTED',
      decidedAt: new Date()
    });
    await events.add(session.id, 'CONSENT_ACCEPTED');
    await state.transition(session.id, 'CONSENT', 'DEMOGRAPHICS');

    // 3. Demographics
    const { POST: postDemographics } = await import('@/app/api/demographics/route');
    const demoRes = await postDemographics(new NextRequest('http://localhost/api/demographics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ageRange: '21-24',
        gender: null,
        fieldOfStudy: null,
        yearOfStudy: null,
        aiUsageFrequency: null,
        onlineReadingFrequency: null
      })
    }));
    expect(demoRes.status).toBe(200);

    const afterDemo = (await repo.getSession(session.id))!;
    expect(afterDemo.currentStage).toBe('READING_1');

    // 4. Reading Phase (Round 1)
    await readingSvc.start(afterDemo);
    await events.add(session.id, 'READING_STARTED', 1);

    // Backdate startedAt to satisfy minimum reading time
    const past = new Date(Date.now() - 5000);
    await withTestDb((db) =>
      db.collection('reading_sessions').updateOne({ sessionId: session.id, roundNo: 1 }, { $set: { startedAt: past } })
    );

    const finishReading = await readingSvc.finish(afterDemo, {
      nextClickedAt: new Date(),
      scrollCount: 2,
      maxScrollDepthPercent: 100
    });
    expect(finishReading.remainingSeconds).toBe(0);
    await events.add(session.id, 'READING_FINISHED', 1);
    await state.transition(session.id, 'READING_1', 'REVIEW_1');

    // 5. Review Phase -> Test Phase
    await events.add(session.id, 'TEST_REVIEW_CONFIRMED', 1);
    await state.transition(session.id, 'REVIEW_1', 'TEST_1');
    await events.add(session.id, 'TEST_STARTED', 1);

    // 6. Test Submission
    const qSet = (await repo.getQuestionSetById(session.questionSetId))!;
    const answers = qSet.questions.map((q) => ({
      questionId: q.id,
      selectedOptionId: q.options[0].id
    }));

    const { POST: submitTest } = await import('@/app/api/test/submit/route');
    const submitRes = await submitTest(new NextRequest('http://localhost/api/test/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers })
    }));

    expect(submitRes.status).toBe(200);
    const submitBody = await submitRes.json();
    // CRITICAL: Next route must be /complete directly, never /experiment/break
    expect(submitBody.nextRoute).toBe('/complete');

    // 7. Verification: Session is COMPLETED, not BREAK
    const finalSession = (await repo.getSession(session.id))!;
    expect(finalSession.status).toBe('COMPLETED');
    expect(finalSession.currentStage).toBe('COMPLETED');

    // 8. Verification: Exactly 1 reading and 1 test attempt exist
    const readings = await withTestDb((db) =>
      db.collection('reading_sessions').find({ sessionId: session.id }).toArray()
    );
    expect(readings.length).toBe(1);
    expect(readings[0].roundNo).toBe(1);

    const attempts = await withTestDb((db) =>
      db.collection('test_attempts').find({ sessionId: session.id }).toArray()
    );
    expect(attempts.length).toBe(1);
    expect(attempts[0].roundNo).toBe(1);

    // 9. Verification: Participant cannot transition to BREAK or trigger a 2nd round
    await expect(state.transition(session.id, 'COMPLETED', 'BREAK' as never)).rejects.toThrow();
  });
});
