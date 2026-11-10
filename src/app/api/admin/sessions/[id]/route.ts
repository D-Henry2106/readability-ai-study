import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-session';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { jsonError } from '@/lib/http';
import { checkValidity } from '@/lib/services/validity.service';

/** Canonical session detail. /api/sessions/[id] is a deprecated alias of this handler. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const repo = new ResearchRepository();
    const bundle = await repo.getSessionBundle(id);
    if (!bundle.session) return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
    const questions = await repo.getQuestionSetById(bundle.session.questionSetId);
    return NextResponse.json({ ...bundle, validityChecks: checkValidity({ ...bundle, session: bundle.session, questions }).checks });
  } catch (e) { return jsonError(e); }
}
