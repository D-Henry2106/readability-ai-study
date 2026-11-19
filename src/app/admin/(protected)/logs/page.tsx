import type { Metadata } from 'next';
import Link from 'next/link';
import { getAdminSession } from '@/lib/auth/admin-session';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { RunOverviewService } from '@/lib/services/run-overview.service';
import { ActivityLogService, PARTICIPANT_EVENT_LABEL } from '@/lib/services/activity-log.service';
import { LOG_PAGE_SIZE, ResearchLogService, type LogFilters } from '@/lib/services/research-log.service';

export const metadata: Metadata = { title: 'Nhật ký nghiên cứu', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type Params = Record<string, string | string[] | undefined>;
const VIEWS = [
  ['events', 'Sự kiện'],
  ['results', 'Kết quả'],
  ['reconcile', 'Đối chiếu file xuất'],
  ['admin', 'Thao tác quản trị']
] as const;
const when = (d: Date | null | undefined) => (d ? new Date(d).toLocaleString('vi-VN') : '—');

export default async function Page({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const get = (k: string) => (typeof params[k] === 'string' ? String(params[k]).trim() : '');
  const admin = await getAdminSession();
  const isResearcher = admin?.role === 'RESEARCHER';

  const repo = new ResearchRepository();
  const activePhase = (await repo.getConfig()).phase;
  const view = VIEWS.find(([id]) => id === get('view'))?.[0] ?? 'events';
  const filters: LogFilters = {
    phase: get('phase') === 'PILOT' || get('phase') === 'MAIN' ? (get('phase') as 'PILOT' | 'MAIN') : activePhase,
    participant: get('participant') || undefined,
    session: get('session') || undefined,
    variant: get('variant') === 'V1' || get('variant') === 'V2' ? (get('variant') as 'V1' | 'V2') : undefined,
    task: get('task') || undefined,
    run: /^[0-9a-fA-F]{24}$/.test(get('run')) ? get('run') : undefined,
    eventType: get('eventType') in PARTICIPANT_EVENT_LABEL ? get('eventType') : undefined
  };
  const page = Math.max(1, Math.min(100000, Number(get('page')) || 1));
  const runs = await new RunOverviewService().list();
  const service = new ResearchLogService();

  const query = (extra: Record<string, string>) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries({
      view, phase: filters.phase, participant: filters.participant ?? '', session: filters.session ?? '', variant: filters.variant ?? '',
      task: filters.task ?? '', run: filters.run ?? '', eventType: filters.eventType ?? '', ...extra
    })) if (value) q.set(key, value);
    return `?${q.toString()}`;
  };

  const events = view === 'events' ? await service.events(filters, page) : null;
  const results = view === 'results' ? await service.results(filters, page) : null;
  const report = view === 'reconcile' && isResearcher ? await service.reconcile(filters) : null;
  const adminRows = view === 'admin' ? await new ActivityLogService().adminActions() : null;
  const total = events?.total ?? results?.total ?? 0;

  const exportBase = new URLSearchParams({ phase: filters.phase, ...(filters.variant ? { variant: filters.variant } : {}), ...(filters.run ? { studyRunId: filters.run } : {}) });

  return (
    <div className="stack">
      <div className="admin-page-header">
        <h1>Nhật ký nghiên cứu</h1>
        <p className="help">
          Xem người tham gia đã làm gì, khi nào và kết quả ra sao. Mã người tham gia là mã ẩn danh, hệ thống không lưu tên hay email.
        </p>
      </div>

      <nav className="tabs" aria-label="Loại nhật ký">
        {VIEWS.map(([id, label]) => (
          <Link key={id} href={query({ view: id, page: '' })} className={id === view ? 'tab is-active' : 'tab'} aria-current={id === view ? 'page' : undefined}>
            {label}
          </Link>
        ))}
      </nav>

      {view !== 'admin' ? (
        <form className="card row" method="get">
          <input type="hidden" name="view" value={view} />
          <select name="phase" aria-label="Giai đoạn" defaultValue={filters.phase}>
            <option value="MAIN">MAIN (chính thức)</option>
            <option value="PILOT">PILOT (thử nghiệm)</option>
          </select>
          <select name="run" aria-label="Đợt nghiên cứu" defaultValue={filters.run ?? ''}>
            <option value="">Mọi đợt</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>{r.code} · {r.name}</option>
            ))}
          </select>
          <select name="variant" aria-label="Phiên bản bài đọc" defaultValue={filters.variant ?? ''}>
            <option value="">V1 và V2</option>
            <option value="V1">V1</option>
            <option value="V2">V2</option>
          </select>
          <input name="task" aria-label="Mã bài đọc" placeholder="Mã bài đọc" defaultValue={filters.task ?? ''} />
          <input name="participant" aria-label="Mã người tham gia" placeholder="Mã người tham gia" defaultValue={filters.participant ?? ''} />
          <input name="session" aria-label="Mã phiên" placeholder="Mã phiên" defaultValue={filters.session ?? ''} />
          {view === 'events' ? (
            <select name="eventType" aria-label="Loại sự kiện" defaultValue={filters.eventType ?? ''}>
              <option value="">Mọi sự kiện</option>
              {Object.entries(PARTICIPANT_EVENT_LABEL).map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          ) : null}
          <button className="btn btn-primary" type="submit">Lọc</button>
          <Link className="btn btn-secondary" href={`?view=${view}`}>Xóa bộ lọc</Link>
        </form>
      ) : null}

      {events ? (
        <section className="card table-wrap">
          <table>
            <thead>
              <tr><th>Thời gian</th><th>Người tham gia</th><th>Phiên</th><th>Bản</th><th>Bài đọc</th><th>Sự kiện</th></tr>
            </thead>
            <tbody>
              {events.rows.map((e) => (
                <tr key={e.id}>
                  <td>{when(e.at)}</td>
                  <td>{e.participantId ?? '—'}</td>
                  <td><Link href={`/admin/sessions/${e.sessionId}`}>{e.sessionId.slice(0, 12)}…</Link></td>
                  <td>{e.variant ?? '—'}</td>
                  <td>{e.task ?? '—'}</td>
                  <td>{PARTICIPANT_EVENT_LABEL[e.type] ?? e.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {events.rows.length === 0 ? <p className="help">Chưa có sự kiện nào phù hợp với bộ lọc.</p> : null}
        </section>
      ) : null}

      {results ? (
        <section className="card table-wrap">
          <table>
            <thead>
              <tr><th>Người tham gia</th><th>Phiên</th><th>Bản</th><th>Bài đọc</th><th>Trạng thái</th><th>Hợp lệ</th><th>Bắt đầu đọc</th><th>Kết thúc đọc</th><th>Giây đọc</th><th>Nộp bài</th><th>Điểm</th></tr>
            </thead>
            <tbody>
              {results.rows.map((r) => (
                <tr key={r.sessionId}>
                  <td>{r.participantId ?? '—'}</td>
                  <td><Link href={`/admin/sessions/${r.sessionId}`}>{r.sessionId.slice(0, 12)}…</Link></td>
                  <td>{r.variant ?? '—'}</td>
                  <td>{r.task ?? '—'}</td>
                  <td>{r.status}</td>
                  <td>{r.validity}</td>
                  <td>{when(r.readStart)}</td>
                  <td>{when(r.readEnd)}</td>
                  <td>{r.readingSeconds ?? '—'}</td>
                  <td>{when(r.testSubmittedAt)}</td>
                  <td>{r.score === null ? '—' : `${r.score}/${r.scoreMax}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {results.rows.length === 0 ? <p className="help">Chưa có phiên nào phù hợp với bộ lọc.</p> : null}
        </section>
      ) : null}

      {events || results ? (
        <div className="space-between">
          <span className="help">Tổng {total} dòng</span>
          <div className="row">
            {isResearcher ? (
              <>
                <a className="btn btn-secondary" href={`/api/admin/export?${new URLSearchParams({ format: 'run', ...Object.fromEntries(exportBase) })}`}>Tải kết quả (CSV)</a>
                <a className="btn btn-secondary" href={`/api/admin/export?${new URLSearchParams({ format: 'events', ...Object.fromEntries(exportBase) })}`}>Tải sự kiện (CSV)</a>
              </>
            ) : (
              <span className="help">Chỉ nhà nghiên cứu được tải dữ liệu.</span>
            )}
            {page > 1 ? <Link className="btn btn-secondary" href={query({ page: String(page - 1) })}>Trước</Link> : null}
            {page * LOG_PAGE_SIZE < total ? <Link className="btn btn-secondary" href={query({ page: String(page + 1) })}>Tiếp</Link> : null}
          </div>
        </div>
      ) : null}

      {view === 'reconcile' && !isResearcher ? (
        <section className="card"><p>Chỉ nhà nghiên cứu được đối chiếu file xuất.</p></section>
      ) : null}

      {report ? (
        <section className="card stack">
          <div>
            <h2>Đối chiếu file xuất với dữ liệu hệ thống</h2>
            <p className="help">Phạm vi: {report.scope}. Hệ thống tạo lại file xuất, đọc lại từng dòng và so với dữ liệu gốc.</p>
          </div>
          <div className="metric-grid">
            <div className="metric"><span className="help">Phiên trong hệ thống</span><strong>{report.systemSessions}</strong></div>
            <div className="metric"><span className="help">Dòng trong file xuất</span><strong>{report.exportRows}</strong></div>
            <div className="metric"><span className="help">Phiên đã hoàn thành</span><strong>{report.completedSessions}</strong></div>
            <div className="metric"><span className="help">Ô dữ liệu không khớp</span><strong>{report.mismatches.length}</strong></div>
          </div>
          <ul className="readiness-list">
            <li>{report.systemSessions === report.exportRows ? 'Khớp' : 'Lệch'}: số dòng file xuất so với số phiên.</li>
            <li>{report.mismatches.length === 0 ? 'Khớp' : 'Lệch'}: bản, trạng thái, điểm, giờ bắt đầu và kết thúc đọc, giờ nộp bài ({report.mismatches.length} chỗ lệch).</li>
            <li>{report.scoreRecalcMismatches.length === 0 ? 'Khớp' : 'Lệch'}: điểm lưu so với điểm tính lại từ từng câu trả lời ({report.scoreRecalcMismatches.length} phiên lệch).</li>
            <li>{report.timeOrderIssues.length === 0 ? 'Đúng' : 'Sai'} thứ tự thời gian đọc rồi nộp bài ({report.timeOrderIssues.length} phiên lỗi).</li>
            <li>{report.incompleteEventTrails.length === 0 ? 'Đủ' : 'Thiếu'} sự kiện của phiên đã hoàn thành ({report.incompleteEventTrails.length} phiên thiếu).</li>
          </ul>
          {report.mismatches.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Phiên</th><th>Cột</th><th>Hệ thống</th><th>File xuất</th></tr></thead>
                <tbody>
                  {report.mismatches.slice(0, 50).map((m, i) => (
                    <tr key={`${m.sessionId}-${m.field}-${i}`}><td>{m.sessionId.slice(0, 12)}…</td><td>{m.field}</td><td>{m.system}</td><td>{m.exported}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {[...report.scoreRecalcMismatches, ...report.timeOrderIssues, ...report.incompleteEventTrails.map((t) => `${t.sessionId}: thiếu ${t.missing.join(', ')}`)].slice(0, 30).map((line) => (
            <p className="help" key={line}>{line}</p>
          ))}
        </section>
      ) : null}

      {adminRows ? (
        <section className="card table-wrap">
          <table>
            <thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Hành động</th><th>Đối tượng</th></tr></thead>
            <tbody>
              {adminRows.map((r) => (
                <tr key={r.id}><td>{when(r.at)}</td><td>{r.who}</td><td>{r.action}</td><td>{r.target}</td></tr>
              ))}
            </tbody>
          </table>
          {adminRows.length === 0 ? <p className="help">Chưa có thao tác quản trị nào được ghi lại.</p> : null}
        </section>
      ) : null}
    </div>
  );
}
