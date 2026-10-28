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
  const roundNo = session.currentStage === 'REVIEW_1' ? 1 : 2;
  return (
    <ParticipantShell step={roundNo === 1 ? 5 : 8} title={`Trước phần câu hỏi — lượt ${roundNo}`}>
      <TestReview roundNo={roundNo} />
    </ParticipantShell>
  );
}
