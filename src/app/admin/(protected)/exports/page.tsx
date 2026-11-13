import type { Metadata } from 'next';
import { getAdminSession } from '@/lib/auth/admin-session';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { StudyRunRepository } from '@/lib/repositories/study-run.repository';

export const metadata: Metadata = { title: 'Xuất dữ liệu / Exports', robots: { index: false, follow: false } };

export default async function Page() {
  const admin = await getAdminSession();
  const canExport = admin?.role === 'RESEARCHER';
  const repo = new ResearchRepository();
  const [currentConfig, runs] = await Promise.all([
    repo.getConfig(),
    new StudyRunRepository().list()
  ]);
  const currentPhase = currentConfig.phase;

  return (
    <div className="stack">
      <div>
        <h1>Xuất dữ liệu nghiên cứu (CSV)</h1>
        <p className="help">Giai đoạn cấu hình: {currentPhase} · Bạn có thể chọn xuất theo từng Study Run hoặc toàn bộ giai đoạn.</p>
        <p className="help">Dữ liệu phân biệt rõ hai nhóm V1 (Standard AI Output) và V2 (Accessible AI Output). Chỉ xuất dữ liệu thực tế từ hệ thống.</p>
      </div>

      {canExport ? (
        <>
          {runs.length > 0 ? (
            <section className="card stack">
              <h2>Xuất theo Study Run (Khuyến nghị cho P5)</h2>
              <p className="help">Tải tập tin kết quả của từng đợt triển khai, tách biệt theo nhánh V1 hoặc V2.</p>
              <div className="stack-sm">
                {runs.map((r) => (
                  <div key={r._id!.toHexString()} className="space-between" style={{ padding: '8px 0', borderBottom: '1px solid rgba(128,128,128,0.2)' }}>
                    <div>
                      <strong>{r.code}</strong> — {r.name} <span className="badge">{r.status}</span> <span className="badge">{r.phase}</span>
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <a className="btn btn-secondary" href={`/api/admin/export?format=run&variant=V1&studyRunId=${r._id!.toHexString()}&phase=${r.phase}`}>
                        Tải V1 ({r.arms?.V1?.validIncluded ?? 0} valid)
                      </a>
                      <a className="btn btn-primary" href={`/api/admin/export?format=run&variant=V2&studyRunId=${r._id!.toHexString()}&phase=${r.phase}`}>
                        Tải V2 ({r.arms?.V2?.validIncluded ?? 0} valid)
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="card stack">
            <h2>Study Run toàn giai đoạn — V1 và V2 tách riêng</h2>
            <p className="help">Mỗi file chỉ chứa người tham gia của đúng một phiên bản (theo invitation), kèm điểm / điểm tối đa, bộ câu hỏi và revision.</p>
            <div className="row">
              {(['MAIN', 'PILOT'] as const).flatMap((phase) =>
                (['V1', 'V2'] as const).map((variant) => (
                  <a
                    key={`${phase}-${variant}`}
                    className={variant === 'V1' ? 'btn btn-secondary' : 'btn btn-primary'}
                    href={`/api/admin/export?format=run&variant=${variant}&phase=${phase}`}
                  >
                    {variant} — {phase}
                  </a>
                ))
              )}
            </div>
          </section>

          <section className="card stack">
            <h2>Dữ liệu câu trả lời và sự kiện chi tiết</h2>
            <p className="help">Dữ liệu câu hỏi gồm mã phiên bản và điểm. Log chỉ có sự kiện được phép, không ghi phím bấm.</p>
            <div className="row">
              <a className="btn btn-primary" href="/api/admin/export?format=questions&phase=MAIN">Câu trả lời — MAIN</a>
              <a className="btn btn-secondary" href="/api/admin/export?format=events&phase=MAIN">Sự kiện — MAIN</a>
              <a className="btn btn-secondary" href="/api/admin/export?format=questions&phase=PILOT">Câu trả lời — PILOT</a>
              <a className="btn btn-secondary" href="/api/admin/export?format=events&phase=PILOT">Sự kiện — PILOT</a>
            </div>
          </section>

          <section className="card stack">
            <h2>Dữ liệu tổng hợp dạng rộng (Wide format)</h2>
            <div className="row">
              <a className="btn btn-primary" href={`/api/admin/export?format=wide&phase=${currentPhase}`}>Tải CSV rộng — {currentPhase}</a>
              <a className="btn btn-secondary" href={`/api/admin/export?format=wide&phase=${currentPhase === 'MAIN' ? 'PILOT' : 'MAIN'}`}>Tải CSV rộng — {currentPhase === 'MAIN' ? 'PILOT' : 'MAIN'}</a>
            </div>
          </section>

          <details className="card stack">
            <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>Dữ liệu cặp lịch sử (Thiết kế 2 lượt cũ)</summary>
            <div className="stack" style={{ marginTop: 12 }}>
              <p className="help">Chỉ xuất các cặp đã hoàn thành, được đánh dấu hợp lệ theo quy trình 2 lượt crossover cũ.</p>
              <div className="row">
                <a className="btn btn-secondary" href="/api/admin/export?format=paired&phase=MAIN">Tải dữ liệu cặp — MAIN</a>
                <a className="btn btn-secondary" href="/api/admin/export?format=paired&phase=PILOT">Tải dữ liệu cặp — PILOT</a>
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
