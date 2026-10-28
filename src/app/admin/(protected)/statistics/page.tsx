import { ResearchRepository } from '@/lib/repositories/research.repository';
import type { Metadata } from 'next';
import { AnalysisService } from '@/lib/services/analysis.service';
import { parseResearchFilters } from '@/lib/services/research-filters';
export const metadata: Metadata = { title: 'Thống kê nghiên cứu', robots: { index: false, follow: false } };
const display = (n: number | null) => n === null ? '—' : n.toFixed(2);
export default async function StatisticsPage({ searchParams }: { searchParams: Promise<{ phase?: string; group?: string; package?: string; revision?: string }> }) {
  const query = await searchParams;
  const current = await new ResearchRepository().getConfig();
  const phase = query.phase === 'PILOT' || query.phase === 'MAIN' ? query.phase : current.phase;
  const filters = parseResearchFilters(query);
  const { counts, analysis: a } = await new AnalysisService().overview(phase, filters);
  return <div className="stack">
    <h1>Thống kê mô tả — {phase}</h1><p className="help">Giai đoạn cấu hình: {current.phase} · Giai đoạn dữ liệu: {phase}</p>
    <p className="help">Chỉ tính cặp V1/V2 của phiên đã hoàn thành, đúng bộ câu hỏi đã khóa và được xác nhận hợp lệ. Không đưa ra kết luận ý nghĩa thống kê.</p>
    <form className="card row"><label className="field"><span>Tập dữ liệu</span><select name="phase" defaultValue={phase}><option>MAIN</option><option>PILOT</option></select></label><label className="field">Nhóm<select name="group" defaultValue={filters.group??''}><option value="">Cả hai</option><option>A</option><option>B</option></select></label>
    <label className="field">Mã Package<input name="package" defaultValue={filters.packageCode??''} placeholder="Mã bộ nội dung" /></label>
    <label className="field">Revision<input name="revision" type="number" min="1" step="1" defaultValue={filters.revision??''} /></label>
    <button className="btn btn-secondary">Áp dụng</button></form>
    <p className="help">Bộ lọc thống kê: {filters.group??'A+B'} · {filters.packageCode??'Mọi Package'} · revision {filters.revision??'tất cả'}. <a href={`/api/admin/export?${new URLSearchParams({format:'paired',phase,...(filters.group?{group:filters.group}:{}),...(filters.packageCode?{package:filters.packageCode}:{}),...(filters.revision?{revision:String(filters.revision)}:{})})}`}>Xuất CSV cặp cùng bộ lọc</a> (chỉ quyền Researcher).</p>
    {a.validPairs === 0 ? <section className="card" role="status"><h2>Chưa có dữ liệu cặp hợp lệ</h2><p>Không hiển thị kết luận hoặc điểm trung bình khi chưa có cặp được duyệt đầy đủ.</p></section> : null}
    {a.smallSample ? <div className="notice notice-warning" role="status">Mẫu phân tích nhỏ ({a.validPairs} cặp). Chỉ sử dụng thống kê mô tả; không kết luận V2 hiệu quả hơn.</div> : null}
    {a.mixedRevisions ? <div className="notice notice-warning" role="alert"><strong>Có nhiều phiên bản bài đọc hoặc câu hỏi.</strong> Hệ thống không gộp điểm của các phiên bản khác nhau; vui lòng xem bảng theo phiên bản.</div> : null}
    <section className="card stack"><h2>So sánh cặp theo phiên bản</h2><div className="table-wrap"><table><thead><tr><th>Mã revision bài đọc / câu hỏi</th><th>Số cặp</th><th>TB V1</th><th>TB V2</th><th>TB chênh lệch</th></tr></thead><tbody>{a.cohorts.map(c => <tr key={c.revisionIds}><td><code>{c.revisionIds}</code></td><td>{c.count}</td><td>{display(c.v1.mean)}</td><td>{display(c.v2.mean)}</td><td>{display(c.differences.mean)}</td></tr>)}</tbody></table></div></section>
    <section className="card stack"><h2>Phân tích theo Package và thứ tự V1/V2</h2>
    <p className="help">Số liệu mô tả từ cặp đủ điều kiện; từng Package revision được phân tách. Không diễn giải hiệu quả chung giữa các chủ đề khác nhau.</p>
    <div className="table-wrap"><table><thead><tr><th>Package / phiên bản</th><th>Nhóm</th><th>Số cặp</th><th>TB V1</th><th>TB V2</th><th>TB V2−V1</th></tr></thead><tbody>{a.cohorts.flatMap(cohort=>cohort.groups.map(group=><tr key={`${cohort.revisionIds}-${group.group}`}><td><code>{cohort.revisionIds}</code></td><td>{group.group}</td><td>{group.count}</td><td>{display(group.v1.mean)}</td><td>{display(group.v2.mean)}</td><td>{display(group.differences.mean)}</td></tr>))}</tbody></table></div></section>
    <section className="card stack"><h2>Trạng thái hoàn thành và xét duyệt</h2><div className="chart-rows">{([['Chưa xét duyệt',counts.review],['VALID',counts.valid],['INVALID',counts.invalid]] as const).map(([label,value])=><div key={label} className="chart-row"><span>{label} ({value})</span><div role="img" aria-label={`${label}: ${value} phiên`} className="chart-track"><span style={{width:`${counts.completed ? value / counts.completed * 100 : 0}%`}} /></div></div>)}</div></section>
    {!a.mixedRevisions && a.validPairs > 0 ? <section className="card stack"><h2>So sánh trung bình V1 / V2 (0–5)</h2>{([['V1',a.v1.mean],['V2',a.v2.mean]] as const).map(([label,value])=><div className="chart-row" key={label}><span>{label}: {display(value)}</span><div className="chart-track" role="img" aria-label={`${label}: ${display(value)} trên 5`}><span style={{width:`${value===null?0:value/5*100}%`}} /></div></div>)}</section> : null}
    <section className="metric-grid">
      {([
        ['Đã bắt đầu', counts.started], ['Đã đồng ý', counts.consented], ['Đang tham gia', counts.active], ['Đã hoàn thành', counts.completed],
        ['Đã rút lui', counts.withdrawn], ['Cặp đã hoàn thành', a.completedPairs], ['Cặp đủ điều kiện phân tích', a.validPairs],
        ['Tỷ lệ hoàn thành', counts.started ? `${(100 * counts.completed / counts.started).toFixed(1)}%` : '—'],
        ['Điểm TB V1 / 5', display(a.v1.mean)], ['Điểm TB V2 / 5', display(a.v2.mean)],
        ['TB chênh lệch V2 − V1', display(a.differences.mean)], ['Trung vị chênh lệch', display(a.differences.median)],
        ['Độ lệch chuẩn mẫu', display(a.differences.standardDeviation)], ['Chờ đánh giá', counts.review], ['Không hợp lệ', counts.invalid], ['Phiên bị đánh giá không hợp lệ', a.excludedCompleted],
        ['Nhóm A hợp lệ', a.groupA], ['Nhóm B hợp lệ', a.groupB]
      ] as Array<[string, number | string]>).map(([label, value]) => <div className="metric" key={label}><span className="help">{label}</span><strong>{value}</strong></div>)}
    </section>
    {!a.mixedRevisions && a.validPairs > 0 ? <section className="card stack"><h2>Phân bố điểm (cặp hợp lệ)</h2>
      <div className="table-wrap"><table><thead><tr><th>Điểm</th><th>V1</th><th>V2</th></tr></thead><tbody>{a.v1Distribution.map((n, i) => <tr key={i}><td>{i} / 5</td><td>{n}<div className="chart-track" aria-hidden="true"><span style={{width:`${a.validPairs?n/a.validPairs*100:0}%`}} /></div></td><td>{a.v2Distribution[i]}<div className="chart-track" aria-hidden="true"><span style={{width:`${a.validPairs?a.v2Distribution[i]/a.validPairs*100:0}%`}} /></div></td></tr>)}</tbody></table></div>
    </section> : null}
    {!a.mixedRevisions && a.validPairs > 0 ? <section className="card stack"><h2>Tỷ lệ đúng theo câu hỏi</h2><div className="table-wrap"><table><thead><tr><th>Cách trình bày</th><th>Câu hỏi</th><th>Số đúng / tổng</th><th>Tỷ lệ đúng</th></tr></thead><tbody>{a.questions.map((q) => <tr key={`${q.presentation}-${q.questionId}`}><td>{q.presentation}</td><td>{q.questionId}</td><td>{q.correct} / {q.total}</td><td>{q.total ? `${(100 * q.correct / q.total).toFixed(1)}%` : '—'}</td></tr>)}</tbody></table></div></section> : null}
    <section className="card"><h2>Thời gian thực hiện</h2><p>Thời gian đọc trung bình: {display(a.readingDurationSeconds.mean)} giây. Thời gian trả lời trung bình: {display(a.quizDurationSeconds.mean)} giây.</p><p className="help">Thời gian làm bài được tính từ sự kiện bắt đầu đến khi nộp trên máy chủ. Có thể thiếu thời gian ở dữ liệu cũ.</p></section>
    <p className="help">Lưu ý: thứ tự AB/BA được giữ nguyên; cần đối chiếu thiết kế đã duyệt trước khi diễn giải. PILOT và MAIN được tách riêng.</p>
  </div>;
}
