import type { Metadata } from 'next';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { StudyRunRepository } from '@/lib/repositories/study-run.repository';
import { AnalysisService } from '@/lib/services/analysis.service';
import { parseResearchFilters } from '@/lib/services/research-filters';

export const metadata: Metadata = { title: 'Thống kê nghiên cứu V1/V2', robots: { index: false, follow: false } };
const display = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toFixed(2));
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toFixed(1)}%`);

export default async function StatisticsPage({
  searchParams
}: {
  searchParams: Promise<{ phase?: string; group?: string; package?: string; revision?: string; studyRunId?: string }>;
}) {
  const query = await searchParams;
  const repo = new ResearchRepository();
  const current = await repo.getConfig();
  const phase = query.phase === 'PILOT' || query.phase === 'MAIN' ? query.phase : current.phase;
  const filters = parseResearchFilters(query);

  const [runs, overviewData] = await Promise.all([
    new StudyRunRepository().list(),
    new AnalysisService(repo).overview(phase, filters)
  ]);

  const { counts, variants: v, legacy: a } = overviewData;

  return (
    <div className="stack">
      <div className="space-between">
        <div>
          <h1 style={{ margin: 0 }}>Thống kê nghiên cứu & So sánh V1 / V2</h1>
          <p className="help">
            Mô hình khảo sát giữa hai nhóm độc lập (Between-Subjects): V1 (Standard AI Output) đối chiếu V2 (Accessible AI Output). Cả hai nhóm dùng chung một bộ 15 câu hỏi.
          </p>
        </div>
      </div>

      {/* Filter Form */}
      <form className="card row" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <label className="field">
          <span>Giai đoạn</span>
          <select name="phase" defaultValue={phase}>
            <option value="MAIN">MAIN — Chính thức</option>
            <option value="PILOT">PILOT — Thử nghiệm</option>
          </select>
        </label>
        <label className="field">
          <span>Lọc theo Study Run</span>
          <select name="studyRunId" defaultValue={filters.studyRunId ?? ''}>
            <option value="">Tất cả Study Run</option>
            {runs.map((r) => (
              <option key={r._id!.toHexString()} value={r._id!.toHexString()}>
                {r.code} — {r.name} ({r.phase})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Mã Package</span>
          <input name="package" defaultValue={filters.packageCode ?? ''} placeholder="Mã bộ nội dung" />
        </label>
        <label className="field">
          <span>Revision</span>
          <input name="revision" type="number" min="1" step="1" defaultValue={filters.revision ?? ''} placeholder="Mọi revision" />
        </label>
        <button className="btn btn-primary" type="submit">
          Áp dụng bộ lọc
        </button>
      </form>

      {/* Quick Export Links */}
      <section className="card row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <strong>Xuất dữ liệu theo nhóm:</strong>
          <span className="help" style={{ marginLeft: 8 }}>Tải tập tin kết quả khảo sát của từng điều kiện trình bày.</span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <a className="btn btn-secondary" href={`/api/admin/export?format=run&variant=V1&phase=${phase}${filters.studyRunId ? `&studyRunId=${filters.studyRunId}` : ''}`}>
            Xuất CSV Nhóm V1
          </a>
          <a className="btn btn-primary" href={`/api/admin/export?format=run&variant=V2&phase=${phase}${filters.studyRunId ? `&studyRunId=${filters.studyRunId}` : ''}`}>
            Xuất CSV Nhóm V2
          </a>
        </div>
      </section>

      {/* V1 vs V2 Core Comparison Section */}
      <section className="card stack">
        <h2 style={{ margin: 0 }}>So sánh chỉ số chính giữa V1 và V2</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Chỉ số thực nghiệm</th>
                <th style={{ color: '#2b6cb0' }}>V1: Standard AI Output</th>
                <th style={{ color: '#6b46c1' }}>V2: Accessible AI Output</th>
                <th>Chênh lệch (V2 − V1)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Tổng số người tham gia bắt đầu</strong></td>
                <td>{v.v1.totalParticipants} người</td>
                <td>{v.v2.totalParticipants} người</td>
                <td>{v.v2.totalParticipants - v.v1.totalParticipants > 0 ? `+${v.v2.totalParticipants - v.v1.totalParticipants}` : v.v2.totalParticipants - v.v1.totalParticipants}</td>
              </tr>
              <tr>
                <td><strong>Số lượng hoàn thành (Completed)</strong></td>
                <td>{v.v1.completed} ({pct(v.v1.completionRate)})</td>
                <td>{v.v2.completed} ({pct(v.v2.completionRate)})</td>
                <td>
                  <strong style={{ color: v.diffCompletionRate >= 0 ? '#2f855a' : '#c53030' }}>
                    {v.diffCompletionRate >= 0 ? `+${v.diffCompletionRate.toFixed(1)}%` : `${v.diffCompletionRate.toFixed(1)}%`}
                  </strong>
                </td>
              </tr>
              <tr>
                <td><strong>Số lượng chưa hoàn thành / Rút lui</strong></td>
                <td>{v.v1.active + v.v1.withdrawn + v.v1.incomplete} (Đang làm: {v.v1.active}, Rút: {v.v1.withdrawn})</td>
                <td>{v.v2.active + v.v2.withdrawn + v.v2.incomplete} (Đang làm: {v.v2.active}, Rút: {v.v2.withdrawn})</td>
                <td>—</td>
              </tr>
              <tr>
                <td><strong>Số phiên được duyệt VALID</strong></td>
                <td>{v.v1.valid} (Chờ duyệt: {v.v1.pendingReview})</td>
                <td>{v.v2.valid} (Chờ duyệt: {v.v2.pendingReview})</td>
                <td>—</td>
              </tr>
              <tr style={{ background: 'rgba(66, 153, 225, 0.08)' }}>
                <td><strong>Điểm đọc hiểu trung bình (0–15)</strong></td>
                <td><strong>{display(v.v1.scoreStats.mean)} / 15</strong></td>
                <td><strong>{display(v.v2.scoreStats.mean)} / 15</strong></td>
                <td>
                  <strong style={{ fontSize: '1.1rem', color: v.diffMeanScore !== null && v.diffMeanScore >= 0 ? '#2f855a' : '#c53030' }}>
                    {v.diffMeanScore !== null ? (v.diffMeanScore >= 0 ? `+${v.diffMeanScore.toFixed(2)}` : v.diffMeanScore.toFixed(2)) : '—'}
                  </strong>
                </td>
              </tr>
              <tr>
                <td>Trung vị điểm số (Median)</td>
                <td>{display(v.v1.scoreStats.median)} / 15</td>
                <td>{display(v.v2.scoreStats.median)} / 15</td>
                <td>—</td>
              </tr>
              <tr>
                <td>Độ lệch chuẩn điểm số (Std Dev)</td>
                <td>{display(v.v1.scoreStats.standardDeviation)}</td>
                <td>{display(v.v2.scoreStats.standardDeviation)}</td>
                <td>—</td>
              </tr>
              <tr>
                <td><strong>Tỷ lệ trả lời đúng toàn bộ câu hỏi</strong></td>
                <td><strong>{pct(v.v1.overallAccuracy)}</strong></td>
                <td><strong>{pct(v.v2.overallAccuracy)}</strong></td>
                <td>
                  <strong style={{ color: v.diffOverallAccuracy >= 0 ? '#2f855a' : '#c53030' }}>
                    {v.diffOverallAccuracy >= 0 ? `+${v.diffOverallAccuracy.toFixed(1)}%` : `${v.diffOverallAccuracy.toFixed(1)}%`}
                  </strong>
                </td>
              </tr>
              <tr>
                <td><strong>Thời gian đọc bài trung bình</strong></td>
                <td>{display(v.v1.readingTimeStats.mean)} giây</td>
                <td>{display(v.v2.readingTimeStats.mean)} giây</td>
                <td>{v.diffMeanReadingTime !== null ? `${v.diffMeanReadingTime >= 0 ? `+${v.diffMeanReadingTime.toFixed(1)}` : v.diffMeanReadingTime.toFixed(1)}s` : '—'}</td>
              </tr>
              <tr>
                <td><strong>Thời gian trả lời quiz trung bình</strong></td>
                <td>{display(v.v1.quizTimeStats.mean)} giây</td>
                <td>{display(v.v2.quizTimeStats.mean)} giây</td>
                <td>{v.diffMeanQuizTime !== null ? `${v.diffMeanQuizTime >= 0 ? `+${v.diffMeanQuizTime.toFixed(1)}` : v.diffMeanQuizTime.toFixed(1)}s` : '—'}</td>
              </tr>
              <tr>
                <td><strong>Tổng thời gian làm khảo sát</strong></td>
                <td>{display(v.v1.totalTimeStats.mean)} giây</td>
                <td>{display(v.v2.totalTimeStats.mean)} giây</td>
                <td>{v.diffMeanTotalTime !== null ? `${v.diffMeanTotalTime >= 0 ? `+${v.diffMeanTotalTime.toFixed(1)}` : v.diffMeanTotalTime.toFixed(1)}s` : '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Per-Question Accuracy Breakdown (15 Questions) */}
      <section className="card stack">
        <div className="space-between">
          <div>
            <h2 style={{ margin: 0 }}>Thống kê chi tiết theo từng câu hỏi (15 câu)</h2>
            <p className="help">So sánh tỷ lệ trả lời đúng giữa V1 và V2 cho từng câu hỏi thuộc cùng một bộ đề khảo sát chung.</p>
          </div>
        </div>
        {v.questions.length === 0 ? (
          <p className="help">Chưa có dữ liệu bài thi hoàn thành cho bộ câu hỏi.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nhóm năng lực</th>
                  <th>Nội dung câu hỏi</th>
                  <th>Đúng V1 / Tổng</th>
                  <th>Tỷ lệ V1</th>
                  <th>Đúng V2 / Tổng</th>
                  <th>Tỷ lệ V2</th>
                  <th>Hiệu quả V2 − V1</th>
                </tr>
              </thead>
              <tbody>
                {v.questions.map((q, idx) => (
                  <tr key={q.questionId}>
                    <td><strong>Câu {idx + 1}</strong></td>
                    <td><span className="badge">{q.category}</span></td>
                    <td style={{ maxWidth: 360 }}>{q.prompt}</td>
                    <td>{q.v1Correct} / {q.v1Total}</td>
                    <td><strong>{pct(q.v1Accuracy)}</strong></td>
                    <td>{q.v2Correct} / {q.v2Total}</td>
                    <td><strong>{pct(q.v2Accuracy)}</strong></td>
                    <td>
                      <span
                        style={{
                          fontWeight: 'bold',
                          color: q.diffAccuracy > 0 ? '#2f855a' : q.diffAccuracy < 0 ? '#c53030' : 'inherit'
                        }}
                      >
                        {q.diffAccuracy > 0 ? `+${q.diffAccuracy.toFixed(1)}%` : q.diffAccuracy < 0 ? `${q.diffAccuracy.toFixed(1)}%` : '0.0%'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Score Distribution Chart */}
      <section className="card stack">
        <h2 style={{ margin: 0 }}>Phân bố điểm số (Thang điểm 0–15)</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Điểm số</th>
                <th>Số người đạt (V1)</th>
                <th>Biểu đồ V1</th>
                <th>Số người đạt (V2)</th>
                <th>Biểu đồ V2</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 16 }, (_, score) => {
                const countV1 = v.v1.scoreDistribution[score] ?? 0;
                const countV2 = v.v2.scoreDistribution[score] ?? 0;
                const pctV1 = v.v1.completed > 0 ? (countV1 / v.v1.completed) * 100 : 0;
                const pctV2 = v.v2.completed > 0 ? (countV2 / v.v2.completed) * 100 : 0;
                return (
                  <tr key={score}>
                    <td><strong>{score} điểm</strong></td>
                    <td>{countV1}</td>
                    <td style={{ minWidth: 160 }}>
                      <div className="chart-track" role="img" aria-label={`V1: ${countV1} người`}>
                        <span style={{ width: `${pctV1}%`, background: '#3182ce' }} />
                      </div>
                    </td>
                    <td>{countV2}</td>
                    <td style={{ minWidth: 160 }}>
                      <div className="chart-track" role="img" aria-label={`V2: ${countV2} người`}>
                        <span style={{ width: `${pctV2}%`, background: '#805ad5' }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Legacy Historical Data Section (Protected & Separated) */}
      <details className="card stack">
        <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>
          Xem dữ liệu lịch sử của luồng cũ (Thiết kế chéo 2 lượt AB/BA)
        </summary>
        <div className="stack" style={{ marginTop: 16 }}>
          <p className="help">
            Các số liệu dưới đây chỉ áp dụng cho dữ liệu cũ thực hiện theo quy trình 2 lượt đọc chéo. Dữ liệu này được nhận diện riêng và không trộn lẫn vào kết quả thực nghiệm V1/V2 mới.
          </p>
          <div className="metric-grid">
            <div className="metric"><span className="help">Cặp hoàn thành</span><strong>{a.completedPairs}</strong></div>
            <div className="metric"><span className="help">Cặp hợp lệ</span><strong>{a.validPairs}</strong></div>
            <div className="metric"><span className="help">Điểm TB V1 (lượt cũ)</span><strong>{display(a.v1.mean)}</strong></div>
            <div className="metric"><span className="help">Điểm TB V2 (lượt cũ)</span><strong>{display(a.v2.mean)}</strong></div>
            <div className="metric"><span className="help">Chênh lệch TB</span><strong>{display(a.differences.mean)}</strong></div>
            <div className="metric"><span className="help">Nhóm A</span><strong>{a.groupA}</strong></div>
            <div className="metric"><span className="help">Nhóm B</span><strong>{a.groupB}</strong></div>
          </div>
        </div>
      </details>
    </div>
  );
}
