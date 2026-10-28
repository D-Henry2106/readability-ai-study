'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
export function BreakClient() {
  const [remaining, setRemaining] = useState<number | null>(null); const [error, setError] = useState(''); const router = useRouter();
  useEffect(() => { let active = true; const tick = async () => { const r = await fetch('/api/break/status', { cache: 'no-store' }); const d = await r.json().catch(() => ({})); if (!active) return; if (!r.ok) { setError(d.error ?? 'Không thể kiểm tra trạng thái nghỉ.'); return; } setRemaining(d.remainingSeconds); if (d.remainingSeconds === 0) { const f = await fetch('/api/break/finish', { method: 'POST' }); const fd = await f.json().catch(() => ({})); if (f.ok && fd.finished) router.replace('/experiment/reading'); } }; tick(); const id = setInterval(tick, 1000); return () => { active = false; clearInterval(id); }; }, [router]);
  return <div className="stack"><p>Thời gian nghỉ bắt buộc là 120 giây. Tải lại trang không đặt lại bộ đếm.</p><p style={{ fontSize: '2rem', fontWeight: 800 }} aria-live="polite">{remaining === null ? 'Đang tải…' : `${remaining}s`}</p>{error ? <p className="error" role="alert">{error}</p> : null}</div>;
}
