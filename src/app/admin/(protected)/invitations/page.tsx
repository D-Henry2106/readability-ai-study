import type { Metadata } from 'next';
import { getAdminSession } from '@/lib/auth/admin-session';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { StudyRunService } from '@/lib/services/study-run.service';
import { InvitationManager } from '@/components/admin/InvitationManager';
export const metadata: Metadata = { title: 'Link thử / Invitation', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const admin = await getAdminSession();
  if (!admin) return null;
  const [runs, locks] = await Promise.all([new StudyRunService().list({ username: admin.username, role: admin.role }), new ResearchRepository().getVariantLocks()]);
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return <div className="stack">
    <div><h1>Link thử / Quản lý Invitation</h1><p className="help">Chọn V1 hoặc V2 rồi phát link. Phiên bản và bộ câu hỏi được ghim vào invitation lúc phát; đổi lựa chọn sau đó không ảnh hưởng link đã phát.</p></div>
    <InvitationManager
      canEdit={admin.role === 'RESEARCHER'}
      runs={runs.map((r) => ({ _id: r._id!.toHexString(), code: r.code, status: r.status }))}
      initialLocks={{ V1: { ...locks.V1, changedAt: iso(locks.V1.changedAt) }, V2: { ...locks.V2, changedAt: iso(locks.V2.changedAt) } }}
    />
  </div>;
}
