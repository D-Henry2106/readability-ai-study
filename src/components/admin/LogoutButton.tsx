'use client';
import { useRouter } from 'next/navigation';
export function LogoutButton() { const router = useRouter(); return <button className="btn btn-secondary" onClick={async () => { await fetch('/api/admin/logout', { method: 'POST' }); router.replace('/admin/login'); router.refresh(); }}>Đăng xuất</button>; }
