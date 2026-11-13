import type { Metadata } from 'next';
import { ParticipantShell } from '@/components/participant/ParticipantShell';
import { TestForm } from '@/components/participant/TestForm';
import { requireParticipantPage } from '@/lib/auth/participant-guard';
import { ResearchRepository } from '@/lib/repositories/research.repository';
export const metadata: Metadata = { title: 'Câu hỏi', robots: { index: false, follow: false } };
export default async function Page() {
  const session = await requireParticipantPage(['TEST_1', 'TEST_2']);
  const isStudyRun = Boolean(session.studyRunId);
  if (isStudyRun && session.currentStage !== 'TEST_1') {
    throw new Error('Bước câu hỏi không hợp lệ cho phiên nghiên cứu một lượt.');
  }
  const set = await new ResearchRepository().getQuestionSetById(session.questionSetId);
  if (!set) throw new Error('Không tìm thấy bộ câu hỏi.');
  const safeQuestions = set.questions.map((q) => ({
    id: q.id,
    prompt: q.prompt,
    options: q.options.map((o) => ({ id: o.id, text: o.text }))
  }));
  const roundNo = session.currentStage === 'TEST_1' ? 1 : 2;
  return (
    <ParticipantShell
      step={isStudyRun ? 6 : roundNo === 1 ? 5 : 8}
      total={isStudyRun ? 6 : 9}
      title={isStudyRun ? 'Câu hỏi' : `Câu hỏi — lượt ${roundNo}`}
    >
      <p>Hãy trả lời {safeQuestions.length} câu hỏi. Hệ thống không hiển thị đáp án đúng hoặc điểm trong quá trình nghiên cứu.</p>
      <TestForm questions={safeQuestions} />
    </ParticipantShell>
  );
}
