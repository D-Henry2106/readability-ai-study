import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-session';
import { StudyRunService } from '@/lib/services/study-run.service';
import { jsonError } from '@/lib/http';

const noStore = { 'Cache-Control': 'no-store' };

/** List Study Runs (RESEARCHER and SUPERVISOR). All rules live in StudyRunService; this route only authenticates and maps. */
export async function GET() {
  try {
    const admin = await requireAdmin();
    const runs = await new StudyRunService().list({ username: admin.username, role: admin.role });
    return NextResponse.json({ runs }, { headers: noStore });
  } catch (e) { return jsonError(e); }
}

/** Create a DRAFT run from a PUBLISHED package and a PUBLISHED 15-question set (CSRF/Origin is enforced by the proxy for every /api POST). */
export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(['RESEARCHER']);
    const result = await new StudyRunService().create({ username: admin.username, role: admin.role }, await request.json());
    return NextResponse.json({ ok: true, run: result.run, proposedQuotaPerArm: result.proposedQuotaPerArm, auditLogged: result.auditLogged }, { status: 201, headers: noStore });
  } catch (e) { return jsonError(e); }
}
