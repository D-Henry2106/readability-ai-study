import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-session';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import type { GroupCode, SessionStatus, StudyPhase, ValidityFlag } from '@/types/research';
import { jsonError } from '@/lib/http';
export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
    const p = request.nextUrl.searchParams;
    const repo = new ResearchRepository();
    const configured = (await repo.getConfig()).phase;
    const phase: StudyPhase = p.get('phase') === 'PILOT' ? 'PILOT' : p.get('phase') === 'MAIN' ? 'MAIN' : configured;
    const statuses: SessionStatus[] = ['ACTIVE','COMPLETED','WITHDRAWN','DECLINED','INCOMPLETE'];
    const valids: ValidityFlag[] = ['VALID','INVALID','REVIEW_REQUIRED'];
    const status = p.get('status') as SessionStatus | null;
    const validity = p.get('validity') as ValidityFlag | null;
    const group = p.get('group') as GroupCode | null;
    const packageCode = p.get('package');
    const page = Number(p.get('page') ?? '1'), pageSize = Number(p.get('pageSize') ?? '25');
    if (!Number.isInteger(page) || !Number.isInteger(pageSize) || page < 1 || pageSize < 1 ||
        (status && !statuses.includes(status)) || (validity && !valids.includes(validity)) ||
        (group && !['A','B'].includes(group)) || (packageCode && !/^[a-zA-Z0-9_-]{2,40}$/.test(packageCode))) {
      return NextResponse.json({ error:'Bộ lọc không hợp lệ.' }, { status:400 });
    }
    const data = await repo.listSessions({page, pageSize: Math.min(100,pageSize), search:p.get('search')??undefined,
      packageCode:packageCode??undefined, status:status??undefined, validityFlag:validity??undefined, groupCode:group??undefined,
      phase, sort:p.get('sort')==='oldest'?'oldest':'newest'});
    return NextResponse.json(data);
  } catch (e) { return jsonError(e); }
}
