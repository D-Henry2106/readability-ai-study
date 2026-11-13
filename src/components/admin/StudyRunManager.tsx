'use client';
import { useState } from 'react';
import { INFO_CONSENT_REVIEW_STATEMENT } from '@/lib/validation/study-run-schemas';

type Option = { id: string; label: string };
type RunRow = { _id: string; code: string; name: string; phase: string; status: string; targetSampleSize: number; version: number; locked: boolean; packageCode: string; questionSetRevision: number | null };
type Detail = {
  run: { _id: string; version: number; status: string; targetSampleSize: number; quotaPerArm: number | null; entryPolicy: { legacyEntry: string } | null; locked: boolean };
  readiness: { ready: boolean; missing: string[] };
  infoConsent: string;
  profiles: Array<{ _id: string; version: number; status: string; editRevision: number }>;
};

const MISSING_LABEL: Record<string, string> = {
  QUOTA_NOT_CONFIRMED: 'Chưa xác nhận quota (N/2 mỗi nhánh).',
  ENTRY_POLICY_NOT_CONFIRMED: 'Chưa chọn chính sách lối vào cũ.',
  INFO_CONSENT_NOT_CONFIRMED: 'Chưa xác nhận Information/Consent/Debrief.',
  INFO_CONSENT_CHANGED: 'Information/Consent/Debrief đã đổi sau lần xác nhận: cần xác nhận lại.',
  PRESENTATION_PROFILE_NOT_CONFIRMED: 'Chưa gắn Presentation Profile V2 ở trạng thái CONFIRMED.',
  PRESENTATION_PROFILE_MISMATCH: 'Presentation Profile V2 không khớp bài đọc của run.',
  PROTOCOL_NOT_READY: 'Thiếu cấu hình giao thức nghiên cứu (Thông tin, Đồng ý, Quyền dữ liệu, Thời gian đọc tối thiểu...).',
  'SNAPSHOT:QUESTIONS_NOT_PUBLISHED': 'Bộ câu hỏi chưa PUBLISHED/khóa.',
  'SNAPSHOT:INVALID_QUESTIONS': 'Bộ câu hỏi không đúng 15 câu (3 câu mỗi nhóm).',
  'SNAPSHOT:QUESTIONS_ARCHIVED': 'Bộ câu hỏi đã được lưu trữ.',
  'SNAPSHOT:CONTENT_NOT_PUBLISHED': 'Bài đọc chưa PUBLISHED/khóa.',
  'SNAPSHOT:PACKAGE_NOT_PUBLISHED': 'Content Package chưa PUBLISHED.'
};
const labelOf = (code: string) => MISSING_LABEL[code] ?? code;

