import type { Metadata } from 'next';
import Link from 'next/link';
import { ActivityLogService } from '@/lib/services/activity-log.service';

export const metadata: Metadata = { title: 'Nhật ký hoạt động', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const when = (d: Date) => new Date(d).toLocaleString('vi-VN');

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const showParticipants = tab === 'participants';
  const service = new ActivityLogService();
  const adminRows = showParticipants ? [] : await service.adminActions();
  const participantRows = showParticipants ? await service.participantActions() : [];

  return (
    <div className="stack">
      <div className="admin-page-header">
        <h1>Nhật ký hoạt động</h1>
        <p className="help">
          Ghi lại ai đã làm gì và vào lúc nào. Hiển thị 200 dòng mới nhất. Nhật ký chỉ để xem, không thể sửa hay xóa.
        </p>
      </div>

      <nav className="tabs" aria-label="Loại nhật ký">
        <Link href="/admin/activity" className={showParticipants ? 'tab' : 'tab is-active'} aria-current={showParticipants ? undefined : 'page'}>
          Thao tác của quản trị viên
        </Link>
        <Link
          href="/admin/activity?tab=participants"
          className={showParticipants ? 'tab is-active' : 'tab'}
          aria-current={showParticipants ? 'page' : undefined}
        >
          Thao tác của người tham gia
        </Link>
      </nav>

      <section className="card table-wrap">
        {showParticipants ? (
          <table>
            <thead>
              <tr>
                <th>Thời gian</th>
                <th>Mã phiên</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {participantRows.map((r) => (
                <tr key={r.id}>
                  <td>{when(r.at)}</td>
                  <td>
                    <Link href={`/admin/sessions/${r.sessionId}`}>{r.sessionId.slice(0, 12)}…</Link>
                  </td>
                  <td>{r.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Thời gian</th>
                <th>Người thực hiện</th>
                <th>Hành động</th>
                <th>Đối tượng</th>
              </tr>
            </thead>
            <tbody>
              {adminRows.map((r) => (
                <tr key={r.id}>
                  <td>{when(r.at)}</td>
                  <td>{r.who}</td>
                  <td>{r.action}</td>
                  <td>{r.target}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {(showParticipants ? participantRows : adminRows).length === 0 ? (
          <p className="help">Chưa có hoạt động nào được ghi lại.</p>
        ) : null}
      </section>
    </div>
  );
}
