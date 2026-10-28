import { NextResponse } from 'next/server';
import { getParticipantSessionId } from '@/lib/auth/participant-session';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { ExperimentStateService } from '@/lib/services/state.service';
import { EventService } from '@/lib/services/event.service';
import { jsonError } from '@/lib/http';

export async function POST() {
  try {
    const id = await getParticipantSessionId();
    if (!id) throw new Error('SESSION_NOT_FOUND');
    const repo = new ResearchRepository();
    const state = new ExperimentStateService(repo);
    const session = await state.requireStage(id, ['REVIEW_1', 'REVIEW_2']);
    const roundNo = session.currentStage === 'REVIEW_1' ? 1 : 2;
    await new EventService(repo).add(id, 'TEST_REVIEW_CONFIRMED', roundNo);
    await state.transition(id, session.currentStage, roundNo === 1 ? 'TEST_1' : 'TEST_2');
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
