import type { Metadata } from 'next';
import { ParticipantShell } from '@/components/participant/ParticipantShell';
import { TestReview } from '@/components/participant/TestReview';
import { requireParticipantPage } from '@/lib/auth/participant-guard';

export const metadata: Metadata = {
  title: 'Chuẩn bị trả lời câu hỏi',
  robots: { index: false, follow: false }
};

export default async function Page() {
  const session = await requireParticipantPage(['REVIEW_1', 'REVIEW_2']);
  const isStudyRun = Boolean(session.studyRunId);
  if (isStudyRun && session.currentStage !== 'REVIEW_1') {
    throw new Error('Bước chuẩn bị câu hỏi không hợp lệ cho phiên nghiên cứu một lượt.');
  }
  const roundNo = session.currentStage === 'REVIEW_1' ? 1 : 2;
  return (
    <ParticipantShell
      step={isStudyRun ? 5 : roundNo === 1 ? 5 : 8}
      total={isStudyRun ? 6 : 9}
      title={isStudyRun ? 'Trước phần câu hỏi' : `Trước phần câu hỏi — lượt ${roundNo}`}
    >
      <TestReview roundNo={roundNo} isSingleRound={isStudyRun} />
    </ParticipantShell>
  );
}
