import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-session';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { jsonError } from '@/lib/http';
import { checkValidity } from '@/lib/services/validity.service';
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) { try { await requireAdmin(); const { id } = await params; const bundle = await new ResearchRepository().getSessionBundle(id); if (!bundle.session) return NextResponse.json({ error: 'Session not found.' }, { status: 404 }); const questions = await new ResearchRepository().getQuestionSetById(bundle.session.questionSetId); return NextResponse.json({ ...bundle, validityChecks: checkValidity({ ...bundle, session: bundle.session, questions }).checks }); } catch (e) { return jsonError(e); } }
