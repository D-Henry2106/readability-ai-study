import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-session';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { parseSessionListQuery } from '@/lib/services/research-filters';
import { jsonError } from '@/lib/http';

/** Canonical session list. /api/sessions is a deprecated alias of this handler. */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
    const repo = new ResearchRepository();
    const parsed = parseSessionListQuery(Object.fromEntries(request.nextUrl.searchParams), (await repo.getConfig()).phase);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    return NextResponse.json(await repo.listSessions(parsed.value));
  } catch (e) { return jsonError(e); }
}
