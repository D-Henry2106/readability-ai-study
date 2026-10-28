'use client';
import { FormEvent, useState } from 'react';
import type { ValidityFlag } from '@/types/research';
export function ValidityForm({ id, flag, reason, disabled }: { id: string; flag: ValidityFlag; reason: string | null; disabled: boolean }) {
  const [message, setMessage] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const f = new FormData(e.currentTarget); const r = await fetch(`/api/admin/sessions/${id}/validity`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ validityFlag: f.get('validityFlag'), reason: String(f.get('reason') ?? '').trim() || null }) }); const d = await r.json().catch(() => ({})); setMessage(r.ok ? 'Đã lưu đánh giá.' : (d.error ?? 'Lưu thất bại.')); if (r.ok) window.location.reload(); }
  return <form className="stack" onSubmit={submit}><label className="field"><span>Đánh giá hợp lệ</span><select name="validityFlag" defaultValue={flag} disabled={disabled}><option value="VALID">Hợp lệ</option><option value="INVALID">Không hợp lệ</option><option value="REVIEW_REQUIRED">Cần kiểm tra</option></select></label><label className="field"><span>Lý do</span><textarea name="reason" defaultValue={reason ?? ''} maxLength={500} disabled={disabled} /></label>{!disabled ? <button className="btn btn-primary">Lưu đánh giá</button> : null}{message ? <p role="status">{message}</p> : null}</form>;
}
