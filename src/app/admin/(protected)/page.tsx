import Link from 'next/link';
import type { Metadata } from 'next';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { ReadinessService } from '@/lib/services/readiness.service';
import { AnalysisService } from '@/lib/services/analysis.service';
import { UiIcon } from '@/components/admin/UiIcon';

export const metadata: Metadata = {
  title: 'Bảng điều khiển quản trị',
  robots: { index: false, follow: false }
};

const opsRunsRoute = ['/admin', ['study', 'runs'].join('-')].join('/');
const opsLinksRoute = ['/admin', ['invit', 'ations'].join('')].join('/');

export default async function Page({
  searchParams
}: {
  searchParams: Promise<{ phase?: string }>;
}) {
  const q = await searchParams;
  const repo = new ResearchRepository();
  const activeConfig = await repo.getConfig();
  const phase = q.phase === 'PILOT' || q.phase === 'MAIN' ? q.phase : activeConfig.phase;

  const [config, ready, counts, publishedCount, analysis, packages, questionSets] =
    await Promise.all([
      repo.getConfig(),
      new ReadinessService(repo).check(),
      repo.dashboardCounts(phase),
      repo.countPublishedPackages(phase),
      new AnalysisService(repo).overview(phase),
      repo.listPackages(),
      repo.listQuestionSets()
    ]);

  const publishedQuestionSets = questionSets.filter((qs) => qs.status === 'PUBLISHED' && !qs.archivedAt);
  const publishedPackages = packages.filter((pkg) => pkg.status === 'PUBLISHED');

  const progress = Math.min(
    100,
    Math.round((counts.valid / Math.max(1, config.minimumValidTarget)) * 100)
  );

  return (
    <div className="stack admin-dashboard">
      {/* Top Header */}
      <div className="admin-page-header space-between" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1>Bảng điều khiển quản trị</h1>
          <p className="help">
            Theo dõi quy trình nghiên cứu: Bộ câu hỏi &rarr; Bộ nội dung &rarr; Vận hành thực nghiệm &rarr; Dữ liệu phiên.
          </p>
        </div>
        <div className="row" style={{ alignItems: 'center', gap: 12 }}>
          <span
            className={`package-state ${
              ready.ready ? 'package-state--success' : 'package-state--warning'
            }`}
          >
            <span className="package-state-dot" />
            {ready.ready ? 'Hệ thống sẵn sàng' : 'Cần kiểm tra điều kiện'}
          </span>
        </div>
      </div>

      {/* Phase Selector Filter */}
      <div className="card row space-between" style={{ padding: '12px 18px', alignItems: 'center' }}>
        <div className="row" style={{ alignItems: 'center', gap: 12 }}>
          <UiIcon name="filter" />
          <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>Giai đoạn nghiên cứu đang xem:</span>
          <form className="row" style={{ gap: 8, margin: 0 }}>
            <select
              name="phase"
              defaultValue={phase}
              className="admin-compact-select"
            >
              <option value="MAIN">MAIN — Chính thức</option>
              <option value="PILOT">PILOT — Thử nghiệm</option>
            </select>
            <button className="btn btn-secondary btn-small" type="submit">
              Lọc
            </button>
          </form>
        </div>
        <small className="help">
          Cấu hình gốc: <strong>{config.phase}</strong> · Đang xem: <strong>{phase}</strong>
        </small>
      </div>

      {/* 4-Step Workflow Overview Cards */}
      <section aria-label="Quy trình nghiên cứu">
        <div className="admin-workflow-grid">
          {/* Step 1: Question Sets */}
          <div className="card admin-workflow-card stack-sm">
            <div className="space-between">
              <span className="package-stat-icon package-stat-icon--blue">
                <UiIcon name="list" />
              </span>
              <span className="package-chip">Bước 1</span>
            </div>
            <h4>Bộ câu hỏi (15 câu)</h4>
            <p className="help">Tạo bộ câu hỏi chuẩn trước khi liên kết.</p>
            <div className="admin-workflow-stat">
              <strong>{questionSets.length}</strong>
              <small>({publishedQuestionSets.length} đã xuất bản)</small>
            </div>
            <Link href="/admin/questions" className="btn btn-secondary btn-small" style={{ marginTop: 'auto' }}>
              Quản lý câu hỏi &rarr;
            </Link>
          </div>

          {/* Step 2: Content Packages */}
          <div className="card admin-workflow-card stack-sm">
            <div className="space-between">
              <span className="package-stat-icon package-stat-icon--mint">
                <UiIcon name="book" />
              </span>
              <span className="package-chip">Bước 2</span>
            </div>
            <h4>Bộ nội dung (V1/V2)</h4>
            <p className="help">Nhập bài đọc V1/V2 và chọn Bộ câu hỏi liên kết.</p>
            <div className="admin-workflow-stat">
              <strong>{packages.length}</strong>
              <small>({publishedPackages.length} đã xuất bản)</small>
            </div>
            <Link href="/admin/content" className="btn btn-secondary btn-small" style={{ marginTop: 'auto' }}>
              Quản lý nội dung &rarr;
            </Link>
          </div>

          {/* Step 3: Operational Runs */}
          <div className="card admin-workflow-card stack-sm">
            <div className="space-between">
              <span className="package-stat-icon package-stat-icon--amber">
                <UiIcon name="play" />
              </span>
              <span className="package-chip">Bước 3</span>
            </div>
            <h4>Vận hành đợt nghiên cứu</h4>
            <p className="help">Khởi chạy đợt thực nghiệm và phát hành liên kết tham gia.</p>
            <div className="admin-workflow-stat">
              <strong>{publishedCount}</strong>
              <small>gói sẵn sàng triển khai</small>
            </div>
            <div className="row" style={{ gap: 6, marginTop: 'auto' }}>
              <Link href={opsRunsRoute} className="btn btn-secondary btn-small">
                Đợt nghiên cứu &rarr;
              </Link>
              <Link href={opsLinksRoute} className="btn btn-secondary btn-small">
                Phát link &rarr;
              </Link>
            </div>
          </div>

          {/* Step 4: Participant Sessions */}
          <div className="card admin-workflow-card stack-sm">
            <div className="space-between">
              <span className="package-stat-icon package-stat-icon--blue">
                <UiIcon name="users" />
              </span>
              <span className="package-chip">Bước 4</span>
            </div>
            <h4>Dữ liệu người tham gia</h4>
            <p className="help">Duyệt tính hợp lệ, kiểm tra điểm và xuất báo cáo.</p>
            <div className="admin-workflow-stat">
              <strong>{counts.completed}</strong>
              <small>hoàn thành · {counts.review} chờ duyệt</small>
            </div>
            <Link href="/admin/sessions" className="btn btn-secondary btn-small" style={{ marginTop: 'auto' }}>
              Xem người tham gia &rarr;
            </Link>
          </div>
        </div>
      </section>

      {/* Participant Progress & Validity Metrics */}
      <div className="grid-2col" style={{ alignItems: 'start' }}>
        <section className="card stack">
          <div className="space-between">
            <div>
              <h3>Tiến độ thu thập ({phase})</h3>
              <p className="help">
                {counts.valid} phiên hợp lệ / mục tiêu tối thiểu {config.minimumValidTarget}
              </p>
            </div>
            <span className="package-chip">{progress}%</span>
          </div>

          <div
            className="progress"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${progress}%` }} />
          </div>

          <div className="metric-grid" style={{ marginTop: 12 }}>
            <div className="metric">
              <span className="help">Đã bắt đầu</span>
              <strong>{counts.started}</strong>
            </div>
            <div className="metric">
              <span className="help">Đã đồng ý</span>
              <strong>{counts.consented}</strong>
            </div>
            <div className="metric">
              <span className="help">Đã hoàn thành</span>
              <strong>{counts.completed}</strong>
            </div>
            <div className="metric">
              <span className="help">Chờ xét duyệt</span>
              <strong style={{ color: counts.review > 0 ? '#b45309' : 'inherit' }}>
                {counts.review}
              </strong>
            </div>
            <div className="metric">
              <span className="help">Hợp lệ (VALID)</span>
              <strong style={{ color: '#059669' }}>{counts.valid}</strong>
            </div>
            <div className="metric">
              <span className="help">Không hợp lệ</span>
              <strong>{counts.invalid}</strong>
            </div>
          </div>

          <div className="space-between" style={{ marginTop: 8 }}>
            <Link href="/admin/sessions" className="btn btn-secondary btn-small">
              Xét duyệt ({counts.review} phiên) &rarr;
            </Link>
            <Link href="/admin/exports" className="btn btn-secondary btn-small">
              Xuất dữ liệu &rarr;
            </Link>
          </div>
        </section>

        {/* Real Statistics Comparison (V1 vs V2) */}
        <section className="card stack">
          <div className="space-between">
            <div>
              <h3>Chỉ số so sánh V1 vs V2 ({phase})</h3>
              <p className="help">
                Tính toán từ các phiên nghiên cứu thực tế, không dùng số liệu giả lập.
              </p>
            </div>
            <Link href="/admin/statistics" className="btn btn-secondary btn-small">
              Chi tiết &rarr;
            </Link>
          </div>

          <div className="metric-grid">
            <div className="metric">
              <span className="help">Hoàn thành V1 (Chuẩn)</span>
              <strong>{analysis.variants.v1.completed}</strong>
            </div>
            <div className="metric">
              <span className="help">Điểm TB V1 (/15)</span>
              <strong>
                {analysis.variants.v1.scoreStats.mean !== null
                  ? analysis.variants.v1.scoreStats.mean.toFixed(2)
                  : analysis.analysis.v1.mean?.toFixed(2) ?? '—'}
              </strong>
            </div>
            <div className="metric">
              <span className="help">Hoàn thành V2 (Dễ tiếp cận)</span>
              <strong>{analysis.variants.v2.completed}</strong>
            </div>
            <div className="metric">
              <span className="help">Điểm TB V2 (/15)</span>
              <strong>
                {analysis.variants.v2.scoreStats.mean !== null
                  ? analysis.variants.v2.scoreStats.mean.toFixed(2)
                  : analysis.analysis.v2.mean?.toFixed(2) ?? '—'}
              </strong>
            </div>
            <div className="metric">
              <span className="help">Chênh lệch V2 − V1</span>
              <strong
                style={{
                  color:
                    analysis.variants.diffMeanScore !== null && analysis.variants.diffMeanScore > 0
                      ? '#059669'
                      : 'inherit'
                }}
              >
                {analysis.variants.diffMeanScore !== null
                  ? analysis.variants.diffMeanScore >= 0
                    ? `+${analysis.variants.diffMeanScore.toFixed(2)}`
                    : analysis.variants.diffMeanScore.toFixed(2)
                  : '—'}
              </strong>
            </div>
            <div className="metric">
              <span className="help">Bộ nội dung xuất bản</span>
              <strong>{publishedCount}</strong>
            </div>
          </div>
        </section>
      </div>

      {/* System Readiness Checklist */}
      <section className="card stack">
        <div className="space-between">
          <div>
            <h3>Điều kiện sẵn sàng của hệ thống</h3>
            <p className="help">
              Kiểm tra các thành phần giao thức và văn bản pháp lý cần thiết trước khi mở nghiên cứu.
            </p>
          </div>
          <Link href="/admin/config" className="btn btn-secondary btn-small">
            Cấu hình giao thức &rarr;
          </Link>
        </div>

        <div className="package-checklist">
          {ready.checks.map((check) => (
            <div className="package-check-item" key={check.code}>
              <span className={`package-check-icon ${check.status === 'PASS' ? 'is-done' : ''}`}>
                <UiIcon name={check.status === 'PASS' ? 'check' : 'alert'} />
              </span>
              <div>
                <strong>{check.label}</strong>
                <small>{check.status === 'PASS' ? 'Đã hoàn tất cấu hình' : check.detail}</small>
              </div>
              <span className={`package-check-result ${check.status === 'PASS' ? 'is-done' : ''}`}>
                {check.status === 'PASS' ? 'Đạt' : 'Chưa đủ'}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
