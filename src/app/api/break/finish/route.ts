import { NextResponse } from 'next/server';
import { getParticipantSessionId } from '@/lib/auth/participant-session';
import { ExperimentStateService } from '@/lib/services/state.service';
import { BreakService } from '@/lib/services/break.service';
import { EventService } from '@/lib/services/event.service';
import { jsonError } from '@/lib/http';
export async function POST() {
  try {
    const id = await getParticipantSessionId();
    if (!id) throw new Error('SESSION_NOT_FOUND');
    return NextResponse.json({ finished: true, remainingSeconds: 0 });
  } catch (e) {
    return jsonError(e);
  }
}
