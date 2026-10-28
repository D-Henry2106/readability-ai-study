import type { Metadata } from 'next';
import { ParticipantShell } from '@/components/participant/ParticipantShell';
import { ReadingClient } from '@/components/participant/ReadingClient';
import { requireParticipantPage } from '@/lib/auth/participant-guard';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { presentationForRound } from '@/lib/experiment/presentation';
export const metadata: Metadata = { title: 'Đọc bài', robots: { index: false, follow: false } };
export default async function Page() {
  const session = await requireParticipantPage(['READING_1', 'READING_2']);
  if (!session.groupCode) throw new Error('Chưa có phân nhóm thực nghiệm.');
  const repo = new ResearchRepository();
  const content = await repo.getContentById(session.contentRevisionId);
  const config = session.minimumReadingSeconds ? null : await repo.getConfig();
  const minimumReadingSeconds = session.minimumReadingSeconds ?? config?.minimumReadingSeconds;
  if (!content || !minimumReadingSeconds) throw new Error('Nội dung nghiên cứu hiện không khả dụng.');
  const roundNo = session.currentStage === 'READING_1' ? 1 : 2;
  const presentation = presentationForRound(session.groupCode, roundNo);
  return (
    <ParticipantShell step={roundNo === 1 ? 4 : 7} title={`Lượt đọc ${roundNo}`} wide>
      <ReadingClient
        rawContent={content.rawContent}
        presentation={presentation}
        minimumSeconds={minimumReadingSeconds}
      />
    </ParticipantShell>
  );
}
