import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getParticipantSessionId } from '@/lib/auth/participant-session';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { ExperimentStateService } from '@/lib/services/state.service';

export const metadata: Metadata = { title: 'Nghiên cứu đọc hiểu', robots: { index: false, follow: false } };

export default async function Page() {
  const id = await getParticipantSessionId();
  if (id) {
    const session = await new ResearchRepository().getSession(id);
    if (session) {
      redirect(new ExperimentStateService().routeFor(session));
    }
  }
  redirect('/');
}
