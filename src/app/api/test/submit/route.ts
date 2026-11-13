import { NextRequest, NextResponse } from 'next/server';
import { getParticipantSessionId } from '@/lib/auth/participant-session';
import { ExperimentStateService } from '@/lib/services/state.service';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { ScoringService } from '@/lib/services/scoring.service';
import { BreakService } from '@/lib/services/break.service';
import { EventService } from '@/lib/services/event.service';
import { testSubmitSchema } from '@/lib/validation/schemas';
import { presentationForRound } from '@/lib/experiment/presentation';
import { jsonError } from '@/lib/http';

export async function POST(request: NextRequest) {
  try {
    const id = await getParticipantSessionId();
    if (!id) throw new Error('SESSION_NOT_FOUND');
    const input = testSubmitSchema.parse(await request.json());
    const repo = new ResearchRepository();
    const state = new ExperimentStateService(repo);
    const existingSession = await repo.getSession(id);
    if (!existingSession) throw new Error('SESSION_NOT_FOUND');

    if (existingSession.studyRunId) {
      const session = await state.requireStage(id, ['TEST_1', 'COMPLETED']);
      if (!session.presentationVariant) throw new Error('VARIANT_NOT_ASSIGNED');
      if (
        typeof session.presentationVersion !== 'number' ||
        !Number.isInteger(session.presentationVersion) ||
        session.presentationVersion < 1
      ) {
        throw new Error('PRESENTATION_VERSION_NOT_ASSIGNED');
      }

      const events = new EventService(repo);
      let firstAttempt = await repo.getTestAttempt(id, 1);

      if (!firstAttempt) {
        if (session.currentStage !== 'TEST_1' || session.status !== 'ACTIVE') {
          throw new Error('INCOMPLETE_EXPERIMENT');
        }
        const set = await repo.getQuestionSetById(session.questionSetId);
        if (!set?._id) throw new Error('QUESTION_SET_NOT_FOUND');
        const startedAt = await repo.testStartedAt(id, 1);
        if (!startedAt) throw new Error('TEST_NOT_STARTED');
        const scored = new ScoringService().score(set, input.answers);
        await repo.insertTestAttempt({
          sessionId: id,
          roundNo: 1,
          presentation: session.presentationVariant,
          presentationVersion: session.presentationVersion,
          questionSetId: set._id,
          answers: scored.answers,
          score: scored.score,
          startedAt,
          submittedAt: new Date()
        });
        firstAttempt = await repo.getTestAttempt(id, 1);
      }

      const firstReading = await repo.getReading(id, 1);
      if (!firstAttempt || !firstReading?.finishedAt) throw new Error('INCOMPLETE_EXPERIMENT');

      await events.add(id, 'TEST_SUBMITTED', 1);

      if (session.status !== 'COMPLETED' || session.currentStage !== 'COMPLETED') {
        const completed = (await repo.completeRunSessionIfReady(id)) ?? (await repo.getSession(id));
        if (!completed || completed.status !== 'COMPLETED' || completed.currentStage !== 'COMPLETED') {
          throw new Error('INVALID_STAGE_TRANSITION');
        }
      }

      await events.add(id, 'SESSION_COMPLETED');
      return NextResponse.json({ ok: true, nextRoute: '/complete' });
    }

    const session = await state.requireStage(id, ['TEST_1', 'TEST_2']);
    if (!session.groupCode) throw new Error('GROUP_NOT_ASSIGNED');
    const round = session.currentStage === 'TEST_1' ? 1 : 2;
    const set = await repo.getQuestionSetById(session.questionSetId);
    if (!set?._id) throw new Error('QUESTION_SET_NOT_FOUND');
    const startedAt = await repo.testStartedAt(id, round);
    if (!startedAt) throw new Error('TEST_NOT_STARTED');
    const scored = new ScoringService().score(set, input.answers);
    const inserted = await repo.insertTestAttempt({
      sessionId: id,
      roundNo: round,
      presentation: presentationForRound(session.groupCode, round),
      questionSetId: set._id,
      answers: scored.answers,
      score: scored.score,
      startedAt,
      submittedAt: new Date()
    });
    const events = new EventService(repo);
    if (inserted) await events.add(id, 'TEST_SUBMITTED', round);
    const firstAttempt = await repo.getTestAttempt(id, 1);
    const firstReading = await repo.getReading(id, 1);
    if (!firstAttempt || !firstReading?.finishedAt) throw new Error('INCOMPLETE_EXPERIMENT');
    const completed = await repo.completeSessionIfReady(id);
    if (!completed) throw new Error('INVALID_STAGE_TRANSITION');
    await events.add(id, 'SESSION_COMPLETED');
    return NextResponse.json({ ok: true, nextRoute: '/complete' });
  } catch (e) {
    return jsonError(e);
  }
}
