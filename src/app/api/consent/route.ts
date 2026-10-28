import { NextRequest, NextResponse } from 'next/server';
import { getParticipantSessionId } from '@/lib/auth/participant-session';
import { consentSchema } from '@/lib/validation/schemas';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { ExperimentStateService } from '@/lib/services/state.service';
import { EventService } from '@/lib/services/event.service';
import { jsonError } from '@/lib/http';
export async function POST(request: NextRequest) { try { const id = await getParticipantSessionId(); if (!id) throw new Error('SESSION_NOT_FOUND'); const { decision } = consentSchema.parse(await request.json()); const repo = new ResearchRepository(); const state = new ExperimentStateService(repo); const session = await state.requireStage(id, 'CONSENT'); const persisted = await repo.saveConsent({ sessionId: id, informationVersion: session.informationVersion, consentVersion: session.consentVersion, decision, decidedAt: new Date() }); if (persisted.decision !== decision) throw new Error('CONSENT_ALREADY_RECORDED'); const events = new EventService(repo); if (decision === 'DECLINED') { await repo.closeActiveSession(id, 'DECLINED', 'CONSENT'); await events.add(id, 'CONSENT_DECLINED'); return NextResponse.json({ ok: true }); } await events.add(id, 'CONSENT_ACCEPTED'); await state.transition(id, 'CONSENT', 'DEMOGRAPHICS'); return NextResponse.json({ ok: true }); } catch (e) { return jsonError(e); } }
