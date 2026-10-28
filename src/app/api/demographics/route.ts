import { NextRequest, NextResponse } from 'next/server';
import { getParticipantSessionId } from '@/lib/auth/participant-session';
import { demographicsSchema } from '@/lib/validation/schemas';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { ExperimentStateService } from '@/lib/services/state.service';
import { AssignmentService } from '@/lib/services/assignment.service';
import { EventService } from '@/lib/services/event.service';
import { jsonError } from '@/lib/http';
export async function POST(request: NextRequest) { try { const id = await getParticipantSessionId(); if (!id) throw new Error('SESSION_NOT_FOUND'); const input = demographicsSchema.parse(await request.json()); const repo = new ResearchRepository(); const state = new ExperimentStateService(repo); const session = await state.requireStage(id, 'DEMOGRAPHICS'); await repo.saveDemographics({ sessionId: id, ...input, submittedAt: new Date() }); const choice = await new AssignmentService(repo).chooseGroup(session.phase); const assigned = await repo.assignGroupIfMissing(id, choice); if (!assigned?.groupCode) throw new Error('GROUP_ASSIGNMENT_FAILED'); const events = new EventService(repo); await events.add(id, 'DEMOGRAPHICS_SUBMITTED'); await events.add(id, 'GROUP_ASSIGNED'); await state.transition(id, 'DEMOGRAPHICS', 'READING_1'); return NextResponse.json({ ok: true }); } catch (e) { return jsonError(e); } }