export function StudyRunManager({ runs, packages, questionSets, canEdit }: { runs: RunRow[]; packages: Option[]; questionSets: Option[]; canEdit: boolean }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [previewInfo, setPreviewInfo] = useState('');

  async function api(url: string, body?: unknown): Promise<Record<string, unknown> | null> {
    setBusy(true); setMessage('');
    try {
      const r = await fetch(url, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const details = Array.isArray(d.details) && d.details.length ? ` (${d.details.map(labelOf).join('; ')})` : '';
        setMessage(`${labelOf(d.code ?? d.error ?? 'Thao tác thất bại')}${details}`); return null;
      }
      return d;
    } catch { setMessage('Kết nối gián đoạn.'); return null; } finally { setBusy(false); }
  }
  async function load(id: string) { const d = await api(`/api/admin/study-runs/${id}`); if (d) { setOpenId(id); setDetail(d as unknown as Detail); } }
  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (!detail || !openId) return;
    const d = await api(`/api/admin/study-runs/${openId}`, { action, expectedVersion: detail.run.version, ...extra });
    if (d) await load(openId);
  }
  async function create(form: FormData) {
    const questionSetId = String(form.get('questionSetId') ?? '');
    const d = await api('/api/admin/study-runs', {
      code: form.get('code'),
      name: form.get('name'),
      phase: form.get('phase'),
      packageId: form.get('packageId'),
      targetSampleSize: Number(form.get('targetSampleSize')),
      questionSetId
    });
    if (d) window.location.reload();
  }
  async function profileStep(action: 'CREATE' | 'PREVIEW' | 'CONFIRM', id?: string, editRevision?: number) {
    if (!detail || !openId) return;
    const contentRevisionId = (await fetch(`/api/admin/study-runs/${openId}`).then((r) => r.json()).catch(() => null))?.run?.snapshot?.contentRevisionId as string | undefined;
    const body = action === 'CREATE' ? { action, contentRevisionId, emphasis: [] } : action === 'PREVIEW' ? { action, id } : { action, id, confirm: true, expectedRevision: editRevision };
    const d = await api('/api/admin/presentation-profiles', body);
    if (d) { if (action === 'PREVIEW') setPreviewInfo('Đã xem trước: kiểm tra toàn vẹn ký tự V1/V2 đạt. Bạn có thể xác nhận.'); await load(openId); }
  }

  return <div className="stack">
    {/* Study Run Workflow Quick Guide */}
    <div className="card" style={{ background: 'rgba(66, 153, 225, 0.05)', borderColor: 'rgba(66, 153, 225, 0.3)' }}>
      <h3 style={{ margin: '0 0 8px' }}>Hướng dẫn quy trình triển khai Study Run</h3>
      <ol style={{ margin: 0, paddingLeft: 20 }}>
        <li><strong>Tạo Run:</strong> Chọn Content Package (bài đọc) và Bộ câu hỏi 15 câu đã xuất bản (dùng chung cho cả 2 nhánh V1 và V2).</li>
        <li><strong>Xác nhận Quota:</strong> Chọn mục tiêu mẫu (ví dụ 30), hệ thống tự chia đều N/2 (15 người cho V1, 15 người cho V2).</li>
        <li><strong>Xác nhận Hồ sơ V2:</strong> Tạo, xem trước và bấm Xác nhận Presentation Profile V2 để định dạng khối câu cho bài đọc V2.</li>
        <li><strong>Xác nhận Văn bản thông tin:</strong> Bấm xác nhận tài liệu Thông tin nghiên cứu, Đồng ý tham gia & Giải thích sau nghiên cứu.</li>
        <li><strong>Mở Run (OPEN):</strong> Sau khi đủ 4 điều kiện trên, bấm nút &ldquo;Mở run&rdquo;.</li>
        <li><strong>Phát link mời:</strong> Sang trang <a href="/admin/invitations" style={{ fontWeight: 'bold' }}>Link thử / Invitation</a> để phát liên kết riêng cho người tham gia nhóm V1 hoặc V2.</li>
      </ol>
    </div>

    {canEdit ? <form className="card stack" onSubmit={(e) => { e.preventDefault(); void create(new FormData(e.currentTarget)); }}>
      <h2 style={{ margin: 0 }}>Tạo Study Run mới</h2>
      <p className="help">Chỉ chọn được Content Package đã PUBLISHED và bộ câu hỏi 15 câu đã PUBLISHED. Cả V1 và V2 dùng chung bộ câu hỏi này.</p>
      <div className="row">
        <label className="field"><span>Mã run (Code)</span><input name="code" required pattern="[A-Za-z0-9_\-]{2,40}" placeholder="RUN_2026_01" /></label>
        <label className="field"><span>Tên đợt nghiên cứu</span><input name="name" required placeholder="Nghiên cứu khả năng đọc hiểu đợt 1" /></label>
        <label className="field"><span>Giai đoạn</span><select name="phase" defaultValue="MAIN"><option>MAIN</option><option>PILOT</option></select></label>
        <label className="field"><span>Tổng mẫu tuyển (số chẵn)</span><input name="targetSampleSize" type="number" min={2} step={2} defaultValue={30} required /></label>
      </div>
      <div className="row">
        <label className="field"><span>Content Package (Bài đọc gốc)</span><select name="packageId" required>{packages.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
        <label className="field"><span>Bộ câu hỏi chung (15 câu) <em>*</em></span><select name="questionSetId" required defaultValue={questionSets[0]?.id}>{questionSets.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}</select></label>
      </div>
      <button className="btn btn-primary" disabled={busy || !packages.length || !questionSets.length}>Tạo Study Run (DRAFT)</button>
    </form> : null}
    {message ? <p className="error" role="alert">{message}</p> : null}
    {runs.map((run) => <section className="card stack" key={run._id}>
      <div className="space-between">
        <div>
          <div className="row" style={{ alignItems: 'center', gap: 8 }}>
            <h2 style={{ margin: 0 }}>{run.code} · {run.name}</h2>
            <span className="badge" style={{ background: run.status === 'OPEN' ? '#2f855a' : run.status === 'PAUSED' ? '#dd6b20' : run.status === 'CLOSED' ? '#718096' : '#3182ce', color: '#fff' }}>
              {run.status === 'OPEN' ? 'Đang mở (OPEN)' : run.status === 'PAUSED' ? 'Tạm dừng (PAUSED)' : run.status === 'CLOSED' ? 'Đã đóng (CLOSED)' : 'Bản nháp (DRAFT)'}
            </span>
          </div>
          <p className="help">{run.phase} · {run.locked ? 'Đã khóa cấu hình snapshot · ' : ''}Quy mô: {run.targetSampleSize} người ({run.targetSampleSize / 2} cho V1, {run.targetSampleSize / 2} cho V2) · Gói bài đọc: {run.packageCode} · Bộ câu hỏi: rev {run.questionSetRevision ?? '—'}</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <a className="btn btn-secondary" href={`/admin/statistics?studyRunId=${run._id}`}>Thống kê Run</a>
          {run.status === 'OPEN' ? <a className="btn btn-primary" href="/admin/invitations">Phát link V1/V2</a> : null}
          <button className="btn btn-secondary" onClick={() => (openId === run._id ? setOpenId(null) : void load(run._id))} disabled={busy}>{openId === run._id ? 'Đóng cấu hình' : 'Cấu hình / Điều khiển'}</button>
        </div>
      </div>
      {openId === run._id && detail ? <div className="stack" style={{ marginTop: 12, borderTop: '1px solid rgba(128,128,128,0.2)', paddingTop: 16 }}>
        {detail.readiness.ready ? <div className="notice notice-success" role="status"><strong>Đủ điều kiện mở run:</strong> Mọi điều kiện cấu hình đã hoàn tất. Bạn có thể bấm &ldquo;Mở run&rdquo; bên dưới.</div> : <div><strong>Chưa thể mở run vì các điều kiện sau:</strong><ul>{detail.readiness.missing.map((m) => <li key={m}>{labelOf(m)}</li>)}</ul></div>}
        {canEdit ? <div className="stack">
          <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
            <button className="btn btn-secondary" disabled={busy || detail.run.status === 'OPEN'} onClick={() => act('CONFIRM_QUOTA', { quotaPerArm: detail.run.targetSampleSize / 2 })}>
              {detail.run.quotaPerArm ? '✓ Đã xác nhận Quota' : 'Xác nhận Quota'}: {detail.run.targetSampleSize / 2} người / nhánh (V1 & V2)
            </button>
            <select aria-label="Chính sách lối vào cũ" defaultValue="" onChange={(e) => e.target.value && void act('ENTRY_POLICY', { legacyEntry: e.target.value })} disabled={busy}>
              <option value="">Lối vào công khai{detail.run.entryPolicy ? `: ${detail.run.entryPolicy.legacyEntry}` : ' (chưa chọn)'}</option>
              <option value="BLOCKED_WHILE_OPEN">BLOCKED_WHILE_OPEN (Khuyến nghị: Chỉ cho phép vào qua link Study Run)</option>
              <option value="UNCHANGED">UNCHANGED (Cho phép cả lối vào cũ song song)</option>
            </select>
            <button className="btn btn-secondary" disabled={busy} onClick={() => act('INFO_CONSENT', { statement: INFO_CONSENT_REVIEW_STATEMENT })}>
              Xác nhận Information/Consent/Debrief ({detail.infoConsent})
            </button>
          </div>
          <div className="card stack">
            <strong>Hồ sơ hiển thị V2 (Presentation Profile V2)</strong>
            <p className="help">Phải ở trạng thái CONFIRMED mới gắn được vào run và phát link V2. Hệ thống không tự xác nhận.</p>
            {detail.profiles.map((p) => <div className="row" key={p._id}><span>Profile v{p.version} · {p.status}</span>
              {p.status === 'DRAFT' ? <><button className="btn btn-secondary" disabled={busy} onClick={() => profileStep('PREVIEW', p._id)}>Xem trước</button><button className="btn btn-secondary" disabled={busy} onClick={() => profileStep('CONFIRM', p._id, p.editRevision)}>Xác nhận</button></> : null}
              {(p.status === 'CONFIRMED' || p.status === 'LOCKED') && !detail.run.locked ? <button className="btn btn-primary" disabled={busy || detail.run.status === 'OPEN'} onClick={() => act('PROFILE', { profileId: p._id })}>Gắn vào run</button> : null}
            </div>)}
            {previewInfo ? <p className="help">{previewInfo}</p> : null}
            <button className="btn btn-secondary" disabled={busy || detail.run.locked} onClick={() => profileStep('CREATE')}>Tạo profile mới (không nhấn mạnh)</button>
          </div>
          <div className="row">
            {(['OPEN', 'PAUSED', 'CLOSED'] as const).map((to) => <button key={to} className={to === 'OPEN' ? 'btn btn-primary' : 'btn btn-secondary'} disabled={busy || detail.run.status === to} onClick={() => act('TRANSITION', { to, ...(detail.run.status === 'CLOSED' && to === 'OPEN' ? { reason: window.prompt('Lý do mở lại run:') ?? '' } : {}) })}>{to === 'OPEN' ? 'Mở run (Bắt đầu tuyển)' : to === 'PAUSED' ? 'Tạm dừng tuyển' : 'Đóng tuyển (Kết thúc)'}</button>)}
          </div>
        </div> : null}
      </div> : null}
    </section>)}
  </div>;
}
