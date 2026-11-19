'use client';

import { useEffect, useRef, useState } from 'react';

const MESSAGES: Record<string, string> = {
  INVITATION_UNAVAILABLE: 'Liên kết không hợp lệ hoặc hiện chưa sử dụng được. Vui lòng liên hệ nhà nghiên cứu.',
  INVITATION_ALREADY_USED: 'Liên kết này đã được sử dụng. Vui lòng liên hệ nhà nghiên cứu.',
  ACTIVE_SESSION_IN_BROWSER: 'Trình duyệt này đang có một phiên nghiên cứu khác đang diễn ra. Vui lòng liên hệ nhà nghiên cứu.',
  INVITATION_REDEEM_IN_PROGRESS: 'Liên kết đang được xử lý. Vui lòng thử lại sau ít giây.'
};

function deviceType(): 'desktop' | 'tablet' | 'mobile' {
  if (window.innerWidth < 768) return 'mobile';
  if (window.innerWidth < 1024) return 'tablet';
  return 'desktop';
}

export function InvitationEntry() {
  // The token is kept ONLY in this ref (memory): never in localStorage, sessionStorage, a cookie or component state.
  const tokenRef = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (tokenRef.current !== null) return; // React StrictMode runs effects twice in development: read the fragment once.
    tokenRef.current = window.location.hash.replace(/^#/, '');
    // Remove the fragment from the address bar and the current history entry immediately.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);

  async function start() {
    const token = tokenRef.current;
    if (!token) {
      setError('Liên kết thiếu mã mời. Vui lòng mở lại đúng liên kết do nhà nghiên cứu gửi.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      // Explicit click (not automatic) so link previewers that run scripts cannot consume the invitation.
      const response = await fetch('/api/invitations/redeem', {
        method: 'POST',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, deviceType: deviceType() })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(MESSAGES[data.code] ?? data.error ?? 'Không thể bắt đầu nghiên cứu.');
        return;
      }
      tokenRef.current = null;
      window.location.replace(data.nextRoute ?? '/information');
    } catch {
      setError('Không thể bắt đầu nghiên cứu. Vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="start-action stack-sm">
      <button type="button" className="btn btn-primary start-button" onClick={start} disabled={busy}>
        {busy ? 'Đang xử lý…' : 'Tiếp tục'}
      </button>
      {error ? <div className="notice notice-danger start-error" role="alert">{error}</div> : null}
    </div>
  );
}
