import { NextResponse } from 'next/server';
import { getParticipantSessionId } from '@/lib/auth/participant-session';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { EventService } from '@/lib/services/event.service';
import { jsonError } from '@/lib/http';
export async function POST() { try { const id = await getParticipantSessionId(); if (!id) throw new Error('SESSION_NOT_FOUND'); const repo = new ResearchRepository(); const session = await repo.getSession(id); if (!session) throw new Error('SESSION_NOT_FOUND'); if (session.status !== 'ACTIVE') return NextResponse.json({ ok: true }); await new EventService(repo).add(id, 'WITHDRAWAL_REQUESTED'); await repo.closeActiveSession(id, 'WITHDRAWN'); return NextResponse.json({ ok: true }); } catch (e) { return jsonError(e); } }
