import { NextResponse } from 'next/server';
import { getParticipantSessionId } from '@/lib/auth/participant-session';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { ExperimentStateService } from '@/lib/services/state.service';
export async function GET() { const id = await getParticipantSessionId(); if (!id) return NextResponse.json({ session: null }); const repo = new ResearchRepository(); const s = await repo.getSession(id); return NextResponse.json({ session: s ? { status: s.status, stage: s.currentStage, route: new ExperimentStateService(repo).routeFor(s) } : null }); }
