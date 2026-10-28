import { NextResponse } from 'next/server';
import { getParticipantSessionId } from '@/lib/auth/participant-session';
import { ExperimentStateService } from '@/lib/services/state.service';
import { EventService } from '@/lib/services/event.service';
import { jsonError } from '@/lib/http';
export async function POST() { try { const id = await getParticipantSessionId(); if (!id) throw new Error('SESSION_NOT_FOUND'); const s = await new ExperimentStateService().requireStage(id, ['TEST_1','TEST_2']); await new EventService().add(id, 'TEST_STARTED', s.currentStage === 'TEST_1' ? 1 : 2); return NextResponse.json({ ok: true }); } catch (e) { return jsonError(e); } }
