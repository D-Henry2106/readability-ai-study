import type { Metadata } from 'next';
import { getAdminSession } from '@/lib/auth/admin-session';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { QuestionManager } from '@/components/admin/QuestionManager';
export const metadata: Metadata = { title: 'Quản lý câu hỏi', robots: { index: false, follow: false } };
export default async function Page() { const admin = await getAdminSession(); const docs = await new ResearchRepository().listQuestionSets(); const items = docs.map(item => ({ _id: item._id!.toHexString(), revision: item.revision, label: item.label, questions: item.questions, status: item.status, locked: item.locked, phase: item.phase })); return <div className="stack"><div><h1>Bộ câu hỏi</h1><p className="help">Mỗi bộ có 5 câu, mỗi câu 4 lựa chọn và 1 đáp án đúng. Người tham gia không nhận đáp án đúng.</p></div><QuestionManager items={items} canEdit={admin?.role === 'RESEARCHER'} /></div>; }
