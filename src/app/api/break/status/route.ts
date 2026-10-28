import { NextResponse } from 'next/server';
import { getParticipantSessionId } from '@/lib/auth/participant-session';
import { ExperimentStateService } from '@/lib/services/state.service';
import { BreakService } from '@/lib/services/break.service';
import { jsonError } from '@/lib/http';
export async function GET() { try { const id = await getParticipantSessionId(); if (!id) throw new Error('SESSION_NOT_FOUND'); await new ExperimentStateService().requireStage(id, 'BREAK'); return NextResponse.json(await new BreakService().status(id)); } catch (e) { return jsonError(e); } }
