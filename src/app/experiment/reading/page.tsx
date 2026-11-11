import type { Metadata } from 'next';
import { ParticipantShell } from '@/components/participant/ParticipantShell';
import { ReadingClient } from '@/components/participant/ReadingClient';
import { requireParticipantPage } from '@/lib/auth/participant-guard';
import { PresentationProfileRepository } from '@/lib/repositories/presentation-profile.repository';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { presentationForRound } from '@/lib/experiment/presentation';
export const metadata: Metadata = { title: 'Đọc bài', robots: { index: false, follow: false } };
export default async function Page() {
  const session = await requireParticipantPage(['READING_1', 'READING_2']);
  const isStudyRun = Boolean(session.studyRunId);
  if (!isStudyRun && !session.groupCode) throw new Error('Chưa có phân nhóm thực nghiệm.');
  if (isStudyRun && !session.presentationVariant) throw new Error('Chưa có phiên bản hiển thị.');
  const repo = new ResearchRepository();
  const content = await repo.getContentById(session.contentRevisionId);
  const config = session.minimumReadingSeconds ? null : await repo.getConfig();
  const minimumReadingSeconds = session.minimumReadingSeconds ?? config?.minimumReadingSeconds;
  if (!content || !minimumReadingSeconds) throw new Error('Nội dung nghiên cứu hiện không khả dụng.');
  const roundNo = session.currentStage === 'READING_1' ? 1 : 2;
  const presentation = isStudyRun ? session.presentationVariant! : presentationForRound(session.groupCode!, roundNo);
  const profile = isStudyRun && presentation === 'V2' && session.presentationProfileId
    ? await new PresentationProfileRepository().getById(session.presentationProfileId)
    : null;
  if (isStudyRun && presentation === 'V2' && (!profile || !profile.contentRevisionId.equals(session.contentRevisionId))) {
    throw new Error('Hồ sơ hiển thị V2 hiện không khả dụng.');
  }
  return (
    <ParticipantShell step={roundNo === 1 ? 4 : 7} title={`Lượt đọc ${roundNo}`} wide>
      <ReadingClient
        rawContent={content.rawContent}
        presentation={presentation}
        minimumSeconds={minimumReadingSeconds}
        emphasis={profile?.emphasis}
        sentencesPerBlock={profile?.segmentation.sentencesPerBlock}
      />
    </ParticipantShell>
  );
}
