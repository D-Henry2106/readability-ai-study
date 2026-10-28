'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ExperimentalText } from './ExperimentalText';

export function ReadingClient({ rawContent, presentation, minimumSeconds }: { rawContent: string; presentation: 'V1' | 'V2'; minimumSeconds: number }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const metrics = useRef({ scrollCount: 0, max: 0 });

  useEffect(() => {
    let active = true;
    fetch('/api/reading/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ renderedAt: new Date().toISOString() })
    })
      .then(async (response) => {
        if (!active) return;
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          setError(data.error ?? 'Không thể bắt đầu bộ đếm thời gian đọc.');
          return;
        }
        setStarted(true);
      })
      .catch(() => {
        if (active) setError('Không thể bắt đầu tính giờ đọc. Vui lòng kiểm tra kết nối và tải lại trang.');
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let last = 0;
    const onScroll = () => {
      const now = Date.now();
      if (now - last < 250) return;
      last = now;
      metrics.current.scrollCount += 1;
      const root = document.documentElement;
      const total = Math.max(1, root.scrollHeight - root.clientHeight);
      const pct = Math.max(0, Math.min(100, (root.scrollTop / total) * 100));
      metrics.current.max = Math.max(metrics.current.max, pct);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  async function finish() {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/reading/finish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nextClickedAt: new Date().toISOString(),
          scrollCount: metrics.current.scrollCount,
          maxScrollDepthPercent: metrics.current.max
        })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error ?? 'Không thể tiếp tục.');
        return;
      }
      if (d.remainingSeconds > 0) {
        setRemaining(d.remainingSeconds);
        return;
      }
      router.push('/experiment/review');
    } catch {
      setError('Kết nối gián đoạn. Thời gian đọc trên máy chủ vẫn được giữ. Vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="reader-frame">
        <ExperimentalText rawContent={rawContent} presentation={presentation} />
      </div>
      <div className="reader-controls stack-sm">
        <p className="help">Có yêu cầu thời gian đọc tối thiểu. Tải lại trang không đặt lại bộ đếm phía máy chủ. Tối thiểu: {minimumSeconds} giây.</p>
        {remaining !== null && remaining > 0 ? <p className="notice notice-warning" role="status">Vui lòng tiếp tục đọc. Còn ít nhất {remaining} giây nữa.</p> : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
        <button className="btn btn-primary" onClick={finish} disabled={busy || !started}>{busy ? 'Đang kiểm tra…' : started ? 'Hoàn tất lượt đọc' : 'Đang bắt đầu tính giờ…'}</button>
      </div>
    </div>
  );
}
