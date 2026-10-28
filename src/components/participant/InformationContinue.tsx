'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function InformationContinue() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  async function next() {
    setBusy(true);
    setError('');

    try {
      const response = await fetch('/api/information/ack', {
        method: 'POST'
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? 'Không thể tiếp tục.');
        return;
      }

      router.push('/consent');
    } catch {
      setError('Không thể tiếp tục. Vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="participant-actions">
      <button
        type="button"
        className="btn btn-primary"
        onClick={next}
        disabled={busy}
      >
        {busy ? 'Đang lưu…' : 'Tiếp tục đến phần đồng ý'}
      </button>

      {error ? (
        <div
          className="notice notice-danger participant-action-error"
          role="alert"
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}