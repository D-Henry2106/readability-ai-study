'use client';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
export function AdminLoginForm() {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const router = useRouter();
  async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); setBusy(true); setError(''); const f = new FormData(e.currentTarget); const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: f.get('username'), password: f.get('password') }) }); const d = await r.json().catch(() => ({})); setBusy(false); if (!r.ok) { setError(d.error ?? 'Đăng nhập thất bại.'); return; } router.replace('/admin'); router.refresh(); }
  return <form className="stack" onSubmit={submit}><label className="field"><span>Tên đăng nhập</span><input name="username" autoComplete="username" required /></label><label className="field"><span>Mật khẩu</span><input type="password" name="password" autoComplete="current-password" required /></label><button className="btn btn-primary" disabled={busy}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>{error ? <p className="error" role="alert">{error}</p> : null}</form>;
}
