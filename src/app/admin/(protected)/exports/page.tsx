import type { Metadata } from 'next';
import { getAdminSession } from '@/lib/auth/admin-session';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { StudyRunRepository } from '@/lib/repositories/study-run.repository';

export const metadata: Metadata = { title: 'Xuất dữ liệu / Exports', robots: { index: false, follow: false } };

const RUN_STATUS_LABEL: Record<string, string> = { DRAFT: 'Bản nháp', OPEN: 'Đang mở', PAUSED: 'Tạm dừng', CLOSED: 'Đã đóng' };

export default async function Page() {
  const admin = await getAdminSession();
  const canExport = admin?.role === 'RESEARCHER';
  const repo = new ResearchRepository();
  const [currentConfig, runs] = await Promise.all([
    repo.getConfig(),
    new StudyRunRepository().list()
  ]);
  const currentPhase = currentConfig.phase;
  const otherPhase = currentPhase === 'MAIN' ? 'PILOT' : 'MAIN';
  const runUrl = (format: string, runId: string, phase: string, variant: 'V1' | 'V2') =>
    `/api/admin/export?format=${format}&variant=${variant}&studyRunId=${runId}&phase=${phase}`;

  return (
    <div className="stack">
      <div>
        <h1>Xuất dữ liệu nghiên cứu (CSV)</h1>
        <p className="help">
          Mỗi file chỉ chứa người tham gia của một nhóm (V1 hoặc V2) trong một đợt nghiên cứu. Chỉ xuất dữ liệu thực tế từ hệ thống.
        </p>
      </div>

      {canExport ? (
        <>
          <section className="card stack">
            <div>
              <h2>Kết quả theo từng đợt nghiên cứu</h2>
              <p className="help">
                File chính: mỗi người tham gia một dòng, gồm điểm, thời gian đọc, mức cuộn và thông tin nhân khẩu học. Mở phần
                &ldquo;Chi tiết&rdquo; nếu cần dữ liệu từng câu hỏi hoặc từng sự kiện.
              </p>
            </div>

            {runs.length === 0 ? (
              <p className="help">Chưa có đợt nghiên cứu nào để xuất.</p>
            ) : (
              <div className="stack-sm">
                {runs.map((r) => {
                  const id = r._id!.toHexString();
                  return (
                    <div key={id} style={{ padding: '10px 0', borderBottom: '1px solid rgba(128,128,128,0.2)' }}>
                      <div className="space-between">
                        <div>
                          <strong>{r.code}</strong> &mdash; {r.name}{' '}
                          <span className="badge">{RUN_STATUS_LABEL[r.status] ?? r.status}</span>{' '}
                          <span className="badge">{r.phase}</span>
                        </div>
                        <div className="row" style={{ gap: 8 }}>
                          <a className="btn btn-secondary" href={runUrl('run', id, r.phase, 'V1')}>
                            Tải V1 ({r.arms?.V1?.validIncluded ?? 0} hợp lệ)
                          </a>
                          <a className="btn btn-primary" href={runUrl('run', id, r.phase, 'V2')}>
                            Tải V2 ({r.arms?.V2?.validIncluded ?? 0} hợp lệ)
                          </a>
                        </div>
                      </div>
                      <details style={{ marginTop: 8 }}>
                        <summary style={{ cursor: 'pointer' }}>Chi tiết: từng câu hỏi và từng sự kiện</summary>
                        <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                          <a className="btn btn-secondary btn-small" href={runUrl('questions', id, r.phase, 'V1')}>Câu trả lời V1</a>
                          <a className="btn btn-secondary btn-small" href={runUrl('questions', id, r.phase, 'V2')}>Câu trả lời V2</a>
                          <a className="btn btn-secondary btn-small" href={runUrl('events', id, r.phase, 'V1')}>Sự kiện V1</a>
                          <a className="btn btn-secondary btn-small" href={runUrl('events', id, r.phase, 'V2')}>Sự kiện V2</a>
                        </div>
                        <p className="help" style={{ marginTop: 6 }}>
                          Câu trả lời: mỗi câu hỏi một dòng. Sự kiện: nhật ký các bước người tham gia đã đi qua (không ghi phím bấm).
                        </p>
                      </details>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <details className="card stack">
            <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>Nâng cao và dữ liệu của thiết kế cũ</summary>
            <div className="stack" style={{ marginTop: 12 }}>
              <div className="stack-sm">
                <strong>Gộp mọi đợt trong một giai đoạn</strong>
                <p className="help">Mỗi file gộp tất cả các đợt của giai đoạn, vẫn tách riêng V1 và V2.</p>
                <div className="row">
                  {(['MAIN', 'PILOT'] as const).flatMap((phase) =>
                    (['V1', 'V2'] as const).map((variant) => (
                      <a
                        key={`${phase}-${variant}`}
                        className={variant === 'V1' ? 'btn btn-secondary' : 'btn btn-primary'}
                        href={`/api/admin/export?format=run&variant=${variant}&phase=${phase}`}
                      >
                        {variant} &mdash; {phase}
                      </a>
                    ))
                  )}
                </div>
              </div>

              <div className="stack-sm">
                <strong>Câu trả lời và sự kiện theo giai đoạn (gồm cả phiên cũ)</strong>
                <div className="row">
                  <a className="btn btn-secondary" href="/api/admin/export?format=questions&phase=MAIN">Câu trả lời &mdash; MAIN</a>
                  <a className="btn btn-secondary" href="/api/admin/export?format=events&phase=MAIN">Sự kiện &mdash; MAIN</a>
                  <a className="btn btn-secondary" href="/api/admin/export?format=questions&phase=PILOT">Câu trả lời &mdash; PILOT</a>
                  <a className="btn btn-secondary" href="/api/admin/export?format=events&phase=PILOT">Sự kiện &mdash; PILOT</a>
                </div>
              </div>

              <div className="stack-sm">
                <strong>Dạng rộng (wide) &mdash; thiết kế 2 lượt cũ</strong>
                <div className="row">
                  <a className="btn btn-secondary" href={`/api/admin/export?format=wide&phase=${currentPhase}`}>Tải CSV rộng &mdash; {currentPhase}</a>
                  <a className="btn btn-secondary" href={`/api/admin/export?format=wide&phase=${otherPhase}`}>Tải CSV rộng &mdash; {otherPhase}</a>
                </div>
              </div>

              <div className="stack-sm">
                <strong>Dữ liệu cặp (thiết kế 2 lượt crossover cũ)</strong>
                <p className="help">Chỉ xuất các cặp đã hoàn thành và được đánh dấu hợp lệ theo quy trình 2 lượt cũ.</p>
                <div className="row">
                  <a className="btn btn-secondary" href="/api/admin/export?format=paired&phase=MAIN">Tải dữ liệu cặp &mdash; MAIN</a>
                  <a className="btn btn-secondary" href="/api/admin/export?format=paired&phase=PILOT">Tải dữ liệu cặp &mdash; PILOT</a>
                </div>
              </div>
            </div>
          </details>
        </>
      ) : (
        <section className="card">
          <p>Người giám sát chỉ được xem. Chỉ nhà nghiên cứu có quyền xuất dữ liệu.</p>
        </section>
      )}
    </div>
  );
}
