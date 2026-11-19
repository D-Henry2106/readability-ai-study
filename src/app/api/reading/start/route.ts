import { NextRequest, NextResponse } from 'next/server';
import { getParticipantSessionId } from '@/lib/auth/participant-session';
import { ExperimentStateService } from '@/lib/services/state.service';
import { ReadingService } from '@/lib/services/reading.service';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { readingStartSchema } from '@/lib/validation/schemas';
import { EventService } from '@/lib/services/event.service';
import { jsonError } from '@/lib/http';
export async function POST(request: NextRequest) {
  try {
    const id = await getParticipantSessionId();
    if (!id) throw new Error('SESSION_NOT_FOUND');
    readingStartSchema.parse(await request.json());
    const repo = new ResearchRepository();
    const session = await new ExperimentStateService(repo).requireStage(id, ['READING_1']);
    const reading = await new ReadingService(repo).start(session);
    /* Server timestamp is authoritative; client renderedAt is not trusted. */
    await new EventService(repo).add(id, 'READING_STARTED', 1);
    return NextResponse.json({ startedAt: reading.startedAt });
  } catch (e) {
    return jsonError(e);
  }
}
