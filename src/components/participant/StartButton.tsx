'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

function deviceType(): 'desktop' | 'tablet' | 'mobile' {
  if (window.innerWidth < 768) return 'mobile';
  if (window.innerWidth < 1024) return 'tablet';
  return 'desktop';
}

export function StartButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  async function start() {
    setBusy(true);
    setError('');

    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          deviceType: deviceType()
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? 'Không thể bắt đầu nghiên cứu.');
        return;
      }

      router.push(data.nextRoute ?? '/information');
    } catch {
      setError('Không thể bắt đầu nghiên cứu. Vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="start-action stack-sm">
      <button
        type="button"
        className="btn btn-primary start-button"
        onClick={start}
        disabled={busy}
      >
        {busy ? 'Đang bắt đầu…' : 'Bắt đầu nghiên cứu'}
      </button>

      {error ? (
        <div className="notice notice-danger start-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}