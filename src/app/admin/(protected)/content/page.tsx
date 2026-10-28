import type { Metadata } from 'next';
import { getAdminSession } from '@/lib/auth/admin-session';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { PackageManager } from '@/components/admin/PackageManager';
export const metadata: Metadata = {
  title: 'Bộ nội dung thực nghiệm',
  robots: { index: false, follow: false }
};
export default async function Page() {
  const admin = await getAdminSession();
  const repo = new ResearchRepository();
  const packages = await repo.listPackages();
  const items = await Promise.all(
    packages.map(async (item) => {
      const [c, q] = await Promise.all([
        repo.getContentById(item.contentRevisionId),
        repo.getQuestionSetById(item.questionSetId)
      ]);
      return {
        _id: item._id!.toHexString(),
        code: item.code,
        title: item.title,
        topic: item.topic,
        description: item.description,
        phase: item.phase,
        revision: item.revision,
        status: item.status,
        enabled: item.enabled,
        contentRevision: c?.revision ?? null,
        questionRevision: q?.revision ?? null,
        validation: await new (await import('@/lib/services/package.service')).PackageService(
          repo
        ).checklist(item),
        rawContent: c?.rawContent ?? '',
        questions: q?.questions ?? [],
        createdAt: item.createdAt.toISOString(),
        publishedAt: item.publishedAt?.toISOString() ?? null
      };
    })
  );
  return (
    <div className="stack">
      <h1>Bộ nội dung thực nghiệm</h1>
      <p className="help">
        Quản lý bài đọc V1/V2 và 5 câu hỏi dưới cùng một phiên bản đã khóa. Không cần khóa AI API.
      </p>
      <PackageManager items={items} canEdit={admin?.role === 'RESEARCHER'} />
    </div>
  );
}
