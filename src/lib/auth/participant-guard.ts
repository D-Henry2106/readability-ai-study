import { redirect } from 'next/navigation';
import { getParticipantSessionId } from './participant-session';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { ExperimentStateService } from '@/lib/services/state.service';
import type { ExperimentStage } from '@/types/research';

export async function requireParticipantPage(expected: ExperimentStage | ExperimentStage[]) {
  const id = await getParticipantSessionId();
  if (!id) redirect('/');
  const repo = new ResearchRepository();
  const session = await repo.getSession(id);
  if (!session) redirect('/');
  const state = new ExperimentStateService(repo);
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (session.status !== (session.currentStage === 'COMPLETED' ? 'COMPLETED' : 'ACTIVE')) redirect(state.routeFor(session));
  if (!allowed.includes(session.currentStage)) redirect(state.routeFor(session));
  return session;
}
