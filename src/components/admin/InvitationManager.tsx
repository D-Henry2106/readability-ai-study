'use client';
import { useState } from 'react';

type RunRow = { _id: string; code: string; status: string };
type Inv = { _id: string; variant: 'V1' | 'V2'; status: string; label: string | null; questionSetRevision?: number; createdAt: string; redeemedAt: string | null };
type Locks = Record<'V1' | 'V2', { locked: boolean; changedBy: string | null; changedAt: string | null }>;

export function InvitationManager({ runs, initialLocks, canEdit }: { runs: RunRow[]; initialLocks: Locks; canEdit: boolean }) {
  const [runId, setRunId] = useState(runs[0]?._id ?? '');
  const [variant, setVariant] = useState<'V1' | 'V2'>('V1');
  const [count, setCount] = useState(1);
  const [label, setLabel] = useState('');
  const [locks, setLocks] = useState<Locks>(initialLocks);
  const [invitations, setInvitations] = useState<Inv[]>([]);
  const [links, setLinks] = useState<Array<{ invitationId: string; variant: string; link: string }>>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function call(url: string, body?: unknown) {
    setBusy(true); setMessage('');
    try {
      const r = await fetch(url, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMessage(d.code === 'VARIANT_LOCKED' ? `${variant} đang bị khóa: không phát link mới.` : (d.code ?? d.error ?? 'Thao tác thất bại.')); return null; }
      return d;
    } catch { setMessage('Kết nối gián đoạn.'); return null; } finally { setBusy(false); }
  }
  async function refresh(id = runId) { if (!id) return; const d = await call(`/api/admin/invitations?studyRunId=${id}`); if (d) setInvitations(d.invitations); }
  async function issue() {
    const d = await call('/api/admin/invitations', { action: 'CREATE', studyRunId: runId, variant, count, ...(label.trim() ? { label: label.trim() } : {}) });
    if (d) { setLinks(d.issued); await refresh(); }
  }
  async function toggleLock(v: 'V1' | 'V2') {
    if (!window.confirm(locks[v].locked ? `Mở khóa ${v}?` : `Khóa ${v}? Không phát hoặc nhận link mới của ${v}; người đã bắt đầu vẫn làm xong.`)) return;
    const d = await call('/api/admin/variant-locks', { variant: v, locked: !locks[v].locked });
    if (d) setLocks(d.locks);
  }

  return <div className="stack">
    <section className="card stack"><h2 style={{ margin: 0 }}>Khóa theo phiên bản</h2>
      <div className="row">{(['V1', 'V2'] as const).map((v) => <div key={v} className="stack-sm">
        <strong>{v}: {locks[v].locked ? 'ĐANG KHÓA' : 'đang mở'}</strong>
        <span className="help">{locks[v].changedAt ? `Lần cuối: ${locks[v].changedBy} · ${new Date(locks[v].changedAt!).toLocaleString('vi-VN')}` : 'Chưa thay đổi'}</span>
        {canEdit ? <button className="btn btn-secondary" disabled={busy} onClick={() => toggleLock(v)}>{locks[v].locked ? `Mở khóa ${v}` : `Khóa ${v}`}</button> : null}
      </div>)}</div>
    </section>
    <section className="card stack"><h2 style={{ margin: 0 }}>Phát link thử / người tham gia</h2>
      <div className="row">
        <label className="field"><span>Study Run</span><select value={runId} onChange={(e) => { setRunId(e.target.value); void refresh(e.target.value); }}>{runs.map((r) => <option key={r._id} value={r._id}>{r.code} ({r.status})</option>)}</select></label>
        <label className="field"><span>Phiên bản</span><select value={variant} onChange={(e) => setVariant(e.target.value as 'V1' | 'V2')}><option value="V1">V1</option><option value="V2">V2</option></select></label>
        <label className="field"><span>Số link</span><input type="number" min={1} max={200} value={count} onChange={(e) => setCount(Number(e.target.value))} /></label>
        <label className="field"><span>Ghi chú (không chứa dữ liệu cá nhân)</span><input value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} /></label>
      </div>
      {canEdit ? <button className="btn btn-primary" disabled={busy || !runId || locks[variant].locked} onClick={issue}>Phát link {variant}</button> : null}
      {locks[variant].locked ? <p className="help">{variant} đang khóa: backend sẽ từ chối phát link mới.</p> : null}
      {links.length ? <div className="stack"><p className="help">Chỉ hiển thị một lần. Hãy sao chép ngay; hệ thống không lưu token.</p>{links.map((l) => <code key={l.invitationId} style={{ wordBreak: 'break-all' }}>{l.variant}: {l.link}</code>)}</div> : null}
      {message ? <p className="error" role="alert">{message}</p> : null}
    </section>
    <section className="card stack"><div className="space-between"><h2 style={{ margin: 0 }}>Invitation của run</h2><button className="btn btn-secondary" disabled={busy || !runId} onClick={() => refresh()}>Tải danh sách</button></div>
      <div className="table-wrap"><table><thead><tr><th>ID</th><th>Version</th><th>Trạng thái</th><th>Bộ câu hỏi rev</th><th>Ghi chú</th><th>Tạo lúc</th></tr></thead><tbody>
        {invitations.map((i) => <tr key={i._id}><td>{i._id.slice(-8)}</td><td>{i.variant}</td><td>{i.status}</td><td>{i.questionSetRevision ?? '—'}</td><td>{i.label ?? ''}</td><td>{new Date(i.createdAt).toLocaleString('vi-VN')}</td></tr>)}
      </tbody></table></div>
    </section>
  </div>;
}
