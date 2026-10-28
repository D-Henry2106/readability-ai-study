import { NextResponse } from 'next/server';
import { getParticipantSessionId } from '@/lib/auth/participant-session';
import { ExperimentStateService } from '@/lib/services/state.service';
import { EventService } from '@/lib/services/event.service';
import { jsonError } from '@/lib/http';
export async function POST() { try { const id = await getParticipantSessionId(); if (!id) throw new Error('SESSION_NOT_FOUND'); const state = new ExperimentStateService(); await state.requireStage(id, 'INFORMATION'); await new EventService().add(id, 'INFORMATION_SHOWN'); await state.transition(id, 'INFORMATION', 'CONSENT'); return NextResponse.json({ ok: true }); } catch (e) { return jsonError(e); } }
