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

  const { PackageService } = await import('@/lib/services/package.service');
  const packageService = new PackageService(repo);

  const items = await Promise.all(
    packages.map(async (item) => {
      const [c, q] = await Promise.all([
        repo.getContentById(item.contentRevisionId),
        item.questionSetId ? repo.getQuestionSetById(item.questionSetId) : Promise.resolve(null)
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
        questionSetId: item.questionSetId ? item.questionSetId.toHexString() : null,
        questionSetLabel: q?.label ?? null,
        questionRevision: q?.revision ?? null,
        validation: await packageService.checklist(item),
        rawContent: c?.rawContent ?? '',
        v2Content: c?.v2Content ?? item.v2Content ?? '',
        aiSource: item.aiSource ?? null,
        questions: q?.questions ?? [],
        createdAt: item.createdAt.toISOString(),
        publishedAt: item.publishedAt?.toISOString() ?? null
      };
    })
  );

  return (
    <div className="stack">
      <div className="admin-page-header">
        <div>
          <h1>Bộ nội dung thực nghiệm</h1>
          <p className="help">
            Quản lý bài đọc V1/V2 và trạng thái xuất bản bài đọc nghiên cứu.
          </p>
        </div>
      </div>
      <PackageManager
        items={items}
        canEdit={admin?.role === 'RESEARCHER'}
      />
    </div>
  );
}
