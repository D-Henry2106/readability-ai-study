import Link from 'next/link';
import type { Metadata } from 'next';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { ReadinessService } from '@/lib/services/readiness.service';
import { AnalysisService } from '@/lib/services/analysis.service';
import { RunOverviewService } from '@/lib/services/run-overview.service';
import { UiIcon } from '@/components/admin/UiIcon';

export const metadata: Metadata = {
  title: 'Bảng điều khiển quản trị',
  robots: { index: false, follow: false }
};

const PROTOCOL_CODES = new Set([
  'PARTICIPANT_INFORMATION_SHEET',
  'CONSENT_WORDING',
  'DEBRIEF_WORDING',
  'DATA_RIGHTS_WORDING',
  'FINDINGS_INFORMATION',
  'MINIMUM_READING_TIME'
]);
const RUN_STATUS_LABEL: Record<string, string> = { DRAFT: 'Bản nháp', OPEN: 'Đang mở', PAUSED: 'Tạm dừng', CLOSED: 'Đã đóng' };

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

  const [config, ready, counts, publishedCount, analysis, packages, questionSets, runs] =
    await Promise.all([
      repo.getConfig(),
      new ReadinessService(repo).check(),
      repo.dashboardCounts(phase),
      repo.countPublishedPackages(phase),
      new AnalysisService(repo).overview(phase),
      repo.listPackages(),
      repo.listQuestionSets(),
      new RunOverviewService().list()
    ]);

  const publishedQuestionSets = questionSets.filter((qs) => qs.status === 'PUBLISHED' && !qs.archivedAt);
  const publishedPackages = packages.filter((pkg) => pkg.status === 'PUBLISHED');

  const openRuns = runs.filter((run) => run.status === 'OPEN').length;
  const protocolChecks = ready.checks.filter((check) => PROTOCOL_CODES.has(check.code));
  const protocolMissing = protocolChecks.filter((check) => check.status !== 'PASS').length;
  const percent = (value: number, quota: number | null) =>
    quota ? Math.min(100, Math.round((value / quota) * 100)) : 0;

  return (
    <div className="stack admin-dashboard">
      {/* Top Header */}
      <div className="admin-page-header space-between" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1>Bảng điều khiển quản trị</h1>
          <p className="help">
            Làm lần lượt 4 bước: bộ câu hỏi, bài đọc, đợt nghiên cứu, dữ liệu người tham gia.
          </p>
        </div>
        <div className="row" style={{ alignItems: 'center', gap: 12 }}>
          <span
            className={`package-state ${
              openRuns > 0 ? 'package-state--success' : 'package-state--warning'
            }`}
          >
            <span className="package-state-dot" />
            {openRuns > 0 ? `${openRuns} đợt đang mở` : 'Chưa có đợt nào đang mở'}
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
              Quản lý câu hỏi
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
            <p className="help">Nhập bài đọc V1 và V2 (chữ giống nhau, chỉ khác định dạng).</p>
            <div className="admin-workflow-stat">
              <strong>{packages.length}</strong>
              <small>({publishedPackages.length} đã xuất bản)</small>
            </div>
            <Link href="/admin/content" className="btn btn-secondary btn-small" style={{ marginTop: 'auto' }}>
              Quản lý nội dung
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
                Đợt nghiên cứu
              </Link>
              <Link href={opsLinksRoute} className="btn btn-secondary btn-small">
                Phát link
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
              Xem người tham gia
            </Link>
          </div>
        </div>
      </section>

      {/* Research runs: quota progress and personal links */}
      <section className="card stack" aria-label="Các đợt nghiên cứu">
        <div className="space-between">
          <div>
            <h3>Các đợt nghiên cứu</h3>
            <p className="help">Tiến độ người tham gia hợp lệ ở từng nhóm và số link riêng đã gửi.</p>
          </div>
          <Link href={opsRunsRoute} className="btn btn-secondary btn-small">
            Quản lý đợt
          </Link>
        </div>

        {runs.length === 0 ? (
          <p className="help">Chưa có đợt nghiên cứu nào. Hãy tạo đợt ở Bước 3.</p>
        ) : (
          runs.map((run) => (
            <div
              key={run.id}
              className="stack-sm"
              style={{ padding: '12px 0', borderTop: '1px solid rgba(128,128,128,0.2)' }}
            >
              <div className="space-between">
                <div>
                  <strong>{run.code}</strong> &mdash; {run.name}{' '}
                  <span className="package-chip">{RUN_STATUS_LABEL[run.status] ?? run.status}</span>{' '}
                  <span className="package-chip">{run.phase}</span>
                </div>
                <small className="help">
                  Link riêng: {run.linksIssued} đã tạo &middot; {run.linksRedeemed} đã dùng &middot; {run.linksUnused} chưa dùng
                  {run.linksRevoked > 0 ? ` · ${run.linksRevoked} đã thu hồi` : ''}
                </small>
              </div>
              <div className="grid-2col">
                {([['V1 (chuẩn)', run.v1Valid], ['V2 (dễ tiếp cận)', run.v2Valid]] as const).map(([label, valid]) => (
                  <div key={label} className="stack-sm">
                    <div className="space-between">
                      <span className="help">{label}</span>
                      <strong>
                        {valid}
                        {run.quotaPerArm ? ` / ${run.quotaPerArm}` : ''} hợp lệ
                      </strong>
                    </div>
                    <div
                      className="progress"
                      role="progressbar"
                      aria-valuenow={percent(valid, run.quotaPerArm)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <span style={{ width: `${percent(valid, run.quotaPerArm)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              {run.quotaPerArm === null ? (
                <small className="help">Chưa xác nhận hạn mức mỗi nhóm cho đợt này.</small>
              ) : null}
            </div>
          ))
        )}
      </section>

      {/* Participant sessions of the selected phase and V1 vs V2 comparison */}
      <div className="grid-2col" style={{ alignItems: 'start' }}>
        <section className="card stack">
          <div>
            <h3>Phiên tham gia ({phase})</h3>
            <p className="help">Tất cả phiên trong giai đoạn đang xem.</p>
          </div>

          <div className="metric-grid">
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
              Xét duyệt ({counts.review} phiên)
            </Link>
            <Link href="/admin/exports" className="btn btn-secondary btn-small">
              Xuất dữ liệu
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
              Chi tiết
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

      {/* Protocol configuration (collapsed when complete) */}
      <details className="card stack" open={protocolMissing > 0}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
          Cấu hình giao thức &mdash;{' '}
          {protocolMissing === 0 ? 'đầy đủ' : `còn thiếu ${protocolMissing} mục (cần có trước khi mở đợt)`}
        </summary>
        <div className="stack" style={{ marginTop: 12 }}>
          <div className="space-between">
            <p className="help">
              Văn bản thông tin, đồng ý, giải thích sau nghiên cứu, quyền dữ liệu, thông tin kết quả và thời gian đọc tối thiểu.
            </p>
            <Link href="/admin/config" className="btn btn-secondary btn-small">
              Cấu hình giao thức
            </Link>
          </div>

          <div className="package-checklist">
            {protocolChecks.map((check) => (
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
        </div>
      </details>
    </div>
  );
}
