'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function WithdrawButton() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const [error, setError] = useState('');
  async function withdraw() {
    if (!window.confirm('Bạn có muốn rút khỏi nghiên cứu? Việc tham gia sẽ kết thúc và không cần nêu lý do.')) return;
    setBusy(true);
    try {
      const response = await fetch('/api/withdraw', { method: 'POST' });
      if (response.ok) router.replace('/withdraw');
      else setError('Chưa thể rút lui lúc này. Vui lòng thử lại.');
    } catch {
      setError('Kết nối gián đoạn. Vui lòng thử lại việc rút lui.');
    } finally {
      setBusy(false);
    }
  }
  return <div className="stack-sm"><button type="button" className="btn btn-secondary" onClick={withdraw} disabled={busy}>{busy ? 'Đang rút lui…' : 'Rút khỏi nghiên cứu'}</button>{error ? <p className="error" role="alert">{error}</p> : null}</div>;
}
