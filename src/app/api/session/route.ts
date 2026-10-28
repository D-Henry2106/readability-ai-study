import { NextRequest, NextResponse } from 'next/server';
import { SessionService } from '@/lib/services/session.service';
import { deviceTypeSchema } from '@/lib/validation/schemas';
import { getParticipantSessionId, setParticipantSessionId } from '@/lib/auth/participant-session';
import { jsonError } from '@/lib/http';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { ExperimentStateService } from '@/lib/services/state.service';
export async function POST(request: NextRequest) { try { const body = await request.json(); const deviceType = deviceTypeSchema.parse(body.deviceType); const existingId = await getParticipantSessionId();
    if (existingId) {
      const repo = new ResearchRepository();
      const existing = await repo.getSession(existingId);
      if (existing) {
        return NextResponse.json({ ok: true, resumed: true, nextRoute: new ExperimentStateService(repo).routeFor(existing) });
      }
    }
    const session = await new SessionService().create(deviceType); await setParticipantSessionId(session.id); return NextResponse.json({ ok: true }); } catch (e) { return jsonError(e); } }
