import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AdminLoginForm } from '@/components/admin/AdminLoginForm';
import { getAdminSession } from '@/lib/auth/admin-session';
export const metadata: Metadata = { title: 'Đăng nhập quản trị', robots: { index: false, follow: false } };
export default async function Page() { if (await getAdminSession()) redirect('/admin'); return <main className="narrow" style={{ paddingBlock: 56 }}><section className="card stack"><h1>Đăng nhập nhà nghiên cứu</h1><p>Không có đăng ký quản trị công khai. Tạo tài khoản bằng lệnh.</p><AdminLoginForm /></section></main>; }
