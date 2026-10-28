import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/auth/admin-session';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { ToastProvider } from '@/components/admin/ToastProvider';
export default async function Layout({ children }: { children: React.ReactNode }) {
 const admin=await getAdminSession();if(!admin) redirect('/admin/login');
 return <ToastProvider><div className="admin-layout"><AdminSidebar username={admin.username} role={admin.role}/><main className="admin-main" id="noi-dung-chinh"><div className="admin-pagebar"><span>Research Dashboard / Quản trị</span></div>{children}</main></div></ToastProvider>;
}
