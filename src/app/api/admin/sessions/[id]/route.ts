import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-session';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { jsonError } from '@/lib/http';
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) { try { await requireAdmin(); const { id } = await params; const bundle = await new ResearchRepository().getSessionBundle(id); if (!bundle.session) return NextResponse.json({ error: 'Session not found.' }, { status: 404 }); return NextResponse.json(bundle); } catch (e) { return jsonError(e); } }
