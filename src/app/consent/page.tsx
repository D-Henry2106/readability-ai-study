import type { Metadata } from 'next';
import { ParticipantShell } from '@/components/participant/ParticipantShell';
import { ConsentForm } from '@/components/participant/ConsentForm';
import { requireParticipantPage } from '@/lib/auth/participant-guard';
import { ResearchRepository } from '@/lib/repositories/research.repository';
export const metadata: Metadata = { title: 'Đồng ý tham gia', robots: { index: false, follow: false } };
export default async function Page() {
  const session = await requireParticipantPage('CONSENT');
  const config = session.consentTextSnapshot ? null : await new ResearchRepository().getConfig();
  return <ParticipantShell step={2} title="Đồng ý tham gia"><div style={{ whiteSpace: 'pre-wrap' }}>{session.consentTextSnapshot ?? config?.consentText}</div><ConsentForm /></ParticipantShell>;
}
