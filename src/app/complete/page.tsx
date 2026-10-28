import type { Metadata } from 'next';
import { ParticipantShell } from '@/components/participant/ParticipantShell';
import { requireParticipantPage } from '@/lib/auth/participant-guard';
import { ResearchRepository } from '@/lib/repositories/research.repository';
export const metadata: Metadata = { title: 'Hoàn thành', robots: { index: false, follow: false } };
export default async function Page() {
  const session = await requireParticipantPage('COMPLETED');
  const c = await new ResearchRepository().getConfig();
  return (
    <ParticipantShell step={9} title="Hoàn thành nghiên cứu" allowWithdraw={false}>
      <p>
        <strong>Cảm ơn bạn đã tham gia.</strong>
      </p>
      <div style={{ whiteSpace: 'pre-wrap' }}>{session.debriefTextSnapshot ?? c.debriefText}</div>
      <h2>Quyền đối với dữ liệu của bạn</h2>
      <div style={{ whiteSpace: 'pre-wrap' }}>
        {session.dataRightsTextSnapshot ?? c.dataRightsText}
      </div>
      <h2>Kết quả nghiên cứu</h2>
      <div style={{ whiteSpace: 'pre-wrap' }}>{session.findingsTextSnapshot ?? c.findingsText}</div>
    </ParticipantShell>
  );
}
