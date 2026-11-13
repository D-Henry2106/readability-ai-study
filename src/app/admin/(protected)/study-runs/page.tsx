import type { Metadata } from 'next';
import { getAdminSession } from '@/lib/auth/admin-session';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { StudyRunService } from '@/lib/services/study-run.service';
import { StudyRunManager } from '@/components/admin/StudyRunManager';
import { QUESTIONS_PER_TEST } from '@/lib/questions/question-spec';
export const metadata: Metadata = { title: 'Study Run', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const admin = await getAdminSession();
  if (!admin) return null;
  const repo = new ResearchRepository();
  const [runs, packages, sets] = await Promise.all([new StudyRunService().list({ username: admin.username, role: admin.role }), repo.listPackages(), repo.listQuestionSets()]);
  return <div className="stack">
    <div><h1>Study Run</h1><p className="help">Tạo run từ Content Package và bộ câu hỏi {QUESTIONS_PER_TEST} câu đã xuất bản, cấu hình quota và mở run. Hệ thống liệt kê cụ thể điều kiện còn thiếu.</p></div>
    <StudyRunManager
      canEdit={admin.role === 'RESEARCHER'}
      runs={runs.map((r) => ({ _id: r._id!.toHexString(), code: r.code, name: r.name, phase: r.phase, status: r.status, targetSampleSize: r.targetSampleSize, version: r.version, locked: r.locked, packageCode: r.snapshot.packageCode, questionSetRevision: r.snapshot.questionSetRevision ?? null }))}
      packages={packages.filter((p) => p.status === 'PUBLISHED' && p.enabled).map((p) => ({ id: p._id!.toHexString(), label: `${p.code} r${p.revision} · ${p.title} (${p.phase})` }))}
      questionSets={sets.filter((s) => s.status === 'PUBLISHED' && !s.archivedAt && s.questions.length === QUESTIONS_PER_TEST).map((s) => ({ id: s._id!.toHexString(), label: `r${s.revision} · ${s.label} (${s.phase})` }))}
    />
  </div>;
}
