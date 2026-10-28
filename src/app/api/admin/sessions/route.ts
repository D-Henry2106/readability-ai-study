import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-session';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { jsonError } from '@/lib/http';
export async function GET(request: NextRequest) { try { await requireAdmin(); const p = request.nextUrl.searchParams; const value = (k: string) => p.get(k) || undefined; const data = await new ResearchRepository().listSessions({ page: Math.max(1, Number(value('page') ?? 1)), pageSize: Math.min(100, Math.max(1, Number(value('pageSize') ?? 25))), search: value('search'), status: value('status') as never, groupCode: value('group') as never, validityFlag: value('validity') as never, phase: value('phase') as never, sort: value('sort') === 'oldest' ? 'oldest' : 'newest' }); return NextResponse.json(data); } catch (e) { return jsonError(e); } }
