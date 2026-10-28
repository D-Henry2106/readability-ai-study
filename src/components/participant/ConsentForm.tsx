'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
export function ConsentForm() {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const router = useRouter();
  async function submit(decision: 'ACCEPTED' | 'DECLINED') { setBusy(true); setError(''); try { const r = await fetch('/api/consent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision }) }); const d = await r.json().catch(() => ({})); if (!r.ok) { setError(d.error ?? 'Không lưu được lựa chọn của bạn.'); return; } router.push(decision === 'ACCEPTED' ? '/demographics' : '/exit'); } catch { setError('Kết nối gián đoạn. Vui lòng thử lại lựa chọn của bạn.'); } finally { setBusy(false); } }
  return <div className="stack"><p><strong>Vui lòng đưa ra lựa chọn:</strong></p><div className="row"><button className="btn btn-primary" onClick={() => submit('ACCEPTED')} disabled={busy}>Tôi đồng ý</button><button className="btn btn-secondary" onClick={() => submit('DECLINED')} disabled={busy}>Tôi không đồng ý</button></div>{error ? <p className="error" role="alert">{error}</p> : null}</div>;
}
