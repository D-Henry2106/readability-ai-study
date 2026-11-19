import { NextRequest, NextResponse } from 'next/server';
import { getParticipantSessionId } from '@/lib/auth/participant-session';
import { ExperimentStateService } from '@/lib/services/state.service';
import { ReadingService } from '@/lib/services/reading.service';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { readingFinishSchema } from '@/lib/validation/schemas';
import { EventService } from '@/lib/services/event.service';
import { jsonError } from '@/lib/http';
export async function POST(request: NextRequest) {
  try {
    const id = await getParticipantSessionId();
    if (!id) throw new Error('SESSION_NOT_FOUND');
    const input = readingFinishSchema.parse(await request.json());
    const repo = new ResearchRepository();
    const state = new ExperimentStateService(repo);
    const session = await state.requireStage(id, ['READING_1']);
    const result = await new ReadingService(repo).finish(session, { ...input, nextClickedAt: new Date() });
    if (result.remainingSeconds > 0) return NextResponse.json({ remainingSeconds: result.remainingSeconds });
    await new EventService(repo).add(id, 'READING_FINISHED', 1);
    await state.transition(id, 'READING_1', 'REVIEW_1');
    return NextResponse.json({ remainingSeconds: 0 });
  } catch (e) {
    return jsonError(e);
  }
}
