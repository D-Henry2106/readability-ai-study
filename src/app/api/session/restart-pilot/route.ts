import { NextResponse } from 'next/server';
import { getParticipantSessionId, setParticipantSessionId } from '@/lib/auth/participant-session';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { SessionService } from '@/lib/services/session.service';
import { jsonError } from '@/lib/http';
export async function POST() {
  try {
    const id = await getParticipantSessionId();
    if (!id) throw new Error('SESSION_NOT_FOUND');
    const repo = new ResearchRepository();
    const [previous, config] = await Promise.all([repo.getSession(id), repo.getConfig()]);
    if (!previous || previous.phase !== 'PILOT' || config.phase !== 'PILOT' || !config.allowPilotRetakes || !config.studyPublished ||
      !['COMPLETED', 'DECLINED', 'WITHDRAWN'].includes(previous.status)) return NextResponse.json({error:'Không được phép tạo phiên thử mới theo cấu hình hiện tại.'},{status:409});
    if (previous.pilotReplacementSessionId) {
      const existing = await repo.getSession(previous.pilotReplacementSessionId);
      if (existing) { await setParticipantSessionId(existing.id); return NextResponse.json({ok:true,nextRoute:'/information',resumed:true}); }
    }
    if (!(await repo.claimPilotRestart(id))) return NextResponse.json({error:'Yêu cầu tạo lại đã được xử lý hoặc đang thực hiện.'},{status:409});
    let replacement: string | null = null;
    try {
      const session = await new SessionService(repo).create(previous.deviceType);
      replacement = session.id;
      await repo.recordPilotReplacement(id,session.id);
      await setParticipantSessionId(session.id);
      return NextResponse.json({ok:true,nextRoute:'/information'});
    } catch (error) { if (!replacement) await repo.releasePilotRestart(id); throw error; }
  } catch (error) { return jsonError(error); }
}
